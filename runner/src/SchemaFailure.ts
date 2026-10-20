// A step record that fails its schema or the runner's own check: SpecRun.ts posts a Failure Halt linking the raw output.
export class SchemaFailure extends Error {
  readonly logPath: string;

  constructor(detail: string, logPath: string) {
    super(detail);
    this.name = "SchemaFailure";
    this.logPath = logPath;
  }
}
