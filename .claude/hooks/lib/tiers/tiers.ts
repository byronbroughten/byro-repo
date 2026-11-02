// Decides the gate for a Bash call by tier: 1 and 2 are free (git or Google's version history undoes them), 3 asks. Pure; tierGate.ts does the I/O, and driveTiers.ts decides gworkspace calls.
// The classifiers live in tiers/, a file per subject: git writes, reads, file commands, npm verdicts, interpreters, and the verdicts only a runner step or an Interactive session gets. excludedCommands.ts there refuses a call that keeps an excluded command in the box.
import { ShellParser, type SimpleCommand } from "./ShellParser.ts";
import type { WritePlaces } from "./stepWrites.ts";
import { excludedCommands } from "./tiers/excludedCommands.ts";
import { fileCommands } from "./tiers/fileCommands.ts";
import { gitWrites } from "./tiers/gitWrites.ts";
import { interactiveSession } from "./tiers/interactiveSession.ts";
import { interpreterCommands } from "./tiers/interpreterCommands.ts";
import { npmCommands } from "./tiers/npmCommands.ts";
import { npmVerdicts } from "./tiers/npmVerdicts.ts";
import { PathChecker, writablePlaces } from "./tiers/PathChecker.ts";
import { readCommands } from "./tiers/readCommands.ts";
import { runnerStep } from "./tiers/runnerStep.ts";
import { timeoutWrappedOf } from "./timeoutWrapped.ts";

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
  // The session's sandbox `excludedCommands` entries; absent, no call is refused for keeping one in the box.
  excludedCommands?: string[];
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
  // Allowed only in a command with no heredoc bash may expand, nor $'…', to hide another behind it.
  needsPlainText?: boolean;
  // A runner step's way past the plain-text check, said instead of recording a blocker.
  plainTextFix?: string;
}

// A simple command's words beside its verdict; undefined leaves it to Claude Code.
export interface CommandVerdict {
  words: string[];
  verdict: Verdict | undefined;
}

// One row's rule, or a part of one: its verdict on a simple command, or undefined when the row doesn't match.
type Classifier = (
  simple: SimpleCommand,
  context: CallContext,
) => Verdict | undefined;

// A call keeping an excluded command in the box is refused before any tier row, since it would fail there whatever its tier.
export function gateDecision(call: ShellCall): Decision | undefined {
  const boxRefusal = excludedCommands.refusalOf(
    call.command,
    call.excludedCommands ?? [],
  );
  if (boxRefusal) return gateOf("deny", `${boxRefusal}.`);
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

function baseDecision(call: ShellCall): Decision | undefined {
  const { command, mode } = call;
  const commandVerdicts = commandVerdictsOf(call);
  if (!commandVerdicts) return undefined;
  const verdicts = commandVerdicts.map(({ verdict }) => verdict);
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
  // It strips heredoc bodies and misreads $'…', so either could hide a command or a substitution after one; a body the heredoc scan confirms, behind a quoted delimiter, hides neither.
  if (/<<|\$'/.test(command)) {
    const refusal = plainTextRefusalOf(
      verdicts,
      mode,
      "a heredoc or `$'…'` could hide a command",
    );
    if (refusal) return refusal;
    const { heredocs } = ShellParser.init(command);
    if (!heredocs) return undefined;
    const isPlainText =
      !/\$'/.test(command) && heredocs.every(({ isQuoted }) => isQuoted);
    if (
      !isPlainText &&
      (hasSubstitution || verdicts.some((verdict) => verdict?.needsPlainText))
    ) {
      return undefined;
    }
  }
  if (!verdicts.every((verdict) => verdict?.permissionDecision === "allow")) {
    return undefined;
  }
  return gateOf(
    "allow",
    `${verdicts.map((verdict) => verdict?.why).join("; ")}.`,
  );
}

// Each simple command's own verdict, undefined when the gate can't parse the call; the prompt scan reads them to name the part that asked.
export function commandVerdictsOf({
  command,
  mode,
  dryRuns,
  places,
  spreadsheetTargets = [],
}: ShellCall): CommandVerdict[] | undefined {
  const commands = ShellParser.init(command).parsedCommands;
  if (!commands) return undefined;
  // A `cd` carries on only in an AND list: a failed one stops the command; in a subshell, substitution, pipe or background job it doesn't carry; after `;` or `||` it may have failed.
  const cdCarriesOn = isAndListOf(command);
  // Each folder the command may be in by now, undefined for one the gate can't follow.
  let cwds = [places?.cwd];
  return commands.map((simple) => {
    const verdict = strictestOf(
      cwds.map((cwd) =>
        verdictOf(simple, {
          mode,
          dryRuns,
          places: placesAt(places, cwd),
          spreadsheetTargets,
        }),
      ),
    );
    if (simple.words[0] === "cd") {
      const targets = cwds.map((cwd) =>
        PathChecker.init(placesAt(places, cwd)).cdTargetOf(simple.words[1]),
      );
      cwds = [...new Set(cdCarriesOn ? targets : [...cwds, ...targets])];
    }
    return { words: simple.words, verdict };
  });
}

function isAndListOf(command: string): boolean {
  try {
    return ShellParser.init(command).isAndList;
  } catch {
    return false;
  }
}

function placesAt(
  places: ShellPlaces | undefined,
  cwd: string | undefined,
): ShellPlaces | undefined {
  return places && cwd !== undefined ? { ...places, cwd } : undefined;
}

// A command that may run from more than one folder gets the strictest of its verdicts there.
function strictestOf(verdicts: (Verdict | undefined)[]): Verdict | undefined {
  const strictest =
    verdicts.find((verdict) => verdict?.permissionDecision === "deny") ??
    verdicts.find((verdict) => verdict?.permissionDecision === "ask");
  if (strictest) return strictest;
  return verdicts.includes(undefined) ? undefined : verdicts[0];
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
  return (ShellParser.init(command).parsedCommands ?? []).flatMap(
    ({ words }) => {
      const chore = npmCommands.appChoreOf(words);
      return chore && !chore.isSend ? [chore.name] : [];
    },
  );
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

// The tier table's rules in docs/targets-and-gates.md, in the order they're tried, which isn't the table's; a row may take several entries. The first verdict wins, so the order decides which of two matching rules applies.
const classifiers: Classifier[] = [
  runnerStep.ghVerdictOf,
  runnerStep.liveAliasVerdictOf,
  interactiveSession.ghVerdictOf,
  interactiveSession.decideVerdictOf,
  npmVerdicts.choreSendVerdictOf,
  gitWrites.commitVerdictOf,
  gitWrites.addVerdictOf,
  gitWrites.branchVerdictOf,
  gitWrites.mergeVerdictOf,
  gitWrites.trackedFileVerdictOf,
  runnerStep.restoreVerdictOf,
  readCommands.verdictOf,
  fileCommands.verdictOf,
  gitWrites.pushVerdictOf,
  npmVerdicts.untargetedVerdictOf,
  npmVerdicts.publishVerdictOf,
  npmVerdicts.forcedRemoveVerdictOf,
  npmVerdicts.freeScriptVerdictOf,
  npmVerdicts.npxCheckVerdictOf,
  interpreterCommands.verdictOf,
];
