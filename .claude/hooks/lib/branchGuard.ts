// Decides the branch guard: keeps sessions sharing a primary checkout from moving its branch or HEAD under each other. Pure; branchGuard.ts and branchRecord.ts do the I/O.
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

import { commandWordsOf } from "./bashReads.ts";

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

export interface BranchCommand {
  command: string;
  cwd: string;
  mode: GuardMode;
  primaryCheckouts: string[];
  ownCheckouts: CheckoutStates;
  otherLiveSessions: SessionRecord[];
  currentCheckouts: CheckoutStates;
}

export interface BranchDecision {
  permissionDecision: "allow" | "deny";
  reason: string;
}

type GitActionKind = "branchMove" | "commit" | "other";

interface GitAction {
  kind: GitActionKind;
  subcommand: string;
  // The primary checkout acted on.
  checkout: string;
}

// Git worktrees nested inside a primary checkout act on their own HEAD, not the primary's.
const recordLifetimeMs = 24 * 60 * 60 * 1000;
const nestedWorktreeDirs = [".claude/worktrees"];
// Global options that take the next word as their value.
const gitValueOptions = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"]);
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
const wayThrough = {
  workspace: "work the ticket in its issue workspace (`npm run issue:list`), where branches are the workspace's own",
};

export function branchDecision(props: BranchCommand): BranchDecision {
  for (const action of gitActionsOf(props.command, props.cwd, props.primaryCheckouts)) {
    const reason = denyReasonOf(action, props);
    if (reason) return { permissionDecision: "deny", reason };
  }
  return { permissionDecision: "allow", reason: "Branch guard: nothing here moves a branch or HEAD under another session." };
}

// The primary checkouts whose HEAD the command may move, so the session can re-record them.
export function headMovingCheckouts(command: string, cwd: string, primaryCheckouts: string[]): string[] {
  const checkouts = gitActionsOf(command, cwd, primaryCheckouts)
    .filter(({ subcommand }) => headMovingSubcommands.has(subcommand))
    .map(({ checkout }) => checkout);
  return [...new Set(checkouts)];
}

export function isLive({ endedAt, recordedAt }: SessionRecord, now: number): boolean {
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

export function refreshedRecord(record: SessionRecord, current: CheckoutStates, now: number): SessionRecord {
  const { refreshPending = [], ...rest } = record;
  const checkouts = { ...record.checkouts };
  refreshPending.forEach((checkout) => {
    const state = current[checkout];
    if (state) checkouts[checkout] = state;
  });
  return { ...rest, recordedAt: now, checkouts };
}

function denyReasonOf(action: GitAction, props: BranchCommand): string | undefined {
  if (action.kind === "branchMove") return branchMoveDenyReason(action, props);
  if (action.kind === "commit" && props.mode === "interim") return commitDenyReason(action, props);
  return undefined;
}

function branchMoveDenyReason(
  { subcommand, checkout }: GitAction,
  { mode, otherLiveSessions, currentCheckouts }: BranchCommand,
): string | undefined {
  const restoreHint = "A file restore is `git checkout -- <path>`.";
  if (mode === "strict") {
    return `Branch guard: \`git ${subcommand}\` would move the branch of the primary checkout ${checkout}, which stays put; ${wayThrough.workspace}. ${restoreHint}`;
  }
  const branch = currentCheckouts[checkout]?.branch;
  if (branch === undefined) return undefined;
  const sessionIds = otherLiveSessions
    .filter(({ checkouts }) => checkouts[checkout]?.branch === branch)
    .map(({ sessionId }) => sessionId);
  if (sessionIds.length === 0) return undefined;
  return `Branch guard: \`git ${subcommand}\` would move ${checkout} off \`${branch}\`, which live session ${sessionIds.join(", ")} is on. Either ${wayThrough.workspace}, or wait for that session to end. ${restoreHint}`;
}

function commitDenyReason(
  { checkout }: GitAction,
  { ownCheckouts, currentCheckouts }: BranchCommand,
): string | undefined {
  const recorded = ownCheckouts[checkout];
  const current = currentCheckouts[checkout];
  if (!recorded || !current || recorded.head === current.head) return undefined;
  return `Branch guard: HEAD of ${checkout} moved since this session recorded it (${stateShown(recorded)} → ${stateShown(current)}), so another session moved it and this commit could land on its work. Either ${wayThrough.workspace}, or wait for the other session to end and start a fresh session here.`;
}

function stateShown({ branch, head }: CheckoutState): string {
  return `${branch ?? "detached"} at ${head.slice(0, 7)}`;
}

function gitActionsOf(command: string, cwd: string, primaryCheckouts: string[]): GitAction[] {
  let commands: string[][];
  try {
    commands = commandWordsOf(command);
  } catch {
    return [];
  }
  let dir = cwd;
  return commands.flatMap((words) => {
    if (words[0] === "cd") {
      dir = cdTarget(dir, words[1]);
      return [];
    }
    const action = gitActionOf(words, dir, primaryCheckouts);
    return action ? [action] : [];
  });
}

function cdTarget(dir: string, target: string | undefined): string {
  if (target === undefined) return homedir();
  if (target === "-") return dir;
  return resolvePath(dir, target);
}

function resolvePath(dir: string, path: string): string {
  if (path === "~" || path.startsWith("~/")) return join(homedir(), path.slice(1));
  return resolve(dir, path);
}

function gitActionOf(words: string[], cwd: string, primaryCheckouts: string[]): GitAction | undefined {
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
  return { kind: kindOf(subcommand, words.slice(i + 1)), subcommand, checkout };
}

// The deepest primary checkout holding dir, unless dir is in a worktree nested inside it.
function primaryCheckoutOf(dir: string, primaryCheckouts: string[]): string | undefined {
  const holding = primaryCheckouts
    .filter((checkout) => isInside(dir, checkout))
    .sort((a, b) => b.length - a.length)[0];
  if (!holding) return undefined;
  if (nestedWorktreeDirs.some((nested) => isInside(dir, join(holding, nested)))) return undefined;
  return holding;
}

function isInside(path: string, folder: string): boolean {
  const fromFolder = relative(folder, path);
  return fromFolder === "" || (!fromFolder.startsWith("..") && !isAbsolute(fromFolder));
}

function kindOf(subcommand: string, args: string[]): GitActionKind {
  if (subcommand === "commit") return "commit";
  if (subcommand === "switch") return args.length > 0 ? "branchMove" : "other";
  if (subcommand !== "checkout") return "other";
  if (args.includes("--") || args.some((arg) => arg === "-p" || arg === "--patch")) return "other";
  return args.length > 0 ? "branchMove" : "other";
}
