// Decides the gate for a Bash call by tier: 1 and 2 are free (git or Google's version history undoes them), 3 asks. Pure; tierGate.ts does the I/O, and driveTiers.ts decides gworkspace calls.
import { isAbsolute } from "node:path";

import {
  npmScriptOf,
  type SimpleCommand,
  simpleCommandsOf,
} from "./bashReads.ts";
import {
  isSedScriptPrinting,
  isStdoutFilter,
  sedCallOf,
  stdoutFilters,
} from "./stdoutFilters.ts";
import {
  isStepWritable,
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
  // This session's claude holds a supervision record, so its gh writes ask.
  supervising?: boolean;
  // Absent, no write passes the write rule and no `node` file is scratch.
  places?: ShellPlaces;
}

// What a simple command's verdict reads beyond its own words; places carries the cwd as of that command.
interface CallContext {
  mode: SessionMode;
  dryRuns: string[];
  places: ShellPlaces | undefined;
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
const npxChecks = new Map<string, (args: string[]) => boolean>([
  ["vitest", (args) => args[0] === "run"],
  ["tsc", () => true],
  ["eslint", () => true],
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
]);
const gitFileVerbs = new Set(["mv", "rm"]);
const fileCommands = new Set(["rm", "mkdir", "cp", "mv"]);
const interpreters = {
  nodeScratchFlags: new Set([
    "--experimental-strip-types",
    "--no-warnings",
    "--enable-source-maps",
  ]),
  python: new Set(["python", "python3"]),
  nodeWhy:
    "runs code that isn't a scratch helper: `node` runs only scratch helpers, in `$TMPDIR` or a gitignored folder of the workspace, and a script being built runs through its tests or its `npm run` alias",
  pythonWhy: "runs inline Python, which no test or `npm run` alias covers",
} as const;
// Claude Code's allow rules still decide a step's gh writes and the live aliases its targets give it.
const leftToAllowRules = /\bgh\b|\bnpm run (?:-s )?(?:app|dev):/;
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
const ghReadVerbs = new Set(["view", "list", "status", "diff", "checks"]);
const ghReadGroups = new Set(["search", "status", "version", "--version"]);
// gh api's shorthand flags that take a value, which ends a cluster such as `-iXPOST`.
const ghApiValueShorthands = new Set(["X", "f", "F", "H", "q", "t", "p"]);
const ghApiFieldFlags = new Set(["--field", "--raw-field", "--input"]);
const ghReadMethods = new Set(["GET", "HEAD"]);
// A quoted gh is text unless a shell's -c, eval or a substitution runs it.
const shellRunners = {
  shells: new Set(["bash", "sh", "zsh", "dash", "ksh"]),
  scriptFlag: /^-[a-zA-Z]*c/,
  substitutionOpen: /\$\(|`/,
} as const;
const ghWriteWhy =
  "writes to GitHub from a session supervising a run, and the developer approves its exact text";

export function gateDecision(call: ShellCall): Decision | undefined {
  // A runner step is never a supervisor, whatever record its claude holds.
  const supervising = call.mode === "interactive" && call.supervising;
  const decision =
    baseDecision({ ...call, supervising }) ?? undecidedDecision(call);
  return decision && decisionInMode(decision, call.mode);
}

// An Interactive session's unclassified call falls through to Claude Code; a runner step's is refused, as nobody can answer Claude Code's prompt.
function undecidedDecision({ command, mode }: ShellCall): Decision | undefined {
  if (mode === "interactive" || leftToAllowRules.test(command)) {
    return undefined;
  }
  return needsYes(`\`${command}\` is a call the tier gate doesn't classify`);
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

// Cheap enough for every Bash call, so the hook reads the supervision record only when this is true.
export function callsGh(command: string): boolean {
  return /\bgh\b/.test(command);
}

function baseDecision({
  command,
  mode,
  dryRuns,
  supervising,
  places,
}: ShellCall): Decision | undefined {
  const commands = parsedCommandsOf(command);
  if (!commands) {
    return supervising && callsGh(command)
      ? needsYes(`\`${command}\` ${ghWriteWhy}`)
      : undefined;
  }
  // A `cd` inside a subshell or a pipe doesn't carry on, so after one there the cwd is unknown.
  const cdCarriesOn = !/[()|]/.test(command);
  let cwd = places?.cwd;
  const verdicts = commands.map((simple) => {
    const here = places && cwd !== undefined ? { ...places, cwd } : undefined;
    if (simple.words[0] === "cd") {
      cwd = cdCarriesOn ? cdTargetOf(cwd, simple.words[1]) : undefined;
    }
    return supervising && ghWriteOf(simple.words)
      ? { permissionDecision: "ask" as const, why: ghWriteWhy }
      : verdictOf(simple, { mode, dryRuns, places: here });
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
  if (cwd === undefined || target === undefined || target === "-") {
    return undefined;
  }
  return isPlainPath(target) ? absoluteOf(target, cwd) : undefined;
}

// Each redirect's file passes the write rule, or the command asks whatever it runs.
function verdictOf(
  simple: SimpleCommand,
  context: CallContext,
): Verdict | undefined {
  const blocked = simple.outputFiles.find(
    (file) => !isWritablePath(file, context.places),
  );
  if (blocked !== undefined) return writeAskOf(blocked);
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

// rm, mkdir, cp, mv and sed -i: tier 1 when every path passes the write rule, tier 3 otherwise; a stdout filter that may write or run asks.
function fileVerdictOf(
  words: string[],
  places: ShellPlaces | undefined,
): Verdict | undefined {
  const [program = "", ...args] = words;
  const paths = writtenPathsOf(program, args);
  if (paths) {
    const blocked = paths.find((path) => !isWritablePath(path, places));
    if (blocked !== undefined) return writeAskOf(blocked);
    return {
      permissionDecision: "allow",
      why: `\`${program}\` writes only inside the workspace or \`$TMPDIR\``,
      needsPlainText: true,
    };
  }
  if (!stdoutFilters.has(program) || isStdoutFilter(program, args)) {
    return undefined;
  }
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

function writeAskOf(path: string): Verdict {
  return {
    permissionDecision: "ask",
    why: `writes \`${path}\`, which isn't inside the workspace or \`$TMPDIR\`, or is in \`.git\``,
  };
}

// node runs a scratch helper, in $TMPDIR or gitignored in the workspace, at tier 1; any other node or inline python is tier 3.
function interpreterVerdictOf(
  words: string[],
  places: ShellPlaces | undefined,
): Verdict | undefined {
  const [program = "", ...args] = words;
  if (interpreters.python.has(program)) {
    return args.some((arg) => /^-[a-zA-Z]*c/.test(arg))
      ? { permissionDecision: "ask", why: interpreters.pythonWhy }
      : undefined;
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

// An existing file gitignored inside the workspace, or anywhere in $TMPDIR outside .git.
function isScratchFile(path: string, places: ShellPlaces | undefined): boolean {
  if (!places || !isPlainPath(path)) return false;
  const resolved = resolvedPathOf(absoluteOf(path, places.cwd), places);
  if (resolved === undefined || places.realPathOf(resolved) === undefined) {
    return false;
  }
  if (partsInside(resolved, places.workspaceRoot, places)) {
    return places.isIgnored(resolved);
  }
  const tmpParts = partsInside(resolved, places.tmpDir, places);
  return tmpParts !== undefined && !tmpParts.includes(".git");
}

function isWritablePath(
  path: string,
  places: ShellPlaces | undefined,
): boolean {
  if (!places || !isPlainPath(path)) return false;
  return isStepWritable(absoluteOf(path, places.cwd), places);
}

// No expansion the gate can't follow: a variable, a glob, braces or `~`.
function isPlainPath(path: string): boolean {
  return path !== "" && !path.startsWith("~") && !/[$`*?[\]{}]/.test(path);
}

// Joined, not resolved, so the write rule walks each `..` through any symlink.
function absoluteOf(path: string, cwd: string): string {
  return isAbsolute(path) ? path : `${cwd}/${path}`;
}

// Every gh call but a known read writes, and so does a gh this gate can't see into.
function ghWriteOf(words: string[]): boolean {
  const hidesGh =
    words.slice(1).some((word) => basenameOf(word) === "gh") ||
    shellScriptsOf(words).some(callsGh) ||
    words.flatMap(substitutionsOf).some(callsGh);
  if (hidesGh) return true;
  if (basenameOf(words[0] ?? "") !== "gh") return false;
  const [group = "", verb = ""] = words.slice(1);
  if (group === "api") return !isGhApiRead(words.slice(2));
  if (ghReadGroups.has(group)) return false;
  if (group === "auth" && verb === "status") return false;
  return group.startsWith("-") || !ghReadVerbs.has(verb);
}

// Found anywhere in the words, so a wrapper such as `env -i`, `xargs` or `find -exec` can't hide the shell.
function shellScriptsOf(words: string[]): string[] {
  return words.flatMap((word, at) => {
    const rest = words.slice(at + 1);
    if (word === "eval") return rest;
    if (!shellRunners.shells.has(basenameOf(word))) return [];
    return rest.some((arg) => shellRunners.scriptFlag.test(arg)) ? rest : [];
  });
}

// The text after each `$(` or backtick the parser kept inside a quoted word.
function substitutionsOf(word: string): string[] {
  return word.split(shellRunners.substitutionOpen).slice(1);
}

// gh api sends a POST once it has a field, unless a method says otherwise; graphql is always a POST.
function isGhApiRead(args: string[]): boolean {
  let method: string | undefined;
  let hasFields = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "graphql") return false;
    if (arg.startsWith("--")) {
      const [name = "", value] = arg.split(/=(.*)/s);
      const isField = ghApiFieldFlags.has(name);
      if (name !== "--method" && !isField) continue;
      const flagValue = value ?? args[++i];
      if (isField) hasFields = true;
      else method = flagValue;
      continue;
    }
    if (!arg.startsWith("-")) continue;
    // Each shorthand is one flag, until one that takes a value, which is the rest or the next word.
    for (let at = 1; at < arg.length; at++) {
      const shorthand = arg[at] ?? "";
      if (!ghApiValueShorthands.has(shorthand)) continue;
      const flagValue = arg.slice(at + 1) || args[++i];
      if (shorthand === "X") method = flagValue;
      if (shorthand === "f" || shorthand === "F") hasFields = true;
      break;
    }
  }
  if (method !== undefined) return ghReadMethods.has(method.toUpperCase());
  return !hasFields;
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
  if (stdoutFilters.has(program)) return isStdoutFilter(program, args);
  if (program === "find") return !args.some((arg) => findActions.has(arg));
  if (program === "rg") {
    return !args.some((arg) => rgRunFlags.some((flag) => arg.startsWith(flag)));
  }
  return readPrograms.has(program);
}

function isGitRead({ verb, args }: GitCall): boolean {
  return (
    gitReadVerbs.has(verb) && !args.some((arg) => arg.startsWith("--output"))
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
  const parts = partsInside(cwd, places.workspaceRoot, places);
  return parts !== undefined && !parts.includes(".git");
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
