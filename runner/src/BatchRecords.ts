// A Batch's record: its members in typed order, the process running it and its one event file, so any member's number finds the Batch.
// One file per Batch under the state folder's batches/, named by its first member; a member run alone writes none.
// The run loop writes it once every member's run lock is taken, so any other record naming a member is stale and goes;
// it stays after a Restart, keeping the member list for the relaunch, and goes at any other end.
// The event file's lines are EventFileNotices.ts's; a Supervisor's record of a Batch is SupervisionRecords.ts.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { fileStemOf, isSameIssue, type IssueRef } from "./IssueWorkspaces.ts";
import { identityOf, type ProcessIdentity } from "./processIdentity.ts";
import type { MemberList } from "./SpecRun/runState.ts";

export interface BatchRecord {
  members: MemberList;
  process: ProcessIdentity;
  // The file's name in the state folder.
  eventFile: string;
}

export class BatchRecords {
  private readonly folder: string;
  private readonly stateFolder: string;

  constructor(stateFolder: string) {
    this.stateFolder = stateFolder;
    this.folder = join(stateFolder, "batches");
  }

  static init(stateFolder: string): BatchRecords {
    return new BatchRecords(stateFolder);
  }

  // One member alone only drops a stale record naming it, so its events go to its own file.
  async open(members: MemberList, pid: number): Promise<void> {
    members.forEach((member) => {
      this._dropHolding(member);
    });
    const [lead] = members;
    if (members.length === 1) return;
    const record: BatchRecord = {
      members,
      process: await identityOf(pid),
      eventFile: batchEventFileOf(lead),
    };
    mkdirSync(this.folder, { recursive: true });
    writeFileSync(this._pathOf(lead), JSON.stringify(record));
  }

  close([lead]: MemberList): void {
    rmSync(this._pathOf(lead), { force: true });
  }

  batchOf(member: IssueRef): BatchRecord | undefined {
    return this._records().find(({ members }) => isMemberOf(members, member));
  }

  // The Batch's members, or the member alone when no Batch holds it.
  membersOf(member: IssueRef): MemberList {
    return this.batchOf(member)?.members ?? [member];
  }

  // The Batch's one event file, or undefined for a member no Batch holds.
  eventFilePathOf(member: IssueRef): string | undefined {
    const record = this.batchOf(member);
    if (record === undefined) return undefined;
    return join(this.stateFolder, record.eventFile);
  }

  private _dropHolding(member: IssueRef): void {
    const record = this.batchOf(member);
    if (record !== undefined) this.close(record.members);
  }

  // An unreadable record counts as none.
  private _records(): BatchRecord[] {
    if (!existsSync(this.folder)) return [];
    return readdirSync(this.folder).flatMap((name) => {
      try {
        const text = readFileSync(join(this.folder, name), "utf8");
        return [JSON.parse(text) as BatchRecord];
      } catch {
        return [];
      }
    });
  }

  private _pathOf(lead: IssueRef): string {
    return join(this.folder, `${fileStemOf(lead)}.json`);
  }
}

export function isMemberOf(members: IssueRef[], issue: IssueRef): boolean {
  return members.some((member) => isSameIssue(member, issue));
}

// Named by its first member, apart from that member's own event file.
export function batchEventFilePathOf(
  stateFolder: string,
  [lead]: MemberList,
): string {
  return join(stateFolder, batchEventFileOf(lead));
}

function batchEventFileOf(lead: IssueRef): string {
  return `${fileStemOf(lead)}.batch.events.jsonl`;
}
