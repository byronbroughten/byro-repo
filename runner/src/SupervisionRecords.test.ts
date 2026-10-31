import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { eventFilePathOf } from "./EventFileNotices.ts";
import {
  fileStemOf,
  type IssueRef,
  type LeaseHolder,
} from "./IssueWorkspaces.ts";
import { deadPid, seedHolder } from "./lockFixture.ts";
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
  seedHolder(join(stateFolder, `${fileStemOf(of)}.run.lock`), {
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
  it("is written for a pid and read back with its spec and a zero offset", async () => {
    await records().supervise(me, owner, spec);

    expect(await records().recordOf(me)).toEqual({
      pid: me.pid,
      owner,
      spec,
      offset: 0,
    });
  });

  it("replaces that pid's earlier record when written for another spec", async () => {
    await records().supervise(me, owner, spec);

    await records().supervise(me, owner, otherSpec);

    expect((await records().recordOf(me))?.spec).toEqual(otherSpec);
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

    expect((await records().recordOf(otherLive))?.spec).toEqual(otherSpec);
  });

  it("isn't read back once its process has died", async () => {
    const dead = deadHolder();
    await records().supervise(dead, owner, spec);

    expect(await records().recordOf(dead)).toBeUndefined();
  });

  it("is gone once released", async () => {
    await records().supervise(me, owner, spec);

    await records().release(me);

    expect(await records().recordOf(me)).toBeUndefined();
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
      spec,
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

describe("a spec's watch", () => {
  it("is recorded in the spec's record, with the record's offset to start from", async () => {
    appendEvents(spec, "a", "b");
    await records().supervise(otherLive, owner, spec);
    await records().advance(otherLive);

    const watch = await startedWatch(process.pid);

    expect(watch).toEqual({
      offset: 1,
      watchProcess: { pid: process.pid, startedAt: expect.any(String) },
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

  it("isn't recorded on a spec nobody supervises", async () => {
    await records().supervise(me, owner, otherSpec);

    expect(await records().watch(spec, process.pid)).toBeUndefined();
  });

  it("is over once its record is released", async () => {
    await records().supervise(me, owner, spec);
    const watch = await startedWatch(process.pid);

    await records().release(me);

    expect(records().isWatchedBy(spec, watch.watchProcess)).toBe(false);
  });
});
