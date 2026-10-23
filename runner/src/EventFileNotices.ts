import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { shortRefOf } from "./halts.ts";
import { fileStemOf, type IssueRef } from "./IssueWorkspaces.ts";
import type { Notice, Notices } from "./Notices.ts";

// One line of a spec's event file; a run's end is a `run-ended` line, its `ending` saying how.
export interface EventLine {
  time: string;
  spec: string;
  ticket?: string;
  kind: "halt" | "failure-halt" | "idle" | "run-ended";
  ending?: "stopped" | "finished" | "crashed";
  summary: string;
  // The spec issue's when the event posted no comment.
  commentUrl: string;
}

// Appends one JSON line per notice to the spec's event file, which a Supervisor watches; a notice with no kind adds none.
export class EventFileNotices implements Notices {
  private readonly stateFolder: string;
  private readonly now: () => Date;

  constructor(stateFolder: string, now: () => Date) {
    this.stateFolder = stateFolder;
    this.now = now;
  }

  static init(stateFolder: string, now = () => new Date()): EventFileNotices {
    return new EventFileNotices(stateFolder, now);
  }

  async send(notice: Notice): Promise<void> {
    const line = this._lineOf(notice);
    if (line === undefined) return;
    mkdirSync(this.stateFolder, { recursive: true });
    appendFileSync(
      eventFilePathOf(this.stateFolder, notice.spec),
      `${JSON.stringify(line)}\n`,
    );
  }

  private _lineOf(notice: Notice): EventLine | undefined {
    const { kind } = notice;
    if (kind === undefined) return undefined;
    const isEnd =
      kind === "stopped" || kind === "finished" || kind === "crashed";
    return {
      time: this.now().toISOString(),
      spec: shortRefOf(notice.spec),
      ...(notice.ticket && { ticket: shortRefOf(notice.ticket) }),
      kind: isEnd ? "run-ended" : kind,
      ...(isEnd && { ending: kind }),
      summary: notice.summary,
      commentUrl: notice.commentUrl ?? notice.link,
    };
  }
}

export function eventFilePathOf(stateFolder: string, spec: IssueRef): string {
  return join(stateFolder, `${fileStemOf(spec)}.events.jsonl`);
}
