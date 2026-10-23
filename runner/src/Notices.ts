// The notice port: one phone notification per run event, since GitHub never notifies a developer of their own comments.
// NtfyNotices.ts and EventFileNotices.ts are the real adapters, composed by composedNotices; FakeNotices.ts is the one run-loop tests read.
import type { IssueRef } from "./IssueWorkspaces.ts";

export interface Notices {
  send(notice: Notice): Promise<void>;
}

// The events a Supervisor wakes on; the last three end the run.
export type NoticeKind =
  "halt" | "failure-halt" | "idle" | "stopped" | "finished" | "crashed";

// The ntfy adapter sends only the title, summary and link, so a notice on a public topic carries nothing else about the run.
export interface Notice {
  spec: IssueRef;
  specTitle: string;
  summary: string;
  link: string;
  kind?: NoticeKind;
  ticket?: IssueRef;
  commentUrl?: string;
}

// Every adapter gets every notice, even after one fails; the first failure is rethrown.
export function composedNotices(...adapters: Notices[]): Notices {
  return {
    async send(notice) {
      const results = await Promise.allSettled(
        adapters.map((adapter) => adapter.send(notice)),
      );
      const failed = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      if (failed !== undefined) throw failed.reason;
    },
  };
}
