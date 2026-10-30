// Reads a run state or facts file saved by an older runner into today's shapes, the one place old names are known:
// before #297 Propose was Defer and Proposals were `defers`; before #364 resolve was the `triage` and `fix` steps,
// a fresh resolver was `triage`, and its records, session and base were `triage`, `triageSession` and `fixBase`;
// before #367 a facts file's sessions shared one ticket-level account and config folder, and a run state's had neither;
// before #473 a run state kept the latest step's config folder on the ticket, which a session with none takes.
// SpecRun/SpecRunBase.ts reads run state through runStateOf(), and FactsFile.ts reads facts through factsOf().

import type { WrapUpFacts } from "./FactsFile.ts";
import type { Halt } from "./halts.ts";
import type { ReviewFixes } from "./outcomeLog.ts";
import type { ResolveRecord } from "./resolveStep.ts";
import type {
  Heads,
  Resolver,
  RunState,
  TicketSession,
  TicketState,
  TicketStep,
} from "./SpecRun/runState.ts";
import type {
  RecordedSession,
  StepAgent,
  StepSession,
} from "./transcriptFacts.ts";
import type { Verdict } from "./verdicts.ts";

type SavedStepAgent = StepAgent | "triage" | "fix";

interface SavedStepSession extends Omit<StepSession, "agent"> {
  agent: SavedStepAgent;
}

type SavedRecordedSession = SavedStepSession &
  Omit<RecordedSession, keyof StepSession>;

type SavedTicketSessions =
  | { steps: SavedRecordedSession[] }
  | { account: number; configFolder: string; steps: SavedStepSession[] };

interface SavedResolveRecord extends Omit<ResolveRecord, "verdict"> {
  verdict: Verdict | "defer";
}

type SavedTicketStep = TicketStep | SavedStepAgent;

interface SavedTicketState extends Omit<
  TicketState,
  "step" | "resolveRecords" | "resolver" | "crashes" | "sessions"
> {
  step: SavedTicketStep;
  resolveRecords?: SavedResolveRecord[];
  resolver?: Resolver;
  crashes?: Partial<Record<SavedTicketStep, number>>;
  sessions: (SavedStepSession & Omit<TicketSession, keyof StepSession>)[];
  triage?: SavedResolveRecord[];
  fixer?: "implementer" | "triage";
  triageSession?: string;
  fixBase?: Heads;
  configFolder?: string;
}

interface SavedHalt extends Omit<Halt, "failedStep"> {
  failedStep?: Halt["failedStep"] | SavedStepAgent;
}

interface SavedRunState extends Omit<RunState, "tickets" | "halts"> {
  tickets: Record<string, SavedTicketState>;
  halts?: SavedHalt[];
}

interface SavedFacts extends Omit<
  Partial<WrapUpFacts>,
  "reviewFixes" | "sessions"
> {
  defers?: number;
  reviewFixes?: ReviewFixes | "triage";
  sessions?: SavedTicketSessions;
}

export function runStateOf(parsed: unknown): RunState {
  const saved = parsed as SavedRunState;
  const tickets = Object.fromEntries(
    Object.entries(saved.tickets).map(([key, ticket]) => [
      key,
      ticketStateOf(ticket),
    ]),
  );
  const halts = saved.halts?.map(({ failedStep, ...halt }) => ({
    ...halt,
    failedStep: failedStep === undefined ? undefined : stepOf(failedStep),
  }));
  return { ...saved, tickets, halts };
}

export function factsOf(parsed: unknown): Partial<WrapUpFacts> {
  const { defers, reviewFixes, sessions, ...rest } = parsed as SavedFacts;
  const facts: Partial<WrapUpFacts> = rest;
  if (defers !== undefined) facts.proposals ??= defers;
  if (reviewFixes !== undefined) facts.reviewFixes = resolverOf(reviewFixes);
  if (sessions !== undefined) facts.sessions = { steps: stepsOf(sessions) };
  return facts;
}

function stepsOf(sessions: SavedTicketSessions): RecordedSession[] {
  if (!("configFolder" in sessions)) {
    return sessions.steps.map((step) => ({ ...step, ...sessionOf(step) }));
  }
  const { account, configFolder, steps } = sessions;
  return steps.map((step) => ({ ...sessionOf(step), account, configFolder }));
}

function ticketStateOf({
  step,
  resolveRecords,
  resolver,
  crashes,
  sessions,
  triage,
  fixer,
  triageSession,
  fixBase,
  configFolder,
  ...ticket
}: SavedTicketState): TicketState {
  const state: TicketState = {
    ...ticket,
    step: stepOf(step),
    sessions: sessions.map((session) => {
      const saved = { ...session, ...sessionOf(session) };
      const folder = session.configFolder ?? configFolder;
      return folder === undefined ? saved : { ...saved, configFolder: folder };
    }),
  };
  const records = resolveRecords ?? triage;
  if (records !== undefined) state.resolveRecords = records.map(recordOf);
  const savedResolver = resolver ?? fixer;
  if (savedResolver !== undefined) state.resolver = resolverOf(savedResolver);
  // A state saved before the fresh resolver's session was kept names it only in its sessions.
  const freshSession =
    triageSession ??
    sessions.findLast(({ agent }) => agent === "triage")?.sessionId;
  if (freshSession !== undefined) state.resolverSession ??= freshSession;
  if (fixBase !== undefined) state.resolveBase ??= fixBase;
  if (crashes !== undefined) state.crashes = crashCountsOf(crashes);
  return state;
}

function crashCountsOf(
  crashes: Partial<Record<SavedTicketStep, number>>,
): Partial<Record<TicketStep, number>> {
  return Object.entries(crashes).reduce<Partial<Record<TicketStep, number>>>(
    (counts, [step, count]) => {
      const key = stepOf(step as SavedTicketStep) as TicketStep;
      counts[key] = (counts[key] ?? 0) + (count ?? 0);
      return counts;
    },
    {},
  );
}

function stepOf<SV extends string>(
  step: SV | "triage" | "fix",
): SV | "resolve" {
  return step === "triage" || step === "fix" ? "resolve" : step;
}

function resolverOf<RV extends string>(resolver: RV | "triage"): RV | "fresh" {
  return resolver === "triage" ? "fresh" : resolver;
}

function sessionOf({ agent, sessionId }: SavedStepSession): StepSession {
  return { agent: stepOf(agent), sessionId };
}

function recordOf({ verdict, ...record }: SavedResolveRecord): ResolveRecord {
  return { ...record, verdict: verdict === "defer" ? "propose" : verdict };
}
