// The supervision record: which spec's run a Supervisor's claude process watches, and how many of its event lines it has explained.
// One file per pid under the state folder's supervision/, live while that same process runs, as a lease is; the tier gate and session hooks read it.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { eventFilePathOf } from "./EventFileNotices.ts";
import type { IssueRef, LeaseHolder } from "./IssueWorkspaces.ts";
import { startTimeOf } from "./processStart.ts";

export interface SupervisionRecord {
  pid: number;
  owner: string;
  spec: IssueRef;
  // Event lines explained, oldest first, so the next unexplained one is at this index.
  offset: number;
}

interface RecordFile extends SupervisionRecord {
  startedAt?: string;
}

export class SupervisionRecords {
  private readonly folder: string;
  private readonly stateFolder: string;

  constructor(stateFolder: string) {
    this.stateFolder = stateFolder;
    this.folder = join(stateFolder, "supervision");
  }

  static init(stateFolder: string): SupervisionRecords {
    return new SupervisionRecords(stateFolder);
  }

  // Replaces the pid's own record and takes over any other on the same spec, carrying on from the furthest offset among them.
  async supervise(
    { pid }: LeaseHolder,
    owner: string,
    spec: IssueRef,
  ): Promise<SupervisionRecord> {
    const sameSpec = this._files().filter((file) =>
      isSameSpec(file.spec, spec),
    );
    const offset = Math.max(0, ...sameSpec.map((file) => file.offset));
    for (const file of sameSpec) this._remove(file.pid);
    const record = { pid, owner, spec, offset };
    this._write({ ...record, startedAt: await startTimeOf(pid) });
    return record;
  }

  async recordOf({ pid }: LeaseHolder): Promise<SupervisionRecord | undefined> {
    const file = this._fileOf(pid);
    if (file === undefined) return undefined;
    const startedNow = await startTimeOf(pid);
    if (startedNow === undefined || startedNow !== file.startedAt) {
      return undefined;
    }
    const { owner, spec, offset } = file;
    return { pid, owner, spec, offset };
  }

  // Raw lines, so the record needs only the event file's location, never its line format.
  async unexplainedLinesOf(holder: LeaseHolder): Promise<string[]> {
    const record = await this.recordOf(holder);
    if (record === undefined) return [];
    return this._eventLinesOf(record.spec).slice(record.offset);
  }

  // One line explained; never past the last line the run has written.
  async advance(holder: LeaseHolder): Promise<SupervisionRecord | undefined> {
    const record = await this.recordOf(holder);
    const file = this._fileOf(holder.pid);
    if (record === undefined || file === undefined) return undefined;
    const lineCount = this._eventLinesOf(record.spec).length;
    const offset = Math.min(record.offset + 1, lineCount);
    this._write({ ...file, offset });
    return { ...record, offset };
  }

  async release({ pid }: LeaseHolder): Promise<void> {
    this._remove(pid);
  }

  private _eventLinesOf(spec: IssueRef): string[] {
    const path = eventFilePathOf(this.stateFolder, spec);
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line !== "");
  }

  private _files(): RecordFile[] {
    if (!existsSync(this.folder)) return [];
    return readdirSync(this.folder)
      .map((name) => this._fileOf(Number(name.replace(/\.json$/, ""))))
      .filter((file): file is RecordFile => file !== undefined);
  }

  // An unreadable record counts as none, so a torn write never leaves a session supervising for good.
  private _fileOf(pid: number): RecordFile | undefined {
    try {
      return JSON.parse(readFileSync(this._pathOf(pid), "utf8")) as RecordFile;
    } catch {
      return undefined;
    }
  }

  private _write(file: RecordFile): void {
    mkdirSync(this.folder, { recursive: true });
    writeFileSync(this._pathOf(file.pid), JSON.stringify(file));
  }

  private _remove(pid: number): void {
    rmSync(this._pathOf(pid), { force: true });
  }

  private _pathOf(pid: number): string {
    return join(this.folder, `${pid}.json`);
  }
}

function isSameSpec(a: IssueRef, b: IssueRef): boolean {
  return a.repo === b.repo && a.number === b.number;
}
