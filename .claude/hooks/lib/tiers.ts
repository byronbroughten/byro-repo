// Decides the gate for a Bash call by tier: 1 and 2 are free (git or Google's version history undoes them), 3 asks. Pure; tierGate.ts does the I/O, and driveTiers.ts decides gworkspace calls.
import {
  npmScriptOf,
  type SimpleCommand,
  simpleCommandsOf,
} from "./bashReads.ts";

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

export interface ShellCall {
  command: string;
  mode: SessionMode;
  dryRuns: string[];
  // This session's claude holds a supervision record, so its gh writes ask.
  supervising?: boolean;
}

// One simple command's verdict; `why` finishes a sentence about it.
interface Verdict {
  permissionDecision: Decision["permissionDecision"];
  why: string;
  isRead?: boolean;
}

// isPlain: no global option but a path one, so no `-c` config can run a command.
interface GitCall {
  verb: string | undefined;
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
const freeScripts = new Map([
  ["wrap-up", "`npm run wrap-up` is the standing yes to push"],
  ["app:build", "Apps Script keeps the pushed code's version history"],
  ["app:deploy", deployWhy],
  ["dev:deploy", deployWhy],
  ["issue:start", "a workspace it starts comes off with `issue:remove`"],
  ["issue:list", "it only reads the workspaces"],
  ["issue:remove", "a plain remove refuses a workspace holding unlanded work"],
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
]);
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
const sedReadFlags = /^-[nEsrz]+$/;
// `12,40p`, `$p` or `/re/p` only: sed's own w and e commands write a file or run one.
const sedPrint = /^(\d+|\$|\/[^/\\]*\/)(,(\d+|\$|\/[^/\\]*\/))?p$/;
const branchListFlags = new Set([
  "--list",
  "--all",
  "--remotes",
  "--verbose",
  "--show-current",
  "--color",
  "--no-color",
  "--column",
  "--no-column",
  "--sort",
  "--format",
  "--ignore-case",
]);
const ghReadVerbs = new Set(["view", "list", "status", "diff", "checks"]);
const ghReadGroups = new Set(["search", "status", "version", "--version"]);
// gh api's shorthand flags that take a value, which ends a cluster such as `-iXPOST`.
const ghApiValueShorthands = new Set(["X", "f", "F", "H", "q", "t", "p"]);
const ghApiFieldFlags = new Set(["--field", "--raw-field", "--input"]);
const ghReadMethods = new Set(["GET", "HEAD"]);
// `gh`, or a path to it, at a command position inside a word, as in `bash -c '… && gh …'` or `$(gh …)`.
const hiddenGh = /(^|[;&|(`\n]|\$\()\s*(\S*\/)?gh(\s|$)/;
const ghWriteWhy =
  "writes to GitHub from a session supervising a run, and the developer approves its exact text";

export function gateDecision(call: ShellCall): Decision | undefined {
  // A runner step is never a supervisor, whatever record its claude holds.
  const supervising = call.mode === "interactive" && call.supervising;
  const decision = baseDecision({ ...call, supervising });
  return decision && decisionInMode(decision, call.mode);
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
  dryRuns,
  supervising,
}: ShellCall): Decision | undefined {
  const commands = parsedCommandsOf(command);
  if (!commands) {
    return supervising && callsGh(command)
      ? needsYes(`\`${command}\` ${ghWriteWhy}`)
      : undefined;
  }
  const verdicts = commands.map((simple) =>
    supervising && ghWriteOf(simple.words)
      ? { permissionDecision: "ask" as const, why: ghWriteWhy }
      : verdictOf(simple, dryRuns),
  );
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
  // It also strips heredoc bodies and misreads $'…', so either could hide a command after a read.
  if (verdicts.some((verdict) => verdict?.isRead) && /<<|\$'/.test(command)) {
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

function verdictOf(
  simple: SimpleCommand,
  dryRuns: string[],
): Verdict | undefined {
  const { words } = simple;
  const chore = appChoreOf(words);
  if (chore?.isSend) return sendVerdictOf(chore.name, dryRuns);
  const git = gitCallOf(words);
  if (git?.verb === "commit") {
    return { permissionDecision: "allow", why: "git can undo a commit" };
  }
  if (git?.verb === "add" && git.isPlain && isBareCommand(simple)) {
    return { permissionDecision: "allow", why: "git can undo staging a file" };
  }
  const readWhy = isBareCommand(simple) ? readWhyOf(words, git) : undefined;
  if (readWhy) {
    return { permissionDecision: "allow", why: readWhy, isRead: true };
  }
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
  const freeWhy = script && freeScripts.get(script.name);
  if (freeWhy) return { permissionDecision: "allow", why: freeWhy };
  return undefined;
}

// Every gh call but a known read writes, and so does a gh this gate can't see into.
function ghWriteOf(words: string[]): boolean {
  const hidesGh = words
    .slice(1)
    .some((word) => basenameOf(word) === "gh" || hiddenGh.test(word));
  if (hidesGh) return true;
  if (basenameOf(words[0] ?? "") !== "gh") return false;
  const [group = "", verb = ""] = words.slice(1);
  if (group === "api") return !isGhApiRead(words.slice(2));
  if (ghReadGroups.has(group)) return false;
  if (group === "auth" && verb === "status") return false;
  return group.startsWith("-") || !ghReadVerbs.has(verb);
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

function isBareCommand({ isBare, writesFile }: SimpleCommand): boolean {
  return isBare && !writesFile;
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
  const isRead =
    (readPrograms.has(program) &&
      !(program === "rg" && args.some((arg) => arg.startsWith("--pre")))) ||
    (program === "sed" && isSedRead(args)) ||
    (program === "find" && !args.some((arg) => findActions.has(arg)));
  return isRead ? `\`${program}\` only reads` : undefined;
}

function isGitRead({ verb = "", args }: GitCall): boolean {
  if (verb === "branch") return isBranchList(args);
  return (
    gitReadVerbs.has(verb) && !args.some((arg) => arg.startsWith("--output"))
  );
}

// A branch name without --list creates that branch, so only a list reads.
function isBranchList(args: string[]): boolean {
  const flags = args.filter((arg) => arg.startsWith("-"));
  const isList = flags.some(
    (flag) => flag === "--list" || /^-[arvi]*l[arvil]*$/.test(flag),
  );
  return (
    flags.every(isBranchListFlag) && (isList || flags.length === args.length)
  );
}

function isBranchListFlag(flag: string): boolean {
  return (
    /^-[arvil]+$/.test(flag) || branchListFlags.has(flag.split("=")[0] ?? "")
  );
}

function isSedRead(args: string[]): boolean {
  let isQuiet = false;
  const scripts: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "-e") scripts.push(args[++i] ?? "");
    else if (arg === "--quiet" || arg === "--silent") isQuiet = true;
    else if (sedReadFlags.test(arg)) isQuiet ||= arg.includes("n");
    else if (arg.startsWith("-") && arg !== "-") return false;
    else rest.push(arg);
  }
  if (scripts.length === 0) scripts.push(rest[0] ?? "");
  return (
    isQuiet &&
    scripts.every((script) =>
      script
        .split(/[;\n]/)
        .map((piece) => piece.trim())
        .every((piece) => sedPrint.test(piece)),
    )
  );
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
  return { verb: undefined, args: [], isPlain: false };
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
