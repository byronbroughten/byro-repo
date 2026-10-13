// A Stop the limit guard raises before a step: SpecRun.ts ends the run but leaves the ticket at its step, so a rerun resumes it.
export class LimitStop extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "LimitStop";
  }
}
