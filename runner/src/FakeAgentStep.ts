import type { AgentStep, StepRequest, StepResult } from "./AgentStep.ts";

// A scripted step returns its result as is, or acts first, such as committing in the request's cwd as an implement step would.
export type ScriptedStep =
  StepResult | ((request: StepRequest) => Promise<StepResult>);

// The AgentStep run-loop tests script: each run returns the next scripted result.
export class FakeAgentStep implements AgentStep {
  readonly requests: StepRequest[] = [];

  private readonly results: ScriptedStep[];

  constructor(results: ScriptedStep[]) {
    this.results = results;
  }

  static init(...results: ScriptedStep[]): FakeAgentStep {
    return new FakeAgentStep(results);
  }

  async run(request: StepRequest): Promise<StepResult> {
    this.requests.push(request);
    const result = this.results[this.requests.length - 1];
    if (!result) {
      throw new Error(
        `FakeAgentStep has no scripted result for step ${this.requests.length}`,
      );
    }
    if (typeof result === "function") return result(request);
    return result;
  }
}
