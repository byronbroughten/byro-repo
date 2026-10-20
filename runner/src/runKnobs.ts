// Every knob a run reads, typed and defaulted here; a repo overrides them in one JSON file that loadRunKnobs() lays over these.
// SpecRun.ts reads them for a run; byro-repo's context-nudge hook reads the ticket budget and handoff doc through runKnobsOrDefaults().

import { readFileSync } from "node:fs";

import type { Pair } from "./AgentStep.ts";

export type Command = [string, ...string[]];

export interface StepKnobs<VL extends number | string[]> {
  implement: VL;
  review: VL;
  triage: VL;
  fix: VL;
  gapCheck: VL;
}

// The steps a run launches, each with its own knobs.
export type KnobbedStep = keyof StepKnobs<number>;

// When the developer is pushed about the review list: once as the run ends, or as each ticket's comment is posted.
export type ReviewListCadence = "end-of-run" | "per-ticket";

export interface RunKnobs {
  // Repo name to its clone's path relative to the primary root; the root repo's is ".".
  clonePaths: Record<string, string>;
  // The cswap account every step runs as.
  account: number;
  skillNames: { review: string };
  // Run from a workspace or primary root: after review in each ticket, and in a master set when they go red in a ticket.
  checks: Command[];
  // Each must exit 0 at preflight; unset, GitHub auth and the configured account's claude login.
  authChecks: Command[];
  allowedTools: StepKnobs<string[]>;
  // Workspace-relative globs under the protected .claude/ that a step's Edit or Write may still change.
  allowedWriteGlobs: string[];
  maxTurns: StepKnobs<number>;
  // A step whose stream stays silent this long, or that runs past its wall clock, is killed as hung.
  silenceTimeoutMs: number;
  wallClockMs: StepKnobs<number>;
  // How many times a crashed step or red checks are retried before a Failure Halt.
  retriesPerFailure: number;
  // The turns a `resume +N turns` answer with no N gives an implementer that hit its turn cap.
  extraTurns: number;
  // The resumed implementer fixes the Fix batch only while its peak context is under this.
  ticketBudget: number;
  // A fixer whose context crosses this is killed and its batch handed to the triage agent.
  liveCeiling: number;
  // Finding triage's pair; the triage agent fixes on the stronger of it and the ticket's.
  triagePair: Pair;
  gapCheckPair: Pair;
  reviewListCadence: ReviewListCadence;
  // How often an idle run reads the spec issue for answers and its tickets for released leases.
  idlePollMs: number;
  // Named in the context nudge's message; unset, the message says to write a handoff with no link.
  handoffDocPath?: string;
}

const defaultAccount = 1;
const minuteMs = 60_000;

function authChecksOf(account: number): Command[] {
  return [
    ["gh", "auth", "status"],
    ["cswap", "run", String(account), "--", "auth", "status"],
  ];
}

export const defaultRunKnobs: RunKnobs = {
  clonePaths: {},
  account: defaultAccount,
  skillNames: { review: "code-review" },
  checks: [
    ["npm", "run", "tsc"],
    ["npm", "test"],
    ["npm", "run", "lint"],
  ],
  authChecks: authChecksOf(defaultAccount),
  allowedTools: {
    implement: [],
    review: [],
    triage: [],
    fix: [],
    gapCheck: [],
  },
  allowedWriteGlobs: [
    ".claude/skills/**",
    ".claude/agents/**",
    ".claude/hooks/**",
  ],
  maxTurns: { implement: 200, review: 80, triage: 80, fix: 120, gapCheck: 80 },
  silenceTimeoutMs: 10 * minuteMs,
  wallClockMs: {
    implement: 60 * minuteMs,
    review: 20 * minuteMs,
    triage: 20 * minuteMs,
    fix: 20 * minuteMs,
    gapCheck: 20 * minuteMs,
  },
  retriesPerFailure: 1,
  extraTurns: 100,
  ticketBudget: 150_000,
  liveCeiling: 180_000,
  triagePair: { model: "opus", effort: "medium" },
  gapCheckPair: { model: "opus", effort: "medium" },
  reviewListCadence: "end-of-run",
  idlePollMs: 60_000,
};

export function loadRunKnobs(overridePath: string): RunKnobs {
  return runKnobsOf(
    JSON.parse(readFileSync(overridePath, "utf8")) as RunKnobOverrides,
  );
}

// For a reader that must still work without the override file, such as a hook that fails open.
export function runKnobsOrDefaults(overridePath: string): RunKnobs {
  try {
    return loadRunKnobs(overridePath);
  } catch {
    return defaultRunKnobs;
  }
}

type RunKnobOverrides = Partial<
  Omit<RunKnobs, "allowedTools" | "maxTurns" | "wallClockMs"> & {
    allowedTools: Partial<StepKnobs<string[]>>;
    maxTurns: Partial<StepKnobs<number>>;
    wallClockMs: Partial<StepKnobs<number>>;
  }
>;

export function runKnobsOf(overrides: RunKnobOverrides): RunKnobs {
  return {
    ...defaultRunKnobs,
    ...overrides,
    skillNames: { ...defaultRunKnobs.skillNames, ...overrides.skillNames },
    allowedTools: {
      ...defaultRunKnobs.allowedTools,
      ...overrides.allowedTools,
    },
    maxTurns: { ...defaultRunKnobs.maxTurns, ...overrides.maxTurns },
    wallClockMs: { ...defaultRunKnobs.wallClockMs, ...overrides.wallClockMs },
    authChecks:
      overrides.authChecks ?? authChecksOf(overrides.account ?? defaultAccount),
  };
}
