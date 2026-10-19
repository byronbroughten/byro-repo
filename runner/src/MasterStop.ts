// A Stop a ticket's red checks raise when master is red too, or its master set fails to build: SpecRun.ts ends the run
// but leaves the ticket at its checks, so a rerun checks again.
export class MasterStop extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "MasterStop";
  }
}
