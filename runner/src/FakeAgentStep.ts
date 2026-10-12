import type { AgentStep, StepRequest, StepResult } from "./AgentStep.ts";

// The AgentStep run-loop tests script: each run returns the next scripted result.
export class FakeAgentStep implements AgentStep {
  readonly requests: StepRequest[] = [];

  private readonly results: StepResult[];

  constructor(results: StepResult[]) {
    this.results = results;
  }

  static init(...results: StepResult[]): FakeAgentStep {
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
    return result;
  }
}
