import type { IssueRef } from "./IssueWorkspaces.ts";

// A Stop the limit guard, a red master, the stuck detector or an unhandled ticket outcome raises mid-run: SpecRun.ts ends the run.
export class RunStop extends Error {
  // Set when the Stop is on one ticket and posted a comment about it.
  readonly event: { ticket?: IssueRef; commentUrl?: string };

  constructor(detail: string, event: RunStop["event"] = {}) {
    super(detail);
    this.name = "RunStop";
    this.event = event;
  }
}
