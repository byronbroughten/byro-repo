import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { shortRefOf } from "./halts.ts";
import { fileStemOf, type IssueRef } from "./IssueWorkspaces.ts";
import {
  isRunEnding,
  type Notice,
  type Notices,
  type RunEnding,
} from "./Notices.ts";

// One line of a spec's event file; a run's end is a `run-ended` line, its `ending` saying how.
export interface EventLine {
  time: string;
  spec: string;
  ticket?: string;
  kind: "run-started" | "halt" | "failure-halt" | "idle" | "run-ended";
  ending?: RunEnding;
  summary: string;
  warnings?: string[];
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
    const isEnd = isRunEnding(kind);
    return {
      time: this.now().toISOString(),
      spec: shortRefOf(notice.spec),
      ...(notice.ticket && { ticket: shortRefOf(notice.ticket) }),
      kind: isEnd ? "run-ended" : kind,
      ...(isEnd && { ending: kind }),
      summary: notice.summary,
      ...(notice.warnings && { warnings: notice.warnings }),
      commentUrl: notice.commentUrl ?? notice.link,
    };
  }
}

export function eventFilePathOf(stateFolder: string, spec: IssueRef): string {
  return join(stateFolder, `${fileStemOf(spec)}.events.jsonl`);
}

export function eventLinesOf(stateFolder: string, spec: IssueRef): EventLine[] {
  return readFileSync(eventFilePathOf(stateFolder, spec), "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as EventLine);
}
