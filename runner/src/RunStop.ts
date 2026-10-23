import type { IssueRef } from "./IssueWorkspaces.ts";

// A Stop the limit guard, a red master or the stuck detector raises mid-run: SpecRun.ts ends the run, leaving the ticket at its step for a rerun.
export class RunStop extends Error {
  // Set when the Stop is on one ticket and posted a comment about it.
  readonly event: { ticket?: IssueRef; commentUrl?: string };

  constructor(detail: string, event: RunStop["event"] = {}) {
    super(detail);
    this.name = "RunStop";
    this.event = event;
  }
}
