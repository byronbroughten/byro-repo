import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { batchEventFilePathOf, BatchRecords } from "./BatchRecords.ts";
import { eventFilePathOf } from "./EventFileNotices.ts";
import {
  type IssueRef,
  issueRef,
  type LeaseHolder,
} from "./IssueWorkspaces.ts";
import { deadPid, seedHolder } from "./lockFixture.ts";
import { identityOf } from "./processIdentity.ts";
import type { MemberList } from "./SpecRun.ts";
import { SupervisionRecords } from "./SupervisionRecords.ts";

const owner = "byronbroughten";
const spec: IssueRef = { repo: "byro-repo", number: 331 };
const otherSpec: IssueRef = { repo: "byro-repo", number: 400 };
const me: LeaseHolder = { kind: "session", pid: process.pid };
// The test runner's parent outlives every test, so it stands in for another live Supervisor.
const otherLive: LeaseHolder = { kind: "session", pid: process.ppid };

let stateFolder = "";

beforeEach(() => {
  stateFolder = mkdtempSync(join(tmpdir(), "supervision-"));
});

afterEach(() => {
  rmSync(stateFolder, { recursive: true, force: true });
});

function records(): SupervisionRecords {
  return SupervisionRecords.init(stateFolder);
}

function appendEvents(of: IssueRef, ...lines: string[]): void {
  mkdirSync(stateFolder, { recursive: true });
  for (const line of lines) {
    appendFileSync(eventFilePathOf(stateFolder, of), `${line}\n`);
  }
}

function seedRunLock(of: IssueRef, pid: number): void {
  mkdirSync(stateFolder, { recursive: true });
  seedHolder(join(stateFolder, `${issueRef.fileStemOf(of)}.run.lock`), {
    pid,
    host: hostname(),
    startedAt: "2026-01-01",
  });
}

function deadHolder(): LeaseHolder {
  const { pid } = spawnSync("node", ["-e", ""]);
  if (pid === undefined) throw new Error("The throwaway process didn't start");
  return { kind: "session", pid };
}

async function startedWatch(pid: number) {
  const watch = await records().watch(spec, pid);
  if (watch === undefined) throw new Error("The spec has no record to watch");
  return watch;
}

describe("a supervision record", () => {
  it("is written for a pid and read back with its one member and a zero offset", async () => {
    await records().supervise(me, owner, spec);

    expect(await records().recordOf(me)).toEqual({
      pid: me.pid,
      owner,
      members: [spec],
      offset: 0,
    });
  });

  it("replaces that pid's earlier record when written for another spec", async () => {
    await records().supervise(me, owner, spec);

    await records().supervise(me, owner, otherSpec);

    expect((await records().recordOf(me))?.members).toEqual([otherSpec]);
  });

  it("keeps its offset when the same pid supervises the same spec again", async () => {
    appendEvents(spec, "a", "b");
    await records().supervise(me, owner, spec);
    await records().advance(me);

    await records().supervise(me, owner, spec);

    expect((await records().recordOf(me))?.offset).toBe(1);
  });

  it("takes over a spec another live pid supervises, carrying on from its offset", async () => {
    appendEvents(spec, "a", "b", "c");
    await records().supervise(otherLive, owner, spec);
    await records().advance(otherLive);
    await records().advance(otherLive);

    await records().supervise(me, owner, spec);

    expect(await records().recordOf(otherLive)).toBeUndefined();
    expect((await records().recordOf(me))?.offset).toBe(2);
  });

  it("leaves another live pid's record on a different spec", async () => {
    await records().supervise(otherLive, owner, otherSpec);

    await records().supervise(me, owner, spec);

    expect((await records().recordOf(otherLive))?.members).toEqual([otherSpec]);
  });

  it("isn't read back once its process has died", async () => {
    const dead = deadHolder();
    await records().supervise(dead, owner, spec);

    expect(await records().recordOf(dead)).toBeUndefined();
  });
});

describe("an ended supervision", () => {
  it("no longer makes its session the spec's Supervisor", async () => {
    await records().supervise(me, owner, spec);

    await records().end(me, "clear");

    expect(await records().recordOf(me)).toBeUndefined();
    expect(await records().advance(me)).toBeUndefined();
  });

  it("keeps its offset, so supervising the spec again rejoins from its last explained event", async () => {
    appendEvents(spec, "a", "b", "c");
    await records().supervise(me, owner, spec);
    await records().advance(me);
    await records().advance(me);

    await records().end(me, "clear");
    await records().supervise(me, owner, spec);

    expect(await records().unexplainedLinesOf(me)).toEqual(["c"]);
  });

  it("keeps its offset after its process ends, for another session to rejoin from", async () => {
    appendEvents(spec, "a", "b");
    await records().supervise(otherLive, owner, spec);
    await records().advance(otherLive);
    await records().end(otherLive, "processEnd");

    await records().supervise(me, owner, spec);

    expect((await records().recordOf(me))?.offset).toBe(1);
  });

  it("is read back with how it ended while its run goes on", async () => {
    await records().supervise(me, owner, spec);
    seedRunLock(spec, process.pid);

    await records().end(me, "clear");

    expect(await records().runningRecordOf(me)).toEqual({
      pid: me.pid,
      owner,
      members: [spec],
      offset: 0,
      endedBy: "clear",
    });
  });

  it("is supervising again, with no end, once its session supervises the spec again", async () => {
    await records().supervise(me, owner, spec);
    seedRunLock(spec, process.pid);
    await records().end(me, "clear");

    await records().supervise(me, owner, spec);

    expect((await records().runningRecordOf(me))?.endedBy).toBeUndefined();
  });

  it("leaves nothing to end for a session that supervises nothing", async () => {
    await records().end(me, "clear");

    expect(await records().runningRecordOf(me)).toBeUndefined();
  });
});

describe("unexplained event lines", () => {
  it("are every line past the offset, oldest first", async () => {
    appendEvents(spec, "first", "second", "third");
    await records().supervise(me, owner, spec);
    await records().advance(me);

    expect(await records().unexplainedLinesOf(me)).toEqual(["second", "third"]);
  });

  it("are none before the run has written its event file", async () => {
    await records().supervise(me, owner, spec);

    expect(await records().unexplainedLinesOf(me)).toEqual([]);
  });

  it("are none once advancing has passed every line, which stops at the last", async () => {
    appendEvents(spec, "only");
    await records().supervise(me, owner, spec);

    await records().advance(me);
    await records().advance(me);

    expect(await records().unexplainedLinesOf(me)).toEqual([]);
    expect((await records().recordOf(me))?.offset).toBe(1);
  });

  it("are none for a pid that supervises nothing", async () => {
    expect(await records().unexplainedLinesOf(me)).toEqual([]);
  });
});

describe("a running supervision record", () => {
  it("is the record while its spec's run lock is held by a running pid", async () => {
    await records().supervise(me, owner, spec);
    seedRunLock(spec, process.pid);

    expect(await records().runningRecordOf(me)).toEqual({
      pid: me.pid,
      owner,
      members: [spec],
      offset: 0,
    });
  });

  it("is none with no run lock", async () => {
    await records().supervise(me, owner, spec);

    expect(await records().runningRecordOf(me)).toBeUndefined();
  });

  it("is none when the run lock's pid has died", async () => {
    await records().supervise(me, owner, spec);
    seedRunLock(spec, deadPid());

    expect(await records().runningRecordOf(me)).toBeUndefined();
  });

  it("is none when only another spec's run lock is held", async () => {
    await records().supervise(me, owner, spec);
    seedRunLock(otherSpec, process.pid);

    expect(await records().runningRecordOf(me)).toBeUndefined();
  });

  it("is none for a pid that supervises nothing", async () => {
    seedRunLock(spec, process.pid);

    expect(await records().runningRecordOf(me)).toBeUndefined();
  });
});

describe("a Batch's supervision record", () => {
  const batch: MemberList = [spec, otherSpec];
  const loneSpec: IssueRef = { repo: "byro-repo", number: 500 };

  async function openBatch(): Promise<void> {
    await BatchRecords.init(stateFolder).open(batch, process.pid);
  }

  function appendBatchEvents(...lines: string[]): void {
    for (const line of lines) {
      appendFileSync(batchEventFilePathOf(stateFolder, batch), `${line}\n`);
    }
  }

  it("holds the Batch when supervised by any member's number", async () => {
    await openBatch();

    await records().supervise(me, owner, otherSpec);

    expect(await records().recordOf(me)).toEqual({
      pid: me.pid,
      owner,
      members: batch,
      offset: 0,
    });
  });

  it("catches up from the Batch's event file", async () => {
    await openBatch();
    appendBatchEvents("first", "second");
    appendEvents(otherSpec, "a member's own, from an earlier run");

    await records().supervise(me, owner, otherSpec);
    await records().advance(me);

    expect(await records().unexplainedLinesOf(me)).toEqual(["second"]);
  });

  it("replaces another live record on any of its members, carrying on from its offset", async () => {
    appendEvents(otherSpec, "a", "b");
    await records().supervise(otherLive, owner, otherSpec);
    await openBatch();
    appendBatchEvents("first", "second", "third");
    await records().supervise(me, owner, spec);
    await records().advance(me);
    await records().advance(me);

    await records().supervise(otherLive, owner, otherSpec);

    expect(await records().recordOf(me)).toBeUndefined();
    expect((await records().recordOf(otherLive))?.offset).toBe(2);
  });

  it("leaves another live record on a spec outside the Batch", async () => {
    await records().supervise(otherLive, owner, loneSpec);
    await openBatch();

    await records().supervise(me, owner, spec);

    expect((await records().recordOf(otherLive))?.members).toEqual([loneSpec]);
  });

  it("is replaced by the same pid supervising another spec", async () => {
    await openBatch();
    await records().supervise(me, owner, otherSpec);

    await records().supervise(me, owner, loneSpec);

    expect(await records().recordOf(me)).toEqual({
      pid: me.pid,
      owner,
      members: [loneSpec],
      offset: 0,
    });
  });

  it("is the one a watch on any member's number joins", async () => {
    await openBatch();
    await records().supervise(me, owner, spec);

    const watch = await records().watch(otherSpec, process.pid);

    expect(watch?.offset).toBe(0);
    expect(
      watch !== undefined && records().isWatchedBy(spec, watch.watchProcess),
    ).toBe(true);
  });

  describe("once its Batch has ended", () => {
    // The run loop closes the Batch's record at any end but a Restart.
    async function supervisedToEnd(): Promise<void> {
      await openBatch();
      appendBatchEvents("started");
      await records().supervise(me, owner, spec);
      await records().advance(me);
      appendBatchEvents("ended");
      BatchRecords.init(stateFolder).close(batch);
    }

    it("prints the run-ended line the watch printed, once", async () => {
      await supervisedToEnd();
      const watch = await startedWatch(process.pid);

      await records().supervise(me, owner, otherSpec);

      expect(watch.members).toEqual(batch);
      expect(await records().unexplainedLinesOf(me)).toEqual(["ended"]);
      await records().advance(me);
      await records().supervise(me, owner, spec);
      expect(await records().unexplainedLinesOf(me)).toEqual([]);
    });

    it("prints only lines not yet explained after a relaunch of the same list", async () => {
      await supervisedToEnd();
      await records().supervise(me, owner, spec);
      await records().advance(me);

      await openBatch();
      appendBatchEvents("relaunched");
      await records().supervise(me, owner, spec);

      expect(await records().unexplainedLinesOf(me)).toEqual(["relaunched"]);
    });

    it("moves to the member's own file once that member runs alone", async () => {
      await supervisedToEnd();
      await records().supervise(me, owner, spec);
      const later = new Date(Date.now() + 60_000);
      appendEvents(spec, "alone");
      utimesSync(eventFilePathOf(stateFolder, spec), later, later);

      await records().supervise(me, owner, spec);

      expect(await records().recordOf(me)).toMatchObject({ members: [spec] });
      expect(await records().unexplainedLinesOf(me)).toEqual(["alone"]);
    });

    it("moves to the member's own file once it runs alone, before that run writes a line", async () => {
      await supervisedToEnd();
      const later = new Date(Date.now() + 60_000);
      seedRunLock(spec, process.pid);
      utimesSync(
        join(stateFolder, `${issueRef.fileStemOf(spec)}.run.lock`),
        later,
        later,
      );

      await records().supervise(me, owner, spec);

      expect(await records().recordOf(me)).toMatchObject({ members: [spec] });
    });

    it("stays on the Batch while the ended run still holds its locks", async () => {
      const earlier = new Date(Date.now() - 60_000);
      seedRunLock(spec, process.pid);
      utimesSync(
        join(stateFolder, `${issueRef.fileStemOf(spec)}.run.lock`),
        earlier,
        earlier,
      );
      await supervisedToEnd();

      await records().supervise(me, owner, spec);

      expect(await records().unexplainedLinesOf(me)).toEqual(["ended"]);
    });
  });

  it("prints only lines not yet explained after a Restart's relaunch of the same list", async () => {
    await openBatch();
    appendBatchEvents("started", "restarting");
    await records().supervise(me, owner, spec);
    await records().advance(me);
    await records().advance(me);

    // A Restart keeps the Batch's record, and the relaunch opens it again.
    await openBatch();
    appendBatchEvents("relaunched");
    await records().supervise(me, owner, otherSpec);

    expect(await records().unexplainedLinesOf(me)).toEqual(["relaunched"]);
  });
});

describe("a supervision record saved before it held one member list", () => {
  const batch: MemberList = [spec, otherSpec];

  // The old shape: `spec`, and for a Batch `members` with the spec repeating its first.
  async function seedOldRecord(saved: object): Promise<void> {
    mkdirSync(join(stateFolder, "supervision"), { recursive: true });
    writeFileSync(
      join(stateFolder, "supervision", `${me.pid}.json`),
      JSON.stringify({
        ...(await identityOf(me.pid)),
        owner,
        offset: 2,
        ...saved,
      }),
    );
  }

  it("reads a spec alone as a list of one", async () => {
    await seedOldRecord({ spec });

    expect(await records().recordOf(me)).toEqual({
      pid: me.pid,
      owner,
      members: [spec],
      offset: 2,
    });
  });

  it("reads a Batch's members, dropping the spec that repeated the first", async () => {
    await seedOldRecord({ spec, members: batch });

    expect(await records().recordOf(me)).toEqual({
      pid: me.pid,
      owner,
      members: batch,
      offset: 2,
    });
  });

  it("is written back in the new shape when it advances", async () => {
    appendEvents(spec, "a", "b", "c");
    await seedOldRecord({ spec });

    await records().advance(me);

    const saved = JSON.parse(
      readFileSync(join(stateFolder, "supervision", `${me.pid}.json`), "utf8"),
    ) as object;
    expect(saved).toMatchObject({ members: [spec], offset: 3 });
    expect(saved).not.toHaveProperty("spec");
  });
});

describe("a supervision handoff", () => {
  function writeHandoff(named: IssueRef, text: string): string {
    const path = records().handoffPathOf(named);
    mkdirSync(join(stateFolder, "supervision"), { recursive: true });
    writeFileSync(path, text);
    return path;
  }

  it("is printed once by a rejoin after /clear, then deleted", async () => {
    await records().supervise(me, owner, spec);
    const path = writeHandoff(spec, "/runner byronbroughten/byro-repo 331");
    await records().end(me, "clear");

    const rejoin = await records().supervise(me, owner, spec);
    const again = await records().supervise(me, owner, spec);

    expect(rejoin).toBe("/runner byronbroughten/byro-repo 331");
    expect(existsSync(path)).toBe(false);
    expect(again).toBeUndefined();
  });

  it("stays in place for a catch-up by the process holding the live, unended record", async () => {
    await records().supervise(me, owner, spec);
    const path = writeHandoff(spec, "mine, not yet cleared");

    const catchUp = await records().supervise(me, owner, spec);

    expect(catchUp).toBeUndefined();
    expect(existsSync(path)).toBe(true);
  });

  it("is printed and deleted by another claude process taking over", async () => {
    await records().supervise(otherLive, owner, spec);
    const path = writeHandoff(spec, "from the other session");

    const takeover = await records().supervise(me, owner, spec);

    expect(takeover).toBe("from the other session");
    expect(existsSync(path)).toBe(false);
  });

  it("is printed by a session whose process ended without a record of its end", async () => {
    await records().supervise(deadHolder(), owner, spec);
    writeHandoff(spec, "left by a crash");

    expect(await records().supervise(me, owner, spec)).toBe("left by a crash");
  });

  it("is none with no file written", async () => {
    await records().supervise(otherLive, owner, spec);

    expect(await records().supervise(me, owner, spec)).toBeUndefined();
  });

  it("of a Batch is found through any member", async () => {
    const batch: MemberList = [spec, otherSpec];
    await BatchRecords.init(stateFolder).open(batch, process.pid);
    await records().supervise(otherLive, owner, spec);
    writeHandoff(spec, "the Batch's");

    expect(records().handoffPathOf(otherSpec)).toBe(
      records().handoffPathOf(spec),
    );
    expect(await records().supervise(me, owner, otherSpec)).toBe("the Batch's");
  });

  it("of a Batch is apart from its lead's own", async () => {
    const alone = records().handoffPathOf(spec);
    await BatchRecords.init(stateFolder).open([spec, otherSpec], process.pid);

    expect(records().handoffPathOf(spec)).not.toBe(alone);
  });

  it("never reads as a supervision record", async () => {
    await records().supervise(otherLive, owner, spec);
    writeHandoff(spec, "123");
    writeHandoff(otherSpec, "456");

    await records().supervise(me, owner, otherSpec);

    expect(await records().watch(spec, process.pid)).toBeDefined();
    expect(
      await records().recordOf({ kind: "session", pid: 123 }),
    ).toBeUndefined();
    expect((await records().recordOf(me))?.members).toEqual([otherSpec]);
  });
});

describe("a spec's watch", () => {
  it("is recorded in the spec's record, with the record's offset and members to start from", async () => {
    appendEvents(spec, "a", "b");
    await records().supervise(otherLive, owner, spec);
    await records().advance(otherLive);

    const watch = await startedWatch(process.pid);

    expect(watch).toEqual({
      offset: 1,
      watchProcess: { pid: process.pid, startedAt: expect.any(String) },
      supervisor: { pid: process.ppid, startedAt: expect.any(String) },
      members: [spec],
    });
    expect(records().isWatchedBy(spec, watch.watchProcess)).toBe(true);
  });

  it("is replaced by a later watch on the same spec", async () => {
    await records().supervise(me, owner, spec);
    const first = await startedWatch(process.pid);

    const second = await startedWatch(process.ppid);

    expect(records().isWatchedBy(spec, first.watchProcess)).toBe(false);
    expect(records().isWatchedBy(spec, second.watchProcess)).toBe(true);
  });

  it("survives its Supervisor catching up again", async () => {
    await records().supervise(me, owner, spec);
    const watch = await startedWatch(process.pid);

    await records().supervise(me, owner, spec);

    expect(records().isWatchedBy(spec, watch.watchProcess)).toBe(true);
  });

  it("is replaced once another session supervises the spec", async () => {
    await records().supervise(me, owner, spec);
    const watch = await startedWatch(process.pid);

    await records().supervise(otherLive, owner, spec);

    expect(records().isWatchedBy(spec, watch.watchProcess)).toBe(false);
  });

  it("names the Supervisor's claude process it watches for", async () => {
    await records().supervise(otherLive, owner, spec);

    const watch = await startedWatch(process.pid);

    expect(watch.supervisor).toEqual(await identityOf(process.ppid));
  });

  it("isn't recorded on a spec nobody supervises", async () => {
    await records().supervise(me, owner, otherSpec);

    expect(await records().watch(spec, process.pid)).toBeUndefined();
  });

  it("is over once its Supervisor's session ends", async () => {
    await records().supervise(me, owner, spec);
    const watch = await startedWatch(process.pid);

    await records().end(me, "clear");

    expect(records().isWatchedBy(spec, watch.watchProcess)).toBe(false);
  });

  it("isn't recorded on a spec whose supervision has ended", async () => {
    await records().supervise(me, owner, spec);
    await records().end(me, "clear");

    expect(await records().watch(spec, process.pid)).toBeUndefined();
  });
});
