import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { batchEventFilePathOf, BatchRecords } from "./BatchRecords.ts";
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
    appendFileSync(this._pathOf(notice.spec), `${JSON.stringify(line)}\n`);
  }

  // A Batch member's line goes to the Batch's one file, its `spec` naming the member.
  private _pathOf(spec: IssueRef): string {
    const members = BatchRecords.init(this.stateFolder).membersOf(spec);
    return eventStreamPathOf(this.stateFolder, members);
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

// A Batch's one event file, or a member alone's own.
export function eventStreamPathOf(
  stateFolder: string,
  members: IssueRef[],
): string {
  const [lead] = members;
  if (lead === undefined) throw new Error("An event stream has no member.");
  if (members.length === 1) return eventFilePathOf(stateFolder, lead);
  return batchEventFilePathOf(stateFolder, members);
}

export function rawEventLinesOf(stateFolder: string, spec: IssueRef): string[] {
  return rawLinesAt(eventFilePathOf(stateFolder, spec));
}

export function rawLinesAt(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line !== "");
}

export function eventLinesOf(stateFolder: string, spec: IssueRef): EventLine[] {
  return readFileSync(eventFilePathOf(stateFolder, spec), "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as EventLine);
}
