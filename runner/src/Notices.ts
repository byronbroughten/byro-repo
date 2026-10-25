// The notice port: one phone notification per run event, since GitHub never notifies a developer of their own comments.
// NtfyNotices.ts and EventFileNotices.ts are the real adapters, composed by composedNotices; FakeNotices.ts is the one run-loop tests read.
import type { IssueRef } from "./IssueWorkspaces.ts";

export interface Notices {
  send(notice: Notice): Promise<void>;
}

const runEndings = ["stopped", "finished", "crashed", "refused"] as const;

// The notice kinds that end the run.
export type RunEnding = (typeof runEndings)[number];

// The events a Supervisor wakes on.
export type NoticeKind =
  "run-started" | "halt" | "failure-halt" | "idle" | RunEnding;

export function isRunEnding(kind: NoticeKind): kind is RunEnding {
  return (runEndings as readonly NoticeKind[]).includes(kind);
}

// The ntfy adapter sends only the title, summary and link, so a notice on a public topic carries nothing else about the run.
export interface Notice {
  spec: IssueRef;
  specTitle: string;
  summary: string;
  link: string;
  kind?: NoticeKind;
  ticket?: IssueRef;
  commentUrl?: string;
  // What startup found worth a look; a run-started notice's, empty when it found nothing.
  warnings?: string[];
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
