// The supervision record: which spec's run a Supervisor's claude process watches, how many of its event lines it has explained, and its one watch.
// One file per pid under the state folder's supervision/, live while that same process runs, as a lease is; the session hooks read it.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { rawEventLinesOf } from "./EventFileNotices.ts";
import {
  isSameIssue,
  type IssueRef,
  type LeaseHolder,
} from "./IssueWorkspaces.ts";
import { startTimeOf } from "./processStart.ts";
import { RunLock } from "./RunLock.ts";

export interface SupervisionRecord {
  pid: number;
  owner: string;
  spec: IssueRef;
  // Event lines explained, oldest first, so the next unexplained one is at this index.
  offset: number;
}

// A watch process, named as the record names its Supervisor, so a reused pid never passes for the watch it replaced.
export interface Watcher {
  pid: number;
  startedAt?: string;
}

export interface WatchStart {
  watcher: Watcher;
  offset: number;
}

interface RecordFile extends SupervisionRecord {
  startedAt?: string;
  // The spec's one watch: a later one replaces it, and it exits once the record names another.
  watcher?: Watcher;
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
      isSameIssue(file.spec, spec),
    );
    const offset = Math.max(0, ...sameSpec.map((file) => file.offset));
    const watcher = sameSpec.find((file) => file.watcher)?.watcher;
    for (const file of sameSpec) this._remove(file.pid);
    const record = { pid, owner, spec, offset };
    this._write({ ...record, startedAt: await startTimeOf(pid), watcher });
    return record;
  }

  // Names the pid as the spec's watch, replacing any other; undefined when nobody supervises the spec.
  async watch(spec: IssueRef, pid: number): Promise<WatchStart | undefined> {
    const file = this._specFileOf(spec);
    if (file === undefined) return undefined;
    const watcher = { pid, startedAt: await startTimeOf(pid) };
    this._write({ ...file, watcher });
    return { watcher, offset: file.offset };
  }

  isWatchedBy(spec: IssueRef, { pid, startedAt }: Watcher): boolean {
    const watcher = this._specFileOf(spec)?.watcher;
    return watcher?.pid === pid && watcher.startedAt === startedAt;
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

  // The tier gate and SessionStart read this one: a Supervisor whose run has ended is a regular session.
  async runningRecordOf(
    holder: LeaseHolder,
  ): Promise<SupervisionRecord | undefined> {
    const record = await this.recordOf(holder);
    if (record === undefined) return undefined;
    return RunLock.isHeld(this.stateFolder, record.spec) ? record : undefined;
  }

  // Raw lines, so the record needs only the event file's location, never its line format.
  async unexplainedLinesOf(holder: LeaseHolder): Promise<string[]> {
    const record = await this.recordOf(holder);
    if (record === undefined) return [];
    return rawEventLinesOf(this.stateFolder, record.spec).slice(record.offset);
  }

  // One line explained; never past the last line the run has written.
  async advance(holder: LeaseHolder): Promise<SupervisionRecord | undefined> {
    const record = await this.recordOf(holder);
    const file = this._fileOf(holder.pid);
    if (record === undefined || file === undefined) return undefined;
    const lineCount = rawEventLinesOf(this.stateFolder, record.spec).length;
    const offset = Math.min(record.offset + 1, lineCount);
    this._write({ ...file, offset });
    return { ...record, offset };
  }

  async release({ pid }: LeaseHolder): Promise<void> {
    this._remove(pid);
  }

  private _files(): RecordFile[] {
    if (!existsSync(this.folder)) return [];
    return readdirSync(this.folder)
      .map((name) => this._fileOf(Number(name.replace(/\.json$/, ""))))
      .filter((file): file is RecordFile => file !== undefined);
  }

  // `supervise` leaves one record per spec.
  private _specFileOf(spec: IssueRef): RecordFile | undefined {
    return this._files().find((file) => isSameIssue(file.spec, spec));
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
