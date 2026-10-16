// Every knob a run reads, typed and defaulted here; a repo overrides them in one JSON file that loadRunKnobs() lays over these.
// SpecRun.ts reads them for a run; byro-repo's context-nudge hook reads the ticket budget and handoff doc through runKnobsOrDefaults().

import { readFileSync } from "node:fs";

export type Command = [string, ...string[]];

export interface StepKnobs<VL extends number | string[]> {
  implement: VL;
  review: VL;
}

// The steps a run launches, each with its own knobs.
export type KnobbedStep = keyof StepKnobs<number>;

export interface RunKnobs {
  // Repo name to its clone's path relative to the primary root; the root repo's is ".".
  clonePaths: Record<string, string>;
  // The cswap account every step runs as.
  account: number;
  skillNames: { review: string };
  // Run from a workspace or primary root: on master at preflight, and after review in each ticket.
  checks: Command[];
  // Each must exit 0 at preflight; unset, GitHub auth and the configured account's claude login.
  authChecks: Command[];
  allowedTools: StepKnobs<string[]>;
  // Workspace-relative globs under the protected .claude/ that a step's Edit or Write may still change.
  allowedWriteGlobs: string[];
  maxTurns: StepKnobs<number>;
  ticketBudget: number;
  // Named in the context nudge's message; unset, the message says to write a handoff with no link.
  handoffDocPath?: string;
}

const defaultAccount = 1;

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
  allowedTools: { implement: [], review: [] },
  allowedWriteGlobs: [
    ".claude/skills/**",
    ".claude/agents/**",
    ".claude/hooks/**",
  ],
  maxTurns: { implement: 200, review: 80 },
  ticketBudget: 150_000,
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
  Omit<RunKnobs, "allowedTools" | "maxTurns"> & {
    allowedTools: Partial<StepKnobs<string[]>>;
    maxTurns: Partial<StepKnobs<number>>;
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
    authChecks:
      overrides.authChecks ?? authChecksOf(overrides.account ?? defaultAccount),
  };
}
