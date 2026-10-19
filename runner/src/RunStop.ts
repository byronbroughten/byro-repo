// A Stop the limit guard or a red master raises mid-run: SpecRun.ts ends the run, leaving the ticket at its step for a rerun.
export class RunStop extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "RunStop";
  }
}
