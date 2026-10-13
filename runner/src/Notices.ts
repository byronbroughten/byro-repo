// The notice port: one phone notification per run event, since GitHub never notifies a developer of their own comments.
// NtfyNotices.ts is the real adapter and FakeNotices.ts the one run-loop tests read.

export interface Notices {
  send(notice: Notice): Promise<void>;
}

// Only these three, so a notice on a public topic carries nothing else about the run.
export interface Notice {
  specTitle: string;
  summary: string;
  link: string;
}
