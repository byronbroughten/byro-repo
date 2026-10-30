// Decides the gate for a Bash call by tier: 1 and 2 are free (git or Google's version history undoes them), 3 asks. Pure; tierGate.ts does the I/O, and driveTiers.ts decides gworkspace calls.
import { isAbsolute } from "node:path";

import {
  npmScriptOf,
  type SimpleCommand,
  simpleCommandsOf,
} from "./bashReads.ts";
import {
  isSedScriptPrinting,
  sedCallOf,
  stdoutFilters,
} from "./stdoutFilters.ts";
import {
  isStepWritable,
  partsClearOfGit,
  partsInside,
  resolvedPathOf,
  type WritePlaces,
} from "./stepWrites.ts";

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
interface CallContext {
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
interface Verdict {
  permissionDecision: Decision["permissionDecision"];
  why: string;
  // Allowed only in a command with no heredoc or $'…' to hide another behind it.
  needsPlainText?: boolean;
}

// isPlain: no global option but a path one, so no `-c` config can run a command.
interface GitCall {
  verb: string;
  args: string[];
  isPlain: boolean;
}

interface AppChore {
  name: string;
  isSend: boolean;
}

const untargetedPrograms = new Set([
  "clasp",
  "@google/clasp",
  "sheets-framework",
  "@byronbroughten/sheets-framework",
]);
const npmExecVerbs = new Set(["exec", "x"]);
const deployWhy = "a deployment can be rolled back to an earlier version";
const checkWhy = "the repo's checks write nothing git can't undo";
const freeScripts = new Map([
  ["wrap-up", "`npm run wrap-up` is the standing yes to push"],
  ["app:build", "Apps Script keeps the pushed code's version history"],
  ["app:deploy", deployWhy],
  ["dev:deploy", deployWhy],
  ["issue:start", "a workspace it starts comes off with `issue:remove`"],
  ["issue:list", "it only reads the workspaces"],
  ["issue:remove", "a plain remove refuses a workspace holding unlanded work"],
  ["issue:backlink", "a further `gh issue edit` undoes it"],
  ["issue:read", "it only reads an issue"],
  ["issue:promote", "a promoted repo comes off with its workspace"],
  ["check", checkWhy],
  ["tsc", checkWhy],
  ["lint", checkWhy],
  ["test", checkWhy],
]);
// Each check only with no flag that writes a file the write rule never sees.
const npxChecks = new Map<string, (args: string[]) => boolean>([
  [
    "vitest",
    (args) =>
      args[0] === "run" && !args.some((arg) => arg.startsWith("--outputFile")),
  ],
  [
    "tsc",
    (args) =>
      args.includes("--noEmit") &&
      !args.some((arg) => arg === "-b" || arg === "--build"),
  ],
  [
    "eslint",
    (args) =>
      !args.some(
        (arg) =>
          arg.startsWith("--fix") ||
          arg === "-o" ||
          arg.startsWith("--output-file"),
      ),
  ],
  [
    "prettier",
    (args) =>
      args.includes("--check") &&
      !args.some((arg) => arg === "--write" || arg === "-w"),
  ],
]);
const readPrograms = new Set(["grep", "rg", "cat", "head", "tail", "wc", "ls"]);
const gitReadVerbs = new Set([
  "log",
  "show",
  "status",
  "diff",
  "rev-parse",
  "ls-files",
  "blame",
  "merge-base",
  "grep",
]);
// `git grep -O` opens the matched files in a pager, which can be any program.
const gitGrepPagerFlags = /^(-[^-]*O|--open-files-in-pager)/;
const gitFileVerbs = new Set(["mv", "rm"]);
const fileCommands = new Set(["rm", "mkdir", "cp", "mv"]);
const interpreters = {
  nodeScratchFlags: new Set([
    "--experimental-strip-types",
    "--no-warnings",
    "--enable-source-maps",
  ]),
  python: new Set(["python", "python3"]),
  // Gitignored, but an installed package's bin is a tool such as clasp, not a scratch helper.
  installedPackages: "node_modules",
  nodeWhy:
    "runs code that isn't a scratch helper: `node` runs only scratch helpers, in `$TMPDIR` or a gitignored folder of the workspace, and a script being built runs through its tests or its `npm run` alias",
  pythonWhy: "runs inline Python, which no test or `npm run` alias covers",
} as const;
const targetAliases = [
  "chore",
  "gen:configs",
  "probe",
  "build",
  "deploy",
  "configs:diff",
];
// The live aliases each spreadsheet target gives a runner step; runner/src/targetTools.ts mirrors them, as it can't import across the hooks boundary.
const liveAliases = new Map([
  ["app", targetAliases],
  ["dev", [...targetAliases, "push", "run"]],
]);
// A runner step's gh writes; a further edit or comment undoes either.
const ghStepWrites = new Set(["edit", "comment"]);
const gitPathOptions = new Set(["-C", "--git-dir", "--work-tree"]);
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
// Deleting a branch, or forcing one over another, loses commits git can't bring back but by its reflog.
const branchDropFlags = new Set(["--delete", "--force"]);
const branchDropShorthands = /^-[^-]*[dDfMC]/;

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
  // A `cd` carries on only when every separator is `&&`: a failed one stops the command; in a subshell, pipe or background job it doesn't carry; after `;` or `||` it may have failed.
  const cdCarriesOn = !/[()|;&\n]/.test(command.replace(/&&|[<>]&|&>/g, ""));
  let cwd = places?.cwd;
  const verdicts = commands.map((simple) => {
    const here = places && cwd !== undefined ? { ...places, cwd } : undefined;
    if (simple.words[0] === "cd") {
      cwd = cdCarriesOn ? cdTargetOf(cwd, simple.words[1]) : undefined;
    }
    return verdictOf(simple, {
      mode,
      dryRuns,
      places: here,
      spreadsheetTargets,
    });
  });
  const deny = verdicts.find(
    (verdict) => verdict?.permissionDecision === "deny",
  );
  if (deny) return gateOf("deny", `${deny.why}.`);
  const ask = verdicts.find((verdict) => verdict?.permissionDecision === "ask");
  if (ask) {
    return needsYes(`\`${command}\` ${ask.why}`);
  }
  // The parser doesn't look inside quoted substitutions, so one could hide a command.
  if (/\$\(|`/.test(command)) return undefined;
  // It also strips heredoc bodies and misreads $'…', so either could hide a command after one.
  if (
    verdicts.some((verdict) => verdict?.needsPlainText) &&
    /<<|\$'/.test(command)
  ) {
    return undefined;
  }
  if (!verdicts.every((verdict) => verdict?.permissionDecision === "allow")) {
    return undefined;
  }
  return gateOf(
    "allow",
    `${verdicts.map((verdict) => verdict?.why).join("; ")}.`,
  );
}

// The chore names a command dry-runs, for the session's dry-run record.
export function dryRunChoresOf(command: string): string[] {
  return (parsedCommandsOf(command) ?? []).flatMap(({ words }) => {
    const chore = appChoreOf(words);
    return chore && !chore.isSend ? [chore.name] : [];
  });
}

function parsedCommandsOf(command: string): SimpleCommand[] | undefined {
  try {
    return simpleCommandsOf(command);
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

function cdTargetOf(
  cwd: string | undefined,
  target: string | undefined,
): string | undefined {
  // A flag such as `-P` or `--` would be taken for the target.
  if (cwd === undefined || target === undefined || target.startsWith("-")) {
    return undefined;
  }
  return isPlainPath(target) ? absoluteOf(target, cwd) : undefined;
}

// Each redirect's file passes the write rule, or the command asks whatever it runs.
function verdictOf(
  simple: SimpleCommand,
  context: CallContext,
): Verdict | undefined {
  const writeAsk = writeAskAmong(simple.outputFiles, context.places);
  if (writeAsk) return writeAsk;
  if (simple.words.length === 0) {
    return {
      permissionDecision: "allow",
      why: "a bare redirect writes only inside the workspace or `$TMPDIR`",
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
  const { words } = simple;
  const { dryRuns, places } = context;
  const wrapped = timeoutWrappedOf(words);
  if (wrapped) {
    return commandVerdictOf({ ...simple, words: wrapped }, context);
  }
  if (context.mode === "runnerStep") {
    const stepVerdict =
      ghVerdictOf(words) ?? liveAliasVerdictOf(words, context);
    if (stepVerdict) return stepVerdict;
  }
  const chore = appChoreOf(words);
  if (chore?.isSend) return sendVerdictOf(chore.name, dryRuns);
  const git = gitCallOf(words);
  if (git?.verb === "commit") {
    return { permissionDecision: "allow", why: "git can undo a commit" };
  }
  const isPlainGit = git?.isPlain === true && simple.isBare;
  if (isPlainGit && git.verb === "add") {
    return {
      permissionDecision: "allow",
      why: "git can undo staging a file",
      needsPlainText: true,
    };
  }
  if (isPlainGit && isBranchChange(git)) {
    return {
      permissionDecision: "allow",
      why: "git can undo a branch create, copy, rename or upstream change",
      needsPlainText: true,
    };
  }
  if (isPlainGit && isHookedMerge(git)) {
    return {
      permissionDecision: "allow",
      why: "git can undo a merge (`git merge --abort`, or a reset to `ORIG_HEAD`)",
      needsPlainText: true,
    };
  }
  if (isPlainGit && isTrackedFileChange(git)) {
    return {
      permissionDecision: "allow",
      why: "git can undo moving or removing a tracked file",
      needsPlainText: true,
    };
  }
  if (
    isPlainGit &&
    git.verb === "restore" &&
    isOwnStepCheckout(words, context)
  ) {
    return {
      permissionDecision: "allow",
      why: "a runner step's `git restore` changes only its own workspace",
      needsPlainText: true,
    };
  }
  const readWhy = simple.isBare ? readWhyOf(words, git) : undefined;
  if (readWhy) {
    return { permissionDecision: "allow", why: readWhy, needsPlainText: true };
  }
  const fileVerdict = simple.isBare ? fileVerdictOf(words, places) : undefined;
  if (fileVerdict) return fileVerdict;
  if (git?.verb === "push") {
    return {
      permissionDecision: "ask",
      why: "pushes outside `npm run wrap-up`, and a push can't be taken back",
    };
  }
  if (untargetedPrograms.has(programOf(words) ?? "")) {
    return {
      permissionDecision: "ask",
      why: "names no target; use a `dev:*` or `app:*` script",
    };
  }
  const script = npmScriptOf(words);
  if (!script && isNpm(words) && words.includes("publish")) {
    return {
      permissionDecision: "ask",
      why: "publishes a package, which reaches everyone who installs it",
    };
  }
  // npmScriptOf drops flags, so the raw words are searched for --force.
  if (script?.name === "issue:remove" && words.includes("--force")) {
    return {
      permissionDecision: "ask",
      why: "discards a workspace's unlanded work, which git can't bring back",
    };
  }
  // A --prefix runs another folder's scripts under the same name.
  const scriptName = words.some((word) => word.startsWith("--prefix"))
    ? undefined
    : (script?.name ?? npmTestOf(words));
  const freeWhy = scriptName && freeScripts.get(scriptName);
  if (freeWhy) return { permissionDecision: "allow", why: freeWhy };
  if (isNpxCheck(words)) return { permissionDecision: "allow", why: checkWhy };
  return simple.isBare ? interpreterVerdictOf(words, places) : undefined;
}

// `npm test` and `npm t`, which need no `run`.
function npmTestOf(words: string[]): string | undefined {
  if (!isNpm(words)) return undefined;
  const verb = nonFlagsOf(words)[1];
  return verb === "test" || verb === "t" ? "test" : undefined;
}

function isNpxCheck([program, tool = "", ...args]: string[]): boolean {
  if (program !== "npx") return false;
  return npxChecks.get(tool)?.(args) ?? false;
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

// A runner step edits and comments on issues; closing one is the runner's or the developer's, and any other gh call is unclassified.
function ghVerdictOf(words: string[]): Verdict | undefined {
  if (words[0] !== "gh" || words[1] !== "issue") return undefined;
  if (words[2] === "close") {
    return {
      permissionDecision: "ask",
      why: "closes an issue, which only the runner or the developer does",
    };
  }
  if (!ghStepWrites.has(words[2] ?? "")) return undefined;
  return {
    permissionDecision: "allow",
    why: "a further `gh issue edit` or comment undoes it",
    needsPlainText: true,
  };
}

// A runner step runs a live alias only against a spreadsheet its ticket targets.
function liveAliasVerdictOf(
  words: string[],
  { dryRuns, spreadsheetTargets }: CallContext,
): Verdict | undefined {
  const name = npmScriptOf(words)?.name ?? "";
  const [, spreadsheet = "", alias = ""] = /^(\w+):(.+)$/.exec(name) ?? [];
  const aliases = liveAliases.get(spreadsheet);
  if (!aliases) return undefined;
  // A --prefix runs another folder's scripts under the same name.
  if (words.some((word) => word.startsWith("--prefix"))) {
    return {
      permissionDecision: "ask",
      why: "runs another folder's script under a live alias's name",
    };
  }
  if (!spreadsheetTargets.includes(spreadsheet)) {
    return {
      permissionDecision: "ask",
      why: `runs against the \`${spreadsheet}\` spreadsheet, which the ticket doesn't target`,
    };
  }
  if (!aliases.includes(alias)) {
    return {
      permissionDecision: "ask",
      why: `isn't an alias the \`${spreadsheet}\` spreadsheet target gives a step`,
    };
  }
  const chore = appChoreOf(words);
  if (chore?.isSend) return sendVerdictOf(chore.name, dryRuns);
  return {
    permissionDecision: "allow",
    why: `the ticket targets the \`${spreadsheet}\` spreadsheet`,
    needsPlainText: true,
  };
}

// rm, mkdir, cp, mv and sed -i: tier 1 when every path passes the write rule, tier 3 otherwise; a stdout filter that may write or run asks.
function fileVerdictOf(
  words: string[],
  places: ShellPlaces | undefined,
): Verdict | undefined {
  const [program = "", ...args] = words;
  const paths = writtenPathsOf(program, args);
  if (paths) {
    const writeAsk = writeAskAmong(paths, places);
    if (writeAsk) return writeAsk;
    return {
      permissionDecision: "allow",
      why: `\`${program}\` writes only inside the workspace or \`$TMPDIR\``,
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

function writtenPathsOf(program: string, args: string[]): string[] | undefined {
  if (program === "sed") {
    const call = sedCallOf(args);
    if (!call?.isInPlace || !isSedScriptPrinting(call)) return undefined;
    return call.files.length > 0 ? call.files : [""];
  }
  if (!fileCommands.has(program)) return undefined;
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--") {
      paths.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith("--target-directory=")) {
      paths.push(arg.slice("--target-directory=".length));
    } else if (program === "mkdir" && arg === "-m") i++;
    else if (!arg.startsWith("-")) paths.push(arg);
  }
  return paths.length > 0 ? paths : [""];
}

// The ask for the first path that fails the write rule, or undefined when every one passes.
function writeAskAmong(
  paths: string[],
  places: ShellPlaces | undefined,
): Verdict | undefined {
  const blockedPath = paths.find((path) => !isWritablePath(path, places));
  if (blockedPath === undefined) return undefined;
  return {
    permissionDecision: "ask",
    why: `writes \`${blockedPath}\`, which isn't inside the workspace or \`$TMPDIR\`, or is in \`.git\``,
  };
}

// node runs a scratch helper, in $TMPDIR or gitignored in the workspace, at tier 1; any other node or inline python is tier 3.
function interpreterVerdictOf(
  words: string[],
  places: ShellPlaces | undefined,
): Verdict | undefined {
  const [program = "", ...args] = words;
  if (interpreters.python.has(program)) {
    if (args.some((arg) => /^-[a-zA-Z]*c/.test(arg))) {
      return { permissionDecision: "ask", why: interpreters.pythonWhy };
    }
    return undefined;
  }
  if (program !== "node") return undefined;
  if (args.length === 1 && (args[0] === "-v" || args[0] === "--version")) {
    return { permissionDecision: "allow", why: "`node --version` only reads" };
  }
  const at = args.findIndex((arg) => !arg.startsWith("-"));
  const isScratch =
    at >= 0 &&
    args
      .slice(0, at)
      .every((flag) => interpreters.nodeScratchFlags.has(flag)) &&
    isScratchFile(args[at] ?? "", places);
  if (!isScratch) {
    return { permissionDecision: "ask", why: interpreters.nodeWhy };
  }
  return {
    permissionDecision: "allow",
    why: "`node` runs a scratch helper",
    needsPlainText: true,
  };
}

// An existing file gitignored inside the workspace but outside node_modules, or anywhere in $TMPDIR outside .git.
function isScratchFile(
  written: string,
  places: ShellPlaces | undefined,
): boolean {
  if (!places) return false;
  const path = tmpDirExpanded(written, places);
  if (!isPlainPath(path)) return false;
  const resolved = resolvedPathOf(absoluteOf(path, places.cwd), places);
  if (resolved === undefined || places.realPathOf(resolved) === undefined) {
    return false;
  }
  const workspaceParts = partsInside(resolved, places.workspaceRoot, places);
  if (workspaceParts) {
    return (
      !workspaceParts.includes(interpreters.installedPackages) &&
      places.isIgnored(resolved)
    );
  }
  return partsClearOfGit(resolved, places.tmpDir, places) !== undefined;
}

function isWritablePath(
  written: string,
  places: ShellPlaces | undefined,
): boolean {
  if (!places) return false;
  const path = tmpDirExpanded(written, places);
  if (!isPlainPath(path)) return false;
  return isStepWritable(absoluteOf(path, places.cwd), places);
}

// A leading `$TMPDIR` or `${TMPDIR}` is the one variable the gate can follow, since it knows the value.
function tmpDirExpanded(path: string, places: ShellPlaces): string {
  return path.replace(/^(?:\$TMPDIR|\$\{TMPDIR\})(?=\/|$)/, places.tmpDir);
}

// No expansion the gate can't follow: a variable, a glob, braces or `~`.
function isPlainPath(path: string): boolean {
  return path !== "" && !path.startsWith("~") && !/[$`*?[\]{}]/.test(path);
}

// Joined, not resolved, so the write rule walks each `..` through any symlink.
function absoluteOf(path: string, cwd: string): string {
  return isAbsolute(path) ? path : `${cwd}/${path}`;
}

function sendVerdictOf(name: string, dryRuns: string[]): Verdict {
  if (dryRuns.includes(name)) {
    return {
      permissionDecision: "allow",
      why: `this session dry-ran \`${name}\` before sending it`,
    };
  }
  return {
    permissionDecision: "deny",
    why: `this session has no dry run of \`${name}\` to preview the send; run \`npm run app:chore ${name}\` first`,
  };
}

// npm keeps a `--send` before its `--` as its own config, so only one after it reaches the chore.
function appChoreOf(words: string[]): AppChore | undefined {
  const script = npmScriptOf(words);
  if (script?.name !== "app:chore") return undefined;
  const name = script.args.find((arg) => !arg.startsWith("-"));
  if (!name) return undefined;
  const separator = script.args.indexOf("--");
  const isSend =
    separator >= 0 && script.args.slice(separator).includes("--send");
  return { name, isSend };
}

// Programs match by bare name only, since a path could be any program.
function readWhyOf(
  words: string[],
  git: GitCall | undefined,
): string | undefined {
  const [program = "", ...args] = words;
  if (program === "cd") return "`cd` changes no file";
  if (git) {
    return git.isPlain && isGitRead(git)
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
  return readPrograms.has(program);
}

function isGitRead({ verb, args }: GitCall): boolean {
  return (
    gitReadVerbs.has(verb) &&
    !args.some(
      (arg) =>
        arg.startsWith("--output") ||
        (verb === "grep" && gitGrepPagerFlags.test(arg)),
    )
  );
}

function isBranchChange({ verb, args }: GitCall): boolean {
  return (
    verb === "branch" &&
    !args.some(
      (arg) =>
        branchDropFlags.has(arg.split("=")[0] ?? "") ||
        branchDropShorthands.test(arg),
    )
  );
}

// A forced move or removal can overwrite or drop changes git never saw.
function isTrackedFileChange({ verb, args }: GitCall): boolean {
  return (
    gitFileVerbs.has(verb) &&
    !args.some((arg) => arg === "--force" || /^-[^-]*f/.test(arg))
  );
}

// Git takes any unambiguous prefix of `--no-verify`, which skips the merge's hooks.
function isHookedMerge({ verb, args }: GitCall): boolean {
  return verb === "merge" && !args.some((arg) => arg.startsWith("--no-v"));
}

// A runner step's workspace holds only that step's work, so a restore there loses nothing anyone else made.
function isOwnStepCheckout(
  words: string[],
  { mode, places }: CallContext,
): boolean {
  if (mode !== "runnerStep" || !places) return false;
  const pointsElsewhere = words.some((word) =>
    gitPathOptions.has(word.split("=")[0] ?? ""),
  );
  if (pointsElsewhere) return false;
  const cwd = resolvedPathOf(places.cwd, places);
  if (cwd === undefined) return false;
  if (
    cwd === (places.realPathOf(places.workspaceRoot) ?? places.workspaceRoot)
  ) {
    return true;
  }
  return partsClearOfGit(cwd, places.workspaceRoot, places) !== undefined;
}

function gitCallOf(words: string[]): GitCall | undefined {
  if (words[0] !== "git") return undefined;
  let isPlain = true;
  for (let i = 1; i < words.length; i++) {
    const word = words[i] ?? "";
    if (gitPathOptions.has(word)) i++;
    else if (word === "-c") {
      isPlain = false;
      i++;
    } else if (/^--(git-dir|work-tree)=/.test(word) || word === "--no-pager") {
      continue;
    } else if (word.startsWith("-")) isPlain = false;
    else return { verb: word, args: words.slice(i + 1), isPlain };
  }
  return undefined;
}

// The program a command runs, through npx or npm exec, without its path or version.
function programOf(words: string[]): string | undefined {
  let rest = words;
  if (basenameOf(words[0] ?? "") === "npx") rest = words.slice(1);
  else if (isNpm(words) && npmExecVerbs.has(nonFlagsOf(words)[1] ?? "")) {
    rest = words.slice(words.indexOf(nonFlagsOf(words)[1] ?? "") + 1);
  }
  const program = nonFlagsOf(rest)[0];
  if (program === undefined) return undefined;
  return basenameOf(program.replace(/(.)@[^/]*$/, "$1"));
}

function isNpm(words: string[]): boolean {
  return words[0] === "npm" || words[0] === "npm.cmd";
}

function nonFlagsOf(words: string[]): string[] {
  return words.filter((word) => !word.startsWith("-"));
}

// A scoped package keeps its scope; a path keeps only its last part.
function basenameOf(program: string): string {
  if (program.startsWith("@")) return program;
  return program.slice(program.lastIndexOf("/") + 1);
}
