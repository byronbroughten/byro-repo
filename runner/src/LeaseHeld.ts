// Thrown when another holder's lease on a workspace is live: SpecRun.ts leaves that ticket waiting instead of stopping it.
export class LeaseHeld extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "LeaseHeld";
  }
}
