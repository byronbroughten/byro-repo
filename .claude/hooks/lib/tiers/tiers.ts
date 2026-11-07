// Decides the gate for a Bash call by tier: 1 and 2 are free (git or Google's version history undoes them), 3 asks. Pure; tierGate.ts does the I/O, and driveTiers.ts decides gworkspace calls.
// The classifiers live in tiers/, a file per subject: the raw push, `gh label list`, `ps` and `pgrep`, `open`, npm verdicts, and the verdicts only a runner step or an Interactive session gets. Each matches an `excludedCommands` entry, `gh` or `git push`, as the box frees any other command. excludedCommands.ts there refuses a call that keeps an excluded command in the box.
import { type SandboxOff, sandboxOffWords } from "../sandboxState.ts";
import { ShellParser, type SimpleCommand } from "./ShellParser.ts";
import { excludedCommands } from "./tiers/excludedCommands.ts";
import { gitWrites } from "./tiers/gitWrites.ts";
import { interactiveSession } from "./tiers/interactiveSession.ts";
import { npmCommands } from "./tiers/npmCommands.ts";
import { npmVerdicts } from "./tiers/npmVerdicts.ts";
import { openCommands } from "./tiers/openCommands.ts";
import { readCommands } from "./tiers/readCommands.ts";
import { runnerStep } from "./tiers/runnerStep.ts";
import { sandboxedCalls } from "./tiers/sandboxedCalls.ts";
import { timeoutWrappedOf } from "./timeoutWrapped.ts";
import type { ShellPlaces } from "./WritePathResolver.ts";

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
  // The spreadsheets (`app`, `dev`) a runner step's ticket targets; absent, it targets none.
  spreadsheetTargets?: string[];
  // Where the call runs, for the paths `open` names; absent, every `open` asks.
  places?: ShellPlaces;
  // Absent, no call is refused for keeping an excluded command in the box, and none is freed for running in it.
  sandbox?: CallSandbox;
}

// The session's sandbox as the gate reads it: `isOn` and `off` as `SandboxState` has them, and the `excludedCommands` entries that keep a command in the box, none when it's disabled.
export interface CallSandbox {
  isOn: boolean;
  excludedCommands: string[];
  // Absent, an off sandbox asks for nothing beyond the tier rows.
  off?: SandboxOff;
}

const noSandbox: CallSandbox = { isOn: false, excludedCommands: [] };

// What a simple command's verdict reads beyond its own words.
export interface CallContext {
  mode: SessionMode;
  dryRuns: string[];
  spreadsheetTargets: string[];
  places?: ShellPlaces;
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

// A call keeping an excluded command in the box is refused before any tier row, since it would fail there whatever its tier; one the box runs is then free unless it reaches GitHub, and then only its `gh` and `git push` commands' rows decide.
// With the box off, only a call of excluded commands gets the rows, so a misconfigured box shows up as asks, never as silent freedom.
export function gateDecision(call: ShellCall): Decision | undefined {
  const { isOn, excludedCommands: entries, off } = call.sandbox ?? noSandbox;
  // An off box may not keep anything in, and a layer that can't be parsed must ask, not refuse.
  const boxRefusal = off
    ? undefined
    : excludedCommands.refusalOf(call.command, entries);
  if (boxRefusal) return gateOf("deny", `${boxRefusal}.`);
  const boxCommands = isOn
    ? sandboxedCalls.boxCommandsOf(call.command, entries)
    : undefined;
  const isBoxRun = boxCommands !== undefined;
  if (
    isBoxRun &&
    !boxCommands.some(({ words }) => sandboxedCalls.holdsGitHubCall(words))
  ) {
    return gateOf("allow", sandboxedCalls.reasonOf(call.command));
  }
  const rowsDecision = isBoxRun ? gitHubDecisionOf(call) : baseDecision(call);
  const decision =
    offDecisionOf(call.command, off) ?? rowsDecision ?? undecidedDecision(call);
  return decision && decisionInMode(decision, call.mode);
}

// A box-run call holding `gh` or `git push` gets only those commands' rows; an allow names the box for the rest.
function gitHubDecisionOf(call: ShellCall): Decision | undefined {
  const commandVerdicts = commandVerdictsOf(call);
  if (!commandVerdicts) return undefined;
  const gitHubVerdicts = commandVerdicts.filter(({ words }) =>
    sandboxedCalls.holdsGitHubCall(words),
  );
  const decision = decisionAmong(call, gitHubVerdicts);
  if (
    decision?.permissionDecision !== "allow" ||
    gitHubVerdicts.length === commandVerdicts.length
  ) {
    return decision;
  }
  return {
    ...decision,
    reason: `${decision.reason} ${sandboxedCalls.restReasonOf(call.command)}`,
  };
}

function offDecisionOf(
  command: string,
  off: SandboxOff | undefined,
): Decision | undefined {
  if (!off || excludedCommands.isMadeOf(command, off.excludedCommands)) {
    return undefined;
  }
  const ask = needsYes(
    `\`${command}\` isn't ${sandboxOffWords.madeOfEntries} and ${sandboxOffWords.offClause(off)}`,
  );
  return {
    ...ask,
    reason: `${ask.reason} ${sandboxOffWords.turnBackOn(off)}`,
  };
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
  const commandVerdicts = commandVerdictsOf(call);
  return commandVerdicts && decisionAmong(call, commandVerdicts);
}

function decisionAmong(
  { command, mode }: ShellCall,
  commandVerdicts: CommandVerdict[],
): Decision | undefined {
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
    const parser = ShellParser.init(command);
    if (!parser.heredocs) return undefined;
    if (
      !parser.isPlainText &&
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
  spreadsheetTargets = [],
  places,
}: ShellCall): CommandVerdict[] | undefined {
  const commands = ShellParser.init(command).parsedCommands;
  if (!commands) return undefined;
  const context = { mode, dryRuns, spreadsheetTargets, places };
  return commands.map((simple) => ({
    words: simple.words,
    verdict: commandVerdictOf(simple, context),
  }));
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
  interactiveSession.researchPushVerdictOf,
  npmVerdicts.choreSendVerdictOf,
  readCommands.labelListVerdictOf,
  readCommands.processListVerdictOf,
  openCommands.openVerdictOf,
  gitWrites.pushVerdictOf,
  npmVerdicts.untargetedVerdictOf,
  npmVerdicts.askingFlagVerdictOf,
  npmVerdicts.freeScriptVerdictOf,
];
