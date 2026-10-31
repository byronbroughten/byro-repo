// Decides the gate for a Bash call by tier: 1 and 2 are free (git or Google's version history undoes them), 3 asks. Pure; tierGate.ts does the I/O, and driveTiers.ts decides gworkspace calls.
// The classifiers' helpers live in tiers/: git calls, paths, file commands, npm commands and runner-step verdicts.
import {
  npmScriptOf,
  type SimpleCommand,
  substitutedCommandsOf,
} from "./bashReads.ts";
import { GhApiCall } from "./GhApiCall.ts";
import { stdoutFilters } from "./stdoutFilters.ts";
import type { WritePlaces } from "./stepWrites.ts";
import { fileCommands } from "./tiers/fileCommands.ts";
import { GitCall } from "./tiers/GitCall.ts";
import { npmCommands } from "./tiers/npmCommands.ts";
import { PathChecker, writablePlaces } from "./tiers/PathChecker.ts";
import { runnerStep } from "./tiers/runnerStep.ts";

export interface Decision {
  permissionDecision: "allow" | "ask" | "deny";
  reason: string;
}

// A runner step has nobody to answer an ask, so its asks become denials.
export type SessionMode = "interactive" | "runnerStep";

// Set by ClaudeAgentStep.ts, which can't import across the hooks boundary.
export const runnerStepMark = "BYRO_RUNNER_STEP";
export const stepTargetsVariable = "BYRO_STEP_TARGETS";
// How every runner-step denial ends, since nobody is there to give a yes.
export const blockerInstead =
  "record a `denied-tool` blocker for the developer instead";

// Where the call runs, for the write rule and scratch `node`; isIgnored asks the checkout holding a path.
export interface ShellPlaces extends WritePlaces {
  cwd: string;
  isIgnored: (path: string) => boolean;
}

export interface ShellCall {
  command: string;
  mode: SessionMode;
  dryRuns: string[];
  // Absent, no write passes the write rule and no `node` file is scratch.
  places?: ShellPlaces;
  // The spreadsheets (`app`, `dev`) a runner step's ticket targets; absent, it targets none.
  spreadsheetTargets?: string[];
}

// What a simple command's verdict reads beyond its own words; places carries the cwd as of that command.
export interface CallContext {
  mode: SessionMode;
  dryRuns: string[];
  places: ShellPlaces | undefined;
  spreadsheetTargets: string[];
}

// One entry of the targets JSON, unchecked until a reader narrows it.
export interface TargetEntry {
  kind?: unknown;
  name?: unknown;
  id?: unknown;
}

// One simple command's verdict; `why` finishes a sentence about it.
export interface Verdict {
  permissionDecision: Decision["permissionDecision"];
  why: string;
  // Allowed only in a command with no heredoc or $'…' to hide another behind it.
  needsPlainText?: boolean;
  // A runner step's way past the plain-text check, said instead of recording a blocker.
  plainTextFix?: string;
}

// One row's rule, or a part of one: its verdict on a simple command, or undefined when the row doesn't match.
type Classifier = (
  simple: SimpleCommand,
  context: CallContext,
) => Verdict | undefined;

const untargetedPrograms = new Set([
  "clasp",
  "@google/clasp",
  "sheets-framework",
  "@byronbroughten/sheets-framework",
]);
// jq has no option that runs a program or writes a file.
const readPrograms = new Set([
  "grep",
  "rg",
  "cat",
  "head",
  "tail",
  "wc",
  "ls",
  "jq",
]);
const interpreters = {
  nodeScratchFlags: new Set([
    "--experimental-strip-types",
    "--no-warnings",
    "--enable-source-maps",
  ]),
  // `-e`, `-p` and their pairing `-pe`, long forms included.
  nodeInlineFlag: /^(-[ep]{1,2}|--eval|--print)(=|$)/,
  pythonInlineFlag: /^-[a-zA-Z]*c/,
  python: new Set(["python", "python3"]),
  nodeWhy:
    "runs code that isn't a scratch helper: `node` runs only scratch helpers, in `$TMPDIR`, `/tmp` or a gitignored folder of the workspace, and a script being built runs through its tests, or through its `npm run` alias only when that alias is in `freeScripts` in `.claude/hooks/lib/tiers/tiers/npmCommands.ts`; any other script asks",
  // A deny, not an ask: the way through is free, so asking would only interrupt the developer.
  inlineWhy:
    "inline code is refused because the gate can't read it; read JSON with `jq`, or write a scratch helper in `$TMPDIR` and run `node` on it",
} as const;
const findActions = new Set([
  "-exec",
  "-execdir",
  "-ok",
  "-okdir",
  "-delete",
  "-fprint",
  "-fprint0",
  "-fprintf",
  "-fls",
]);
// ripgrep runs the program each of these names.
const rgRunFlags = ["--pre", "--hostname-bin"];

export function gateDecision(call: ShellCall): Decision | undefined {
  const decision = baseDecision(call) ?? undecidedDecision(call);
  return decision && decisionInMode(decision, call.mode);
}

// An Interactive session's unclassified call falls through to Claude Code; a runner step's is refused, as nobody can answer Claude Code's prompt.
function undecidedDecision({ command, mode }: ShellCall): Decision | undefined {
  if (mode === "interactive") return undefined;
  return needsYes(`\`${command}\` is a call the tier gate doesn't classify`);
}

// The spreadsheet names among the targets ClaudeAgentStep.ts hands a runner step.
export function spreadsheetTargetsOf(json: string | undefined): string[] {
  return stepTargetEntriesOf(json).flatMap((target) =>
    target?.kind === "spreadsheet" && typeof target.name === "string"
      ? [target.name]
      : [],
  );
}

// The targets ClaudeAgentStep.ts hands a runner step as JSON; anything unreadable names none, so the step may reach nothing outside the repo.
export function stepTargetEntriesOf(
  json: string | undefined,
): (TargetEntry | null)[] {
  let targets: unknown;
  try {
    targets = JSON.parse(json ?? "[]");
  } catch {
    return [];
  }
  return Array.isArray(targets) ? targets : [];
}

export function sessionModeOf(env: NodeJS.ProcessEnv): SessionMode {
  return env[runnerStepMark] ? "runnerStep" : "interactive";
}

export function decisionInMode(
  decision: Decision,
  mode: SessionMode,
): Decision {
  if (mode === "interactive" || decision.permissionDecision !== "ask") {
    return decision;
  }
  return {
    permissionDecision: "deny",
    reason: `${decision.reason} This is a runner step, so ${blockerInstead}.`,
  };
}

function baseDecision({
  command,
  mode,
  dryRuns,
  places,
  spreadsheetTargets = [],
}: ShellCall): Decision | undefined {
  const commands = parsedCommandsOf(command);
  if (!commands) return undefined;
  // A `cd` carries on only when every separator is `&&`: a failed one stops the command; in a subshell, substitution, pipe or background job it doesn't carry; after `;` or `||` it may have failed.
  const cdCarriesOn = !/[()|;&\n`]/.test(command.replace(/&&|[<>]&|&>/g, ""));
  let cwd = places?.cwd;
  const verdicts = commands.map((simple) => {
    const here = places && cwd !== undefined ? { ...places, cwd } : undefined;
    if (simple.words[0] === "cd") {
      cwd = cdCarriesOn
        ? PathChecker.init(here).cdTargetOf(simple.words[1])
        : undefined;
    }
    return verdictOf(simple, {
      mode,
      dryRuns,
      places: here,
      spreadsheetTargets,
    });
  });
  // The parser reads each command inside `$(…)` and backticks, quoted or not, as a verdict of its own; a runner step's body still goes through `--body-file`, whatever the substitution runs.
  const hasSubstitution = /\$\(|`/.test(command);
  const bodyRefusal = hasSubstitution
    ? plainTextRefusalOf(
        verdicts,
        mode,
        "a backtick or `$(` puts a command's output in the text",
      )
    : undefined;
  if (bodyRefusal) return bodyRefusal;
  const deny = verdicts.find(
    (verdict) => verdict?.permissionDecision === "deny",
  );
  if (deny) return gateOf("deny", `${deny.why}.`);
  const ask = verdicts.find((verdict) => verdict?.permissionDecision === "ask");
  if (ask) {
    return needsYes(`\`${command}\` ${ask.why}`);
  }
  // It strips heredoc bodies and misreads $'…', so either could hide a command or a substitution after one.
  if (
    (hasSubstitution || verdicts.some((verdict) => verdict?.needsPlainText)) &&
    /<<|\$'/.test(command)
  ) {
    return plainTextRefusalOf(
      verdicts,
      mode,
      "a heredoc or `$'…'` could hide a command",
    );
  }
  if (!verdicts.every((verdict) => verdict?.permissionDecision === "allow")) {
    return undefined;
  }
  return gateOf(
    "allow",
    `${verdicts.map((verdict) => verdict?.why).join("; ")}.`,
  );
}

// A runner step told how to retry doesn't halt; any other call stays unclassified.
function plainTextRefusalOf(
  verdicts: (Verdict | undefined)[],
  mode: SessionMode,
  cause: string,
): Decision | undefined {
  const fix = verdicts.find((verdict) => verdict?.plainTextFix)?.plainTextFix;
  if (mode !== "runnerStep" || fix === undefined) return undefined;
  return gateOf("deny", `${cause}, so ${fix}.`);
}

// The chore names a command dry-runs, for the session's dry-run record.
export function dryRunChoresOf(command: string): string[] {
  return (parsedCommandsOf(command) ?? []).flatMap(({ words }) => {
    const chore = npmCommands.appChoreOf(words);
    return chore && !chore.isSend ? [chore.name] : [];
  });
}

function parsedCommandsOf(command: string): SimpleCommand[] | undefined {
  try {
    return substitutedCommandsOf(command);
  } catch {
    return undefined;
  }
}

export function gateOf(
  permissionDecision: Decision["permissionDecision"],
  sentence: string,
): Decision {
  return { permissionDecision, reason: `Tier gate: ${sentence}` };
}

export function needsYes(why: string): Decision {
  return gateOf("ask", `${why}, so it needs a yes.`);
}

// Each redirect's file passes the write rule, or the command asks whatever it runs.
function verdictOf(
  simple: SimpleCommand,
  context: CallContext,
): Verdict | undefined {
  const writeAsk = PathChecker.init(context.places).writeAskAmong(
    simple.outputFiles,
  );
  if (writeAsk) return writeAsk;
  if (simple.words.length === 0) {
    return {
      permissionDecision: "allow",
      why: `a bare redirect writes only ${writablePlaces}`,
      needsPlainText: true,
    };
  }
  return commandVerdictOf(simple, context);
}

// `timeout` is decided on the command it wraps.
function commandVerdictOf(
  simple: SimpleCommand,
  context: CallContext,
): Verdict | undefined {
  const wrapped = timeoutWrappedOf(simple.words);
  if (wrapped) {
    return commandVerdictOf({ ...simple, words: wrapped }, context);
  }
  for (const classifier of classifiers) {
    const verdict = classifier(simple, context);
    if (verdict) return verdict;
  }
  return undefined;
}

// The duration and the timeout's own flags dropped, or undefined when the words aren't a timeout.
function timeoutWrappedOf(words: string[]): string[] | undefined {
  if (words[0] !== "timeout") return undefined;
  let at = 1;
  while ((words[at] ?? "").startsWith("-")) {
    if (["-s", "-k", "--signal", "--kill-after"].includes(words[at] ?? "")) {
      at++;
    }
    at++;
  }
  const wrapped = words.slice(at + 1);
  return wrapped.length > 0 ? wrapped : undefined;
}

// The tier table's rules in docs/targets-and-gates.md, in the order they're tried, which isn't the table's; a row may take several entries. The first verdict wins, so the order decides which of two matching rules applies.
const classifiers: Classifier[] = [
  runnerStep.ghVerdictOf,
  runnerStep.liveAliasVerdictOf,
  sessionGhVerdictOf,
  sessionDecideVerdictOf,
  choreSendVerdictOf,
  commitVerdictOf,
  gitAddVerdictOf,
  branchVerdictOf,
  mergeVerdictOf,
  trackedFileVerdictOf,
  runnerStep.restoreVerdictOf,
  readVerdictOf,
  fileVerdictOf,
  pushVerdictOf,
  untargetedVerdictOf,
  publishVerdictOf,
  forcedRemoveVerdictOf,
  freeScriptVerdictOf,
  npxCheckVerdictOf,
  interpreterVerdictOf,
];

// An Interactive session's issue create, issue links and `gh api` reads; a runner step's stay refused, as its reads go through `issue:read`'s Trusted and Untrusted labels.
function sessionGhVerdictOf(
  { words }: SimpleCommand,
  { mode }: CallContext,
): Verdict | undefined {
  const [program, verb, ...args] = words;
  if (mode !== "interactive" || program !== "gh") return undefined;
  if (verb === "issue" && args[0] === "create") {
    return {
      permissionDecision: "allow",
      why: "`gh issue close` undoes it",
      needsPlainText: true,
    };
  }
  if (verb !== "api") return undefined;
  const call = GhApiCall.init(args);
  if (call?.isRead) {
    return {
      permissionDecision: "allow",
      why: "a `gh api` call with no body only reads",
      needsPlainText: true,
    };
  }
  if (call?.isCommentEdit) {
    return {
      permissionDecision: "allow",
      why: "a further edit undoes an issue comment's edit",
      needsPlainText: true,
    };
  }
  if (!call?.isIssueLink) return undefined;
  return {
    permissionDecision: "allow",
    why: "the opposite `gh api` call undoes an issue link",
    needsPlainText: true,
  };
}

// An Interactive session's review-list decision, free as a raw comment PATCH is; a runner step's stays refused.
function sessionDecideVerdictOf(
  { words }: SimpleCommand,
  { mode }: CallContext,
): Verdict | undefined {
  if (mode !== "interactive" || npmCommands.isPrefixed(words)) return undefined;
  const script = npmScriptOf(words);
  if (script?.name !== "runner") return undefined;
  const [verb] = script.args.filter((arg) => arg !== "--");
  if (verb !== "decide") return undefined;
  return {
    permissionDecision: "allow",
    why: "a further edit undoes a review-list item's decision",
    needsPlainText: true,
  };
}

function choreSendVerdictOf(
  { words }: SimpleCommand,
  { dryRuns }: CallContext,
): Verdict | undefined {
  return npmCommands.choreSendVerdictOf(words, dryRuns);
}

function commitVerdictOf({ words }: SimpleCommand): Verdict | undefined {
  if (GitCall.init(words)?.verb !== "commit") return undefined;
  return { permissionDecision: "allow", why: "git can undo a commit" };
}

function gitAddVerdictOf(simple: SimpleCommand): Verdict | undefined {
  if (plainGitOf(simple)?.verb !== "add") return undefined;
  return {
    permissionDecision: "allow",
    why: "git can undo staging a file",
    needsPlainText: true,
  };
}

function branchVerdictOf(simple: SimpleCommand): Verdict | undefined {
  if (!plainGitOf(simple)?.isBranchChange) return undefined;
  return {
    permissionDecision: "allow",
    why: "git can undo a branch create, copy, rename or upstream change",
    needsPlainText: true,
  };
}

function mergeVerdictOf(simple: SimpleCommand): Verdict | undefined {
  if (!plainGitOf(simple)?.isHookedMerge) return undefined;
  return {
    permissionDecision: "allow",
    why: "git can undo a merge (`git merge --abort`, or a reset to `ORIG_HEAD`)",
    needsPlainText: true,
  };
}

function trackedFileVerdictOf(simple: SimpleCommand): Verdict | undefined {
  if (!plainGitOf(simple)?.isTrackedFileChange) return undefined;
  return {
    permissionDecision: "allow",
    why: "git can undo moving or removing a tracked file",
    needsPlainText: true,
  };
}

// A git call with no global option but a path one, and no env prefix or redirect around it.
function plainGitOf(simple: SimpleCommand): GitCall | undefined {
  const git = GitCall.init(simple.words);
  return git?.isPlain && simple.isBare ? git : undefined;
}

function readVerdictOf(simple: SimpleCommand): Verdict | undefined {
  const readWhy = simple.isBare ? readWhyOf(simple.words) : undefined;
  if (!readWhy) return undefined;
  return { permissionDecision: "allow", why: readWhy, needsPlainText: true };
}

// Programs match by bare name only, since a path could be any program.
function readWhyOf(words: string[]): string | undefined {
  const [program = "", ...args] = words;
  if (program === "cd") return "`cd` changes no file";
  const git = GitCall.init(words);
  if (git) {
    return git.isPlain && git.isRead
      ? `\`git ${git.verb}\` only reads`
      : undefined;
  }
  return isProgramRead(program, args) ? `\`${program}\` only reads` : undefined;
}

function isProgramRead(program: string, args: string[]): boolean {
  const isFilterRead = stdoutFilters.get(program);
  if (isFilterRead) return isFilterRead(args);
  if (program === "find") return !args.some((arg) => findActions.has(arg));
  if (program === "rg") {
    return !args.some((arg) => rgRunFlags.some((flag) => arg.startsWith(flag)));
  }
  if (program === "gh") return args[0] === "label" && args[1] === "list";
  return readPrograms.has(program);
}

// rm, mkdir, cp, mv and sed -i: tier 1 when every path passes the write rule, tier 3 otherwise; a stdout filter that may write or run asks.
function fileVerdictOf(
  { words, isBare }: SimpleCommand,
  { places }: CallContext,
): Verdict | undefined {
  if (!isBare) return undefined;
  const [program = "", ...args] = words;
  const paths = fileCommands.writtenPathsOf(program, args);
  if (paths) {
    const writeAsk = PathChecker.init(places).writeAskAmong(paths);
    if (writeAsk) return writeAsk;
    return {
      permissionDecision: "allow",
      why: `\`${program}\` writes only ${writablePlaces}`,
      needsPlainText: true,
    };
  }
  const isFilterRead = stdoutFilters.get(program);
  if (!isFilterRead || isFilterRead(args)) return undefined;
  return {
    permissionDecision: "ask",
    why: "may write a file or run a command, which the gate can't check",
  };
}

function pushVerdictOf({ words }: SimpleCommand): Verdict | undefined {
  if (GitCall.init(words)?.verb !== "push") return undefined;
  return {
    permissionDecision: "ask",
    why: "pushes outside `npm run wrap-up`, and a push can't be taken back",
  };
}

function untargetedVerdictOf({ words }: SimpleCommand): Verdict | undefined {
  if (!untargetedPrograms.has(npmCommands.programOf(words) ?? "")) {
    return undefined;
  }
  return {
    permissionDecision: "ask",
    why: "names no target; use a `dev:*` or `app:*` script",
  };
}

function publishVerdictOf({ words }: SimpleCommand): Verdict | undefined {
  const isPublish =
    !npmScriptOf(words) &&
    npmCommands.isNpm(words) &&
    words.includes("publish");
  if (!isPublish) return undefined;
  return {
    permissionDecision: "ask",
    why: "publishes a package, which reaches everyone who installs it",
  };
}

// npmScriptOf drops flags, so the raw words are searched for --force.
function forcedRemoveVerdictOf({ words }: SimpleCommand): Verdict | undefined {
  const isForcedRemove =
    npmScriptOf(words)?.name === "issue:remove" && words.includes("--force");
  if (!isForcedRemove) return undefined;
  return {
    permissionDecision: "ask",
    why: "discards a workspace's unlanded work, which git can't bring back",
  };
}

function freeScriptVerdictOf({ words }: SimpleCommand): Verdict | undefined {
  const freeWhy = npmCommands.freeScriptWhyOf(words);
  if (!freeWhy) return undefined;
  return { permissionDecision: "allow", why: freeWhy };
}

// A runner step's `npx tsc` missing only `--noEmit` is refused naming it, as that way through is free; an Interactive session's falls through to Claude Code's allow rules.
function npxCheckVerdictOf(
  { words }: SimpleCommand,
  { mode }: CallContext,
): Verdict | undefined {
  const checkWhy = npmCommands.npxCheckWhyOf(words);
  if (checkWhy) return { permissionDecision: "allow", why: checkWhy };
  const fix =
    mode === "runnerStep" ? npmCommands.npxCheckFixOf(words) : undefined;
  if (!fix) return undefined;
  return { permissionDecision: "deny", why: fix };
}

// node runs a scratch helper, in $TMPDIR, /tmp or gitignored in the workspace, at tier 1; inline code is refused, naming the way through; any other node is tier 3.
function interpreterVerdictOf(
  { words, isBare }: SimpleCommand,
  { places }: CallContext,
): Verdict | undefined {
  if (!isBare) return undefined;
  const [program = "", ...args] = words;
  if (interpreters.python.has(program)) {
    if (args.some((arg) => interpreters.pythonInlineFlag.test(arg))) {
      return { permissionDecision: "deny", why: interpreters.inlineWhy };
    }
    return undefined;
  }
  if (program !== "node") return undefined;
  if (args.length === 1 && (args[0] === "-v" || args[0] === "--version")) {
    return { permissionDecision: "allow", why: "`node --version` only reads" };
  }
  const at = args.findIndex((arg) => !arg.startsWith("-"));
  if (isInlineNode(args, at)) {
    return { permissionDecision: "deny", why: interpreters.inlineWhy };
  }
  const isScratch =
    at >= 0 &&
    args
      .slice(0, at)
      .every((flag) => interpreters.nodeScratchFlags.has(flag)) &&
    PathChecker.init(places).isScratchFile(args[at] ?? "");
  if (!isScratch) {
    return { permissionDecision: "ask", why: interpreters.nodeWhy };
  }
  return {
    permissionDecision: "allow",
    why: "`node` runs a scratch helper",
    needsPlainText: true,
  };
}

// Code passed by flag, or read from stdin when no script is named (`-` included); a flag after the script is the script's own.
function isInlineNode(args: string[], scriptAt: number): boolean {
  if (scriptAt === -1) return true;
  return args
    .slice(0, scriptAt)
    .some((flag) => interpreters.nodeInlineFlag.test(flag));
}
