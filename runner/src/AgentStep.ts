// AgentStep is the only code that launches agents: one headless `claude -p` session as a chosen account.
// ClaudeAgentStep.ts is the real adapter and FakeAgentStep.ts the one run-loop tests script.
// StepStream.ts reads the adapter's stream-json into a StepResult.

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
  // A cswap account number.
  account: number;
  // The byro-repo root, so root settings and hooks load.
  cwd: string;
  maxTurns: number;
  allowedTools: string[];
  jsonSchema: object;
  resumeSessionId?: string;
  logPath?: string;
}

export interface StepResult {
  output: StepOutput;
  sessionId: string | undefined;
  account: number;
  configFolder: string | undefined;
  transcriptPath: string | undefined;
  peakContext: number | undefined;
  // The result message's subtype; undefined when the stream ended without one.
  exitSubtype: string | undefined;
  usage: UsageReading | undefined;
  limitHit: LimitHit | undefined;
}

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
  // The stream's rateLimitType, such as five_hour or seven_day.
  window: string | undefined;
  resetsAt: Date | undefined;
}
