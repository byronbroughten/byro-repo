// Decides the branch guard: keeps sessions sharing a primary checkout from moving its branch or HEAD under each other. Pure; branchGuard.ts and branchRecord.ts do the I/O.
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

import { ShellParser } from "./tiers/ShellParser.ts";

export type GuardMode = "interim" | "strict";

export interface CheckoutState {
  // undefined for a detached HEAD.
  branch: string | undefined;
  head: string;
}

// Keyed by the primary checkout's absolute path.
export type CheckoutStates = Record<string, CheckoutState>;

export interface SessionRecord {
  sessionId: string;
  recordedAt: number;
  endedAt?: number;
  checkouts: CheckoutStates;
  // Checkouts this session's own command may have moved, re-recorded before its next decision.
  refreshPending?: string[];
}

export interface BranchGuardInput {
  command: string;
  cwd: string;
  mode: GuardMode;
  primaryCheckouts: string[];
  ownCheckouts: CheckoutStates;
  currentCheckouts: CheckoutStates;
  // Tells a bare-path file restore from a branch name, as git does.
  isExistingPath(path: string): boolean;
}

export type CommandTarget = Pick<
  BranchGuardInput,
  "command" | "cwd" | "primaryCheckouts"
>;

export interface GuardDecision {
  permissionDecision: "allow" | "deny";
  reason: string;
}

type GitActionKind = "branchMove" | "commit" | "other";

export interface GitAction {
  kind: GitActionKind;
  subcommand: string;
  // The primary checkout acted on.
  checkout: string;
}

const recordLifetimeMs = 24 * 60 * 60 * 1000;
// Git worktrees nested inside a primary checkout act on their own HEAD, not the primary's.
const nestedWorktreeDirs = [".claude/worktrees"];
// Global options that take the next word as their value.
const gitValueOptions = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--exec-path",
]);
const headMovingSubcommands = new Set([
  "checkout",
  "switch",
  "commit",
  "merge",
  "rebase",
  "reset",
  "pull",
  "cherry-pick",
  "revert",
  "am",
]);
const workspaceWay =
  "work the ticket in its issue workspace (`npm run issue:list`), where branches are the workspace's own";
const restoreHint = "A file restore is `git checkout -- <path>`.";
// checkout and switch options that make a new branch from the next word.
const branchCreatingOptions = new Set(["-b", "-B", "-c", "-C", "--orphan"]);

export function branchDecision(props: BranchGuardInput): GuardDecision {
  for (const action of gitActionsOf(props, props.isExistingPath)) {
    const reason = denyReasonOf(action, props);
    if (reason) {
      return { permissionDecision: "deny", reason: guardMessage(reason) };
    }
  }
  return {
    permissionDecision: "allow",
    reason: guardMessage(
      "nothing here moves a branch or HEAD under another session.",
    ),
  };
}

// The primary checkouts whose HEAD the command may move, so the session can re-record them.
export function headMovingCheckouts(target: CommandTarget): string[] {
  return checkoutsActedOn(target, ({ subcommand }) =>
    headMovingSubcommands.has(subcommand),
  );
}

// The command's commits and merges in a primary checkout, for the primary-edit guard.
export function historyWritesOf(target: CommandTarget): GitAction[] {
  return actionsActedOn(
    target,
    ({ kind, subcommand }) => kind === "commit" || subcommand === "merge",
  );
}

export function isLive(
  { endedAt, recordedAt }: SessionRecord,
  now: number,
): boolean {
  return endedAt === undefined && now - recordedAt <= recordLifetimeMs;
}

// A live record outlasts a restart of its session, as after a compact; an ended or dead one is replaced.
export function startedRecord(
  existing: SessionRecord | undefined,
  sessionId: string,
  checkouts: CheckoutStates,
  now: number,
): SessionRecord {
  if (existing && isLive(existing, now)) return existing;
  return { sessionId, recordedAt: now, checkouts };
}

export function endedRecord(record: SessionRecord, now: number): SessionRecord {
  return { ...record, endedAt: now };
}

export function refreshedRecord(
  record: SessionRecord,
  current: CheckoutStates,
  now: number,
): SessionRecord {
  const { refreshPending = [], ...rest } = record;
  const checkouts = { ...record.checkouts };
  refreshPending.forEach((checkout) => {
    const state = current[checkout];
    if (state) checkouts[checkout] = state;
  });
  return { ...rest, recordedAt: now, checkouts };
}

function guardMessage(reason: string): string {
  return `Branch guard: ${reason}`;
}

function checkoutsActedOn(
  target: CommandTarget,
  isActedOn: (action: GitAction) => boolean,
): string[] {
  const checkouts = actionsActedOn(target, isActedOn).map(
    ({ checkout }) => checkout,
  );
  return [...new Set(checkouts)];
}

function actionsActedOn(
  target: CommandTarget,
  isActedOn: (action: GitAction) => boolean,
): GitAction[] {
  return gitActionsOf(target, () => false).filter(isActedOn);
}

// Interim leaves branch moves to the developer, who keeps agents off a branch while it lands.
function denyReasonOf(
  action: GitAction,
  props: BranchGuardInput,
): string | undefined {
  if (action.kind === "branchMove" && props.mode === "strict") {
    return branchMoveDenyReason(action);
  }
  if (action.kind === "commit" && props.mode === "interim") {
    return commitDenyReason(action, props);
  }
  return undefined;
}

function branchMoveDenyReason({ subcommand, checkout }: GitAction): string {
  return `\`git ${subcommand}\` would move the branch of the primary checkout ${checkout}, which stays put; ${workspaceWay}. ${restoreHint}`;
}

function commitDenyReason(
  { checkout }: GitAction,
  { ownCheckouts, currentCheckouts }: BranchGuardInput,
): string | undefined {
  const recorded = ownCheckouts[checkout];
  const current = currentCheckouts[checkout];
  if (!recorded || !current) return undefined;
  // `checkout -b` moves the branch without moving the commit.
  if (recorded.head === current.head && recorded.branch === current.branch) {
    return undefined;
  }
  return `HEAD of ${checkout} moved since this session recorded it (${stateShown(recorded)} → ${stateShown(current)}), so something else moved it and this commit could land on other work. Either ${workspaceWay}, or start a fresh session here once that work is done.`;
}

function stateShown({ branch, head }: CheckoutState): string {
  return `${branch ?? "detached"} at ${head.slice(0, 7)}`;
}

function gitActionsOf(
  { command, cwd, primaryCheckouts }: CommandTarget,
  isExistingPath: BranchGuardInput["isExistingPath"],
): GitAction[] {
  let commands: string[][];
  try {
    commands = ShellParser.init(command).commandWords;
  } catch {
    return [];
  }
  let dir = cwd;
  return commands.flatMap((words) => {
    if (words[0] === "cd") {
      dir = cdTarget(dir, words[1]);
      return [];
    }
    const action = gitActionOf(
      words,
      { command, cwd: dir, primaryCheckouts },
      isExistingPath,
    );
    return action ? [action] : [];
  });
}

function cdTarget(dir: string, target: string | undefined): string {
  if (target === undefined) return homedir();
  if (target === "-") return dir;
  return resolvePath(dir, target);
}

function resolvePath(dir: string, path: string): string {
  if (path === "~" || path.startsWith("~/")) {
    return join(homedir(), path.slice(1));
  }
  return resolve(dir, path);
}

function gitActionOf(
  words: string[],
  { cwd, primaryCheckouts }: CommandTarget,
  isExistingPath: BranchGuardInput["isExistingPath"],
): GitAction | undefined {
  if (words[0] !== "git") return undefined;
  let dir = cwd;
  let i = 1;
  for (; i < words.length; i++) {
    const word = words[i] ?? "";
    if (!word.startsWith("-")) break;
    if (!gitValueOptions.has(word)) continue;
    i++;
    if (word === "-C") dir = resolvePath(dir, words[i] ?? ".");
  }
  const subcommand = words[i];
  if (subcommand === undefined) return undefined;
  const checkout = primaryCheckoutOf(dir, primaryCheckouts);
  if (!checkout) return undefined;
  const kind = kindOf(subcommand, words.slice(i + 1), (path) =>
    isExistingPath(resolvePath(dir, path)),
  );
  return { kind, subcommand, checkout };
}

// The deepest primary checkout holding dir, unless dir is in a worktree nested inside it.
export function primaryCheckoutOf(
  dir: string,
  primaryCheckouts: string[],
): string | undefined {
  const holding = primaryCheckouts
    .filter((checkout) => isInside(dir, checkout))
    .sort((a, b) => b.length - a.length)[0];
  if (!holding) return undefined;
  if (
    nestedWorktreeDirs.some((nested) => isInside(dir, join(holding, nested)))
  ) {
    return undefined;
  }
  return holding;
}

function isInside(path: string, folder: string): boolean {
  const fromFolder = relative(folder, path);
  return (
    fromFolder === "" ||
    (!fromFolder.startsWith("..") && !isAbsolute(fromFolder))
  );
}

function kindOf(
  subcommand: string,
  args: string[],
  isExistingPath: (path: string) => boolean,
): GitActionKind {
  if (subcommand === "commit") return "commit";
  if (subcommand !== "checkout" && subcommand !== "switch") return "other";
  if (args.some((arg) => branchCreatingOptions.has(arg))) return "branchMove";
  if (args.some((arg) => arg === "--" || arg === "-p" || arg === "--patch")) {
    return "other";
  }
  const operands = args.filter((arg) => arg === "-" || !arg.startsWith("-"));
  if (subcommand === "switch") {
    return operands.length > 0 ? "branchMove" : "other";
  }
  // Git's own reading: a ref then paths restores files, and so does a lone operand naming a path.
  const [operand] = operands;
  if (operands.length !== 1 || operand === undefined) return "other";
  return isExistingPath(operand) ? "other" : "branchMove";
}
