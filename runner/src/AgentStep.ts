// AgentStep is the only code that launches agents: one headless `claude -p` session as a chosen account.
// ClaudeAgentStep.ts is the real adapter and FakeAgentStep.ts the one run-loop tests script.
// StepStream.ts reads the adapter's stream-json into a StepResult.

import type { Target } from "./ticketTargets.ts";

export interface AgentStep {
  run(request: StepRequest): Promise<StepResult>;
}

export interface Pair {
  model: "sonnet" | "opus";
  effort: "low" | "medium" | "high";
}

export interface StepRequest {
  prompt: string;
  pair: Pair;
  account: number;
  // The byro-repo root, so root settings and hooks load.
  cwd: string;
  maxTurns: number;
  allowedTools: string[];
  allowedWriteGlobs: string[];
  // The ticket's targets outside the repo; the adapter adds their tools to allowedTools.
  targets: Target[];
  jsonSchema: object;
  resumeSessionId?: string;
  // The peak context past which the adapter kills the session.
  liveCeiling?: number;
  // How long the stream may stay silent, and the session run, before the adapter kills it as hung.
  silenceTimeoutMs?: number;
  wallClockMs?: number;
  logPath?: string;
}

export interface StepResult {
  output: StepOutput;
  sessionId: string | undefined;
  account: number;
  configFolder: string | undefined;
  transcriptPath: string | undefined;
  peakContext: number | undefined;
  // Set when the adapter killed the session for crossing the request's live ceiling.
  hasCrossedCeiling: boolean;
  // Set when the adapter killed the session as hung.
  hang: Hang | undefined;
  // The result message's subtype; undefined when the stream ended without one.
  exitSubtype: string | undefined;
  // The result text of a result flagged is_error, which can still carry subtype success.
  errorText: string | undefined;
  usage: UsageReading | undefined;
  limitHit: LimitHit | undefined;
}

// Which limit a hung session ran past: its stream's silence timeout or its wall clock.
export type Hang = "silence" | "wall-clock";

export type StepOutput =
  | { status: "valid"; record: unknown }
  | { status: "schemaFailure"; rawOutput: string; problems: string[] }
  | { status: "none" };

export interface UsageReading {
  fiveHour: UsageWindow | undefined;
  sevenDay: UsageWindow | undefined;
}

export interface UsageWindow {
  utilization: number;
  resetsAt: Date;
}

export interface LimitHit {
  window: string | undefined;
  resetsAt: Date | undefined;
}
