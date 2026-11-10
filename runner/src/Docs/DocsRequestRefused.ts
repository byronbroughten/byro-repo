/** A request the Docs REST API refused, with its HTTP status. */
export class DocsRequestRefused extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "DocsRequestRefused";
    this.status = status;
  }
}
