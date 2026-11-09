import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { batchEventFilePathOf, BatchRecords } from "./BatchRecords.ts";
import { shortRefOf } from "./halts.ts";
import { type IssueRef, issueRef } from "./IssueWorkspaces.ts";
import {
  isRunEnding,
  type Notice,
  type Notices,
  type RunEnding,
} from "./Notices.ts";
import type { MemberList } from "./SpecRun/runState.ts";

// A Batch member's end, then the whole run's.
type EndKind = "member-ended" | "run-ended";

// One line of a spec's event file; only the whole run's end is `run-ended`, a Batch member's `member-ended`, each `ending` saying how.
export interface EventLine {
  time: string;
  spec: string;
  ticket?: string;
  kind: "run-started" | "halt" | "failure-halt" | "idle" | EndKind;
  ending?: RunEnding;
  summary: string;
  warnings?: string[];
  // The spec issue's when the event posted no comment.
  commentUrl: string;
}

// Where a spec's lines go, and whether that file is a Batch's.
interface EventFile {
  path: string;
  isBatch: boolean;
}

// Appends one JSON line per notice to the spec's event file, which a Supervisor watches; a notice with no kind adds none.
export class EventFileNotices implements Notices {
  private readonly stateFolder: string;
  private readonly now: () => Date;
  private readonly eventFileOf: (spec: IssueRef) => EventFile;

  constructor(
    stateFolder: string,
    now: () => Date,
    eventFileOf: (spec: IssueRef) => EventFile,
  ) {
    this.stateFolder = stateFolder;
    this.now = now;
    this.eventFileOf = eventFileOf;
  }

  // A Batch member's line goes to the Batch's one file, its `spec` naming the member.
  static init(stateFolder: string, now = () => new Date()): EventFileNotices {
    return new EventFileNotices(stateFolder, now, (spec) => {
      const batchFile = BatchRecords.init(stateFolder).eventFilePathOf(spec);
      if (batchFile === undefined) {
        return { path: eventFilePathOf(stateFolder, spec), isBatch: false };
      }
      return { path: batchFile, isBatch: true };
    });
  }

  // Every line goes to these members' stream, for a run whose Batch record may already be gone, such as a crashed one's.
  static forStream(stateFolder: string, members: MemberList): EventFileNotices {
    const path = eventStreamPathOf(stateFolder, members);
    return new EventFileNotices(
      stateFolder,
      () => new Date(),
      // Its ending is the whole run's, since a crash ends every member at once.
      () => ({ path, isBatch: false }),
    );
  }

  async send(notice: Notice): Promise<void> {
    const { path, isBatch } = this.eventFileOf(notice.spec);
    const line = this._lineOf(notice, isBatch);
    if (line === undefined) return;
    mkdirSync(this.stateFolder, { recursive: true });
    appendFileSync(path, `${JSON.stringify(line)}\n`);
  }

  private _lineOf(notice: Notice, isBatch: boolean): EventLine | undefined {
    const { kind } = notice;
    if (kind === undefined) return undefined;
    const isEnd = isRunEnding(kind);
    return {
      time: this.now().toISOString(),
      spec: shortRefOf(notice.spec),
      ...(notice.ticket && { ticket: shortRefOf(notice.ticket) }),
      kind: isEnd ? endKindOf(notice, isBatch) : kind,
      ...(isEnd && { ending: kind }),
      summary: notice.summary,
      ...(notice.warnings && { warnings: notice.warnings }),
      commentUrl: notice.commentUrl ?? notice.link,
    };
  }
}

function endKindOf({ isBatchEnd }: Notice, isBatch: boolean): EndKind {
  if (isBatch && isBatchEnd !== true) return "member-ended";
  return "run-ended";
}

export function eventFilePathOf(stateFolder: string, spec: IssueRef): string {
  return join(stateFolder, `${issueRef.fileStemOf(spec)}.events.jsonl`);
}

// A Batch's one event file, or a member alone's own.
export function eventStreamPathOf(
  stateFolder: string,
  members: MemberList,
): string {
  const [lead] = members;
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
  return rawEventLinesOf(stateFolder, spec).map(
    (line) => JSON.parse(line) as EventLine,
  );
}
