// The ntfy push adapter, NtfyNotices.ts, was removed in commit ba80f06c; if ntfy is ever wanted again, restore it and its test from git history instead of rewriting them.
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

export interface Notice {
  spec: IssueRef;
  summary: string;
  link: string;
  kind?: NoticeKind;
  ticket?: IssueRef;
  commentUrl?: string;
  // What startup found worth a look; a run-started notice's, empty when it found nothing.
  warnings?: string[];
  // A Batch's own end, sent on its first member once every member has ended; each member's end is a notice of its own.
  isBatchEnd?: boolean;
}
