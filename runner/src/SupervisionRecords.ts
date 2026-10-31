// The supervision record: which spec's run, or which Batch (BatchRecords.ts), a Supervisor's claude process watches, or watched until its session ended, how many of its event lines it has explained, and its one watch.
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

import { BatchRecords, isMemberOf } from "./BatchRecords.ts";
import { eventStreamPathOf, rawLinesAt } from "./EventFileNotices.ts";
import { type IssueRef, type LeaseHolder } from "./IssueWorkspaces.ts";
import {
  identityOf,
  isSameProcess,
  isStillRunning,
  type ProcessIdentity,
} from "./processIdentity.ts";
import { RunLock } from "./RunLock.ts";

export interface SupervisionRecord {
  pid: number;
  owner: string;
  // A Batch's first member when it watches a Batch.
  spec: IssueRef;
  // The Batch's members in typed order; none for a spec run alone.
  members?: IssueRef[];
  // Event lines explained, oldest first, so the next unexplained one is at this index.
  offset: number;
  // The session end that ended this session's supervision; supervising the spec again rejoins from the offset.
  endedBy?: SupervisionEnd;
}

export type SupervisionEnd = "clear" | "resume" | "processEnd";

export interface WatchStart {
  // Named as the record names its Supervisor, so a reused pid never passes for the watch it replaced.
  watchProcess: ProcessIdentity;
  offset: number;
}

// The Supervisor's own identity, so a reused pid never inherits its record.
interface RecordFile extends SupervisionRecord, ProcessIdentity {
  // The spec's one watch: a later one replaces it, and it exits once the record names another.
  watch?: ProcessIdentity;
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

  // Any member's number names the Batch holding it, which the record then holds.
  // Replaces the pid's own record and takes over any other on the same spec or a member of the Batch,
  // carrying on from the furthest offset among those reading the same event file.
  async supervise(
    { pid }: LeaseHolder,
    owner: string,
    named: IssueRef,
  ): Promise<SupervisionRecord> {
    const members = BatchRecords.init(this.stateFolder).membersOf(named);
    const [spec = named] = members;
    const overlapping = this._files().filter((file) =>
      membersOf(file).some((member) => isMemberOf({ members }, member)),
    );
    const eventFile = eventStreamPathOf(this.stateFolder, members);
    const sameStream = overlapping.filter(
      (file) => this._eventFileOf(file) === eventFile,
    );
    const offset = Math.max(0, ...sameStream.map((file) => file.offset));
    const watch = sameStream.find((file) => file.watch)?.watch;
    // Read before the removal, so a polling watch never finds the spec with no record and takes itself for replaced.
    const supervisor = await identityOf(pid);
    for (const file of overlapping) this._remove(file.pid);
    const record: SupervisionRecord = {
      pid,
      owner,
      spec,
      ...(members.length > 1 && { members }),
      offset,
    };
    this._write({ ...record, ...supervisor, watch });
    return record;
  }

  // Joins the record holding the spec, a Batch's included when the spec is one of its members.
  async watch(spec: IssueRef, pid: number): Promise<WatchStart | undefined> {
    const watchProcess = await identityOf(pid);
    const file = this._specFileOf(spec);
    if (file === undefined) return undefined;
    this._write({ ...file, watch: watchProcess });
    return { watchProcess, offset: file.offset };
  }

  isWatchedBy(spec: IssueRef, watchProcess: ProcessIdentity): boolean {
    const watch = this._specFileOf(spec)?.watch;
    return watch !== undefined && isSameProcess(watch, watchProcess);
  }

  async recordOf(holder: LeaseHolder): Promise<SupervisionRecord | undefined> {
    const record = await this._recordOfLiveProcess(holder);
    if (record === undefined || !isSupervising(record)) return undefined;
    return record;
  }

  // SessionStart reads this one, an ended supervision included so it can name the rejoin; a Supervisor whose run has ended is a regular session.
  async runningRecordOf(
    holder: LeaseHolder,
  ): Promise<SupervisionRecord | undefined> {
    const record = await this._recordOfLiveProcess(holder);
    if (record === undefined) return undefined;
    return RunLock.isHeld(this.stateFolder, record.spec) ? record : undefined;
  }

  // Raw lines, so the record needs only the event file's location, never its line format.
  async unexplainedLinesOf(holder: LeaseHolder): Promise<string[]> {
    const record = await this.recordOf(holder);
    if (record === undefined) return [];
    return rawLinesAt(this._eventFileOf(record)).slice(record.offset);
  }

  // One line explained; never past the last line the run has written.
  async advance(holder: LeaseHolder): Promise<SupervisionRecord | undefined> {
    const record = await this.recordOf(holder);
    const file = this._fileOf(holder.pid);
    if (record === undefined || file === undefined) return undefined;
    const lineCount = rawLinesAt(this._eventFileOf(record)).length;
    const offset = Math.min(record.offset + 1, lineCount);
    this._write({ ...file, offset });
    return { ...record, offset };
  }

  // Keeps the record and its offset for the rejoin; dropping the watch makes a running one exit unprinted.
  async end({ pid }: LeaseHolder, endedBy: SupervisionEnd): Promise<void> {
    const file = this._fileOf(pid);
    if (file === undefined) return;
    this._write({ ...file, endedBy, watch: undefined });
  }

  // Ended supervisions included; a dead or reused pid has none.
  private async _recordOfLiveProcess({
    pid,
  }: LeaseHolder): Promise<SupervisionRecord | undefined> {
    const file = this._fileOf(pid);
    if (file === undefined) return undefined;
    if (!(await isStillRunning(file))) return undefined;
    const { owner, spec, members, offset, endedBy } = file;
    return { pid, owner, spec, ...(members && { members }), offset, endedBy };
  }

  // Read from the record's own members, so a Batch ending later never moves the file its offset counts in.
  private _eventFileOf(record: SupervisionRecord): string {
    return eventStreamPathOf(this.stateFolder, membersOf(record));
  }

  private _files(): RecordFile[] {
    if (!existsSync(this.folder)) return [];
    return readdirSync(this.folder)
      .map((name) => this._fileOf(Number(name.replace(/\.json$/, ""))))
      .filter((file): file is RecordFile => file !== undefined);
  }

  // `supervise` leaves one record per spec or Batch; an ended one names no Supervisor to watch for.
  private _specFileOf(spec: IssueRef): RecordFile | undefined {
    return this._files().find(
      (file) => isWatching(file, spec) && isSupervising(file),
    );
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

// Only a supervision that hasn't ended makes its session the spec's Supervisor.
function isSupervising({ endedBy }: SupervisionRecord): boolean {
  return endedBy === undefined;
}

// The spec it watches, or a member of the Batch it watches.
export function isWatching(
  record: SupervisionRecord,
  issue: IssueRef,
): boolean {
  return isMemberOf({ members: membersOf(record) }, issue);
}

function membersOf({ spec, members }: SupervisionRecord): IssueRef[] {
  return members ?? [spec];
}
