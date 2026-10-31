import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { batchEventFilePathOf, BatchRecords } from "./BatchRecords.ts";
import {
  EventFileNotices,
  eventFilePathOf,
  type EventLine,
  eventLinesOf,
} from "./EventFileNotices.ts";
import { FakeAgentStep, type ScriptedStep } from "./FakeAgentStep.ts";
import type { Blocker } from "./implementStep.ts";
import type { IssueRef } from "./IssueWorkspaces.ts";
import { composedNotices } from "./Notices.ts";
import type { ResolveRecord } from "./resolveStep.ts";
import type { Clock, MemberList, RunResult, SpecRunConfig } from "./SpecRun.ts";
import {
  addIssue,
  addSpec,
  blocked,
  findingOf,
  github,
  implemented,
  masterSubjects,
  notices,
  refOf,
  resultOf,
  reviewed,
  spec,
  specRun,
  stateFolder,
  useSpecRunHarness,
} from "./specRunHarness.ts";

useSpecRunHarness();

const first = refOf(301);
const second = refOf(302);
const third = refOf(303);

const gated: Blocker = {
  kind: "gated-action",
  detail: "It needs app:build.",
  recommendation: "Run it by hand.",
};
const ambiguous: Blocker = {
  kind: "spec-ambiguity",
  detail: "The spec reads both ways.",
  recommendation: "Read it the first way.",
};

const propose: ResolveRecord = {
  finding: 1,
  axis: "standards",
  where: "one.ts:1",
  claim: "Line 1 is wrong.",
  evidence: "Checked it.",
  verdict: "propose",
  reason: "decision",
  recommendation: "Pick the first.",
};

// Runs `members` as a Batch, an idle poll requesting a stop on each.
function runBatch(
  agentStep: FakeAgentStep,
  { members, ...overrides }: Partial<SpecRunConfig> & { members: MemberList },
): Promise<RunResult> {
  return specRun(agentStep, { members, ...overrides }).run(...members);
}

function commentsOn(number: number): string[] {
  return github.comments
    .filter(({ issue }) => issue.number === number)
    .map(({ body }) => body);
}

function reviewListsOn(number: number): string[] {
  return commentsOn(number).filter((body) =>
    body.includes("<!-- review-list "),
  );
}

function gapCheckListsOn(number: number): string[] {
  return commentsOn(number).filter((body) =>
    body.includes("<!-- review-list ticket=gap-check -->"),
  );
}

function haltBodiesOn(number: number): string[] {
  return commentsOn(number).filter((body) => body.includes("**Halt H"));
}

// The landed issues' numbers, oldest landing first, read from master's merge subjects.
function landingOrder(): number[] {
  return masterSubjects()
    .flatMap((subject) => {
      const number = /\(#(\d+)\)$/.exec(subject)?.[1];
      return number === undefined ? [] : [Number(number)];
    })
    .reverse();
}

function noticesOn(number: number): string[] {
  return notices.sent
    .filter(({ spec }) => spec.number === number)
    .map(({ summary }) => summary);
}

// Each reading is a second later, so answers read in one pick are ordered as they were read.
function ticking(): Clock {
  let time = new Date("2026-10-12T09:00:00Z").getTime();
  return {
    now: () => {
      time += 1000;
      return new Date(time);
    },
  };
}

// Resolved as a Propose, so the ticket's landing posts a review list.
function proposed(file: string): ScriptedStep[] {
  return [
    implemented(file),
    reviewed([findingOf(1)]),
    resultOf({ records: [propose] }),
  ];
}

describe("run's Batch", () => {
  it("lands two Standalone members in typed order, each with its review list on its own issue", async () => {
    addIssue(first.number);
    addIssue(second.number);
    const agentStep = FakeAgentStep.init(
      ...proposed("second.ts"),
      ...proposed("first.ts"),
    );

    const result = await runBatch(agentStep, { members: [second, first] });

    expect(result.kind).toBe("finished");
    expect(result.landed).toEqual([second, first]);
    expect(landingOrder()).toEqual([302, 301]);
    expect(reviewListsOn(301).join("\n")).toContain("byro-repo #301");
    expect(reviewListsOn(302).join("\n")).toContain("byro-repo #302");
    expect(reviewListsOn(301).join("\n")).not.toContain("byro-repo #302");
  });

  it("runs a spec member's tickets in sub-issue order at its typed position, its Halt, review list and gap check on the spec issue", async () => {
    addIssue(first.number);
    addSpec([1, 2]);
    addIssue(second.number);
    const agentStep = FakeAgentStep.init(
      implemented("first.ts"),
      reviewed(),
      ...proposed("one.ts"),
      blocked([gated]),
      implemented("second.ts"),
      reviewed(),
      implemented("two.ts"),
      reviewed(),
    );

    const result = await runBatch(agentStep, {
      members: [first, spec, second],
      async sleep() {
        github.reply(spec.number, "H1: I ran it.");
      },
    });

    expect(result.kind).toBe("finished");
    expect(landingOrder()).toEqual([301, 1, 302, 2]);
    expect(haltBodiesOn(spec.number)).toEqual([
      expect.stringContaining(
        '**Halt H1** · Halt 1 of 1 · byro-repo #2, "Ticket 2"',
      ),
    ]);
    expect(haltBodiesOn(first.number)).toEqual([]);
    expect(haltBodiesOn(second.number)).toEqual([]);
    expect(reviewListsOn(spec.number).join("\n")).toContain("byro-repo #1");
    expect(gapCheckListsOn(spec.number)).toHaveLength(1);
  });

  it("works answered Halts first, oldest answer first across members, ahead of typed order", async () => {
    [first, second, third].forEach(({ number }) => {
      addIssue(number);
    });
    let polls = 0;
    const agentStep = FakeAgentStep.init(
      blocked([gated]),
      blocked([gated]),
      blocked([gated]),
      implemented("second.ts", {
        act: () => github.reply(first.number, "H1: I ran it."),
      }),
      reviewed(),
      implemented("third.ts"),
      reviewed(),
      implemented("first.ts"),
      reviewed(),
    );
    const members = [first, second, third];
    const run = specRun(agentStep, {
      clock: ticking(),
      async sleep() {
        polls += 1;
        if (polls === 1) {
          github.reply(second.number, "H1: I ran it.");
          github.reply(third.number, "H1: I ran it.");
          return;
        }
        members.forEach((member) => {
          run.requestStop(member);
        });
      },
    });

    const result = await run.run(first, second, third);

    expect(polls).toBe(1);
    expect(result.kind).toBe("finished");
    expect(landingOrder()).toEqual([302, 303, 301]);
  });

  it("idles only on Halts and leases, ending a member whose waits are the developer's with its rerun line", async () => {
    addSpec([1, 2]);
    github.edit(2, { labels: ["ready-for-human"] });
    addIssue(first.number);
    const agentStep = FakeAgentStep.init(
      implemented("one.ts"),
      reviewed(),
      blocked([gated]),
    );

    const result = await runBatch(agentStep, { members: [spec, first] });

    expect(result.kind).toBe("stopped");
    expect(result.landed).toEqual([refOf(1)]);
    expect(result.message).toBe(
      "Batch ended: none landed; byro-repo #213, byro-repo #301 wait on you. Rerun the unfinished ones: `npm run runner -- byronbroughten/byro-repo 213 301`.",
    );
    expect(noticesOn(spec.number).at(-1)).toBe(
      "Run ended: landed byro-repo #1. byro-repo #2 waits on you (`/start-issue byro-repo 2`). Rerun once your tickets close: `npm run runner -- byronbroughten/byro-repo 213`.",
    );
    expect(noticesOn(first.number)).toContain(
      "Idle: nothing runnable. byro-repo #301 waits on Halt H1.",
    );
    expect(
      noticesOn(spec.number).some((line) => line.startsWith("Idle:")),
    ).toBe(false);
  });

  it("resumes a member of a stopped Batch alone from its own run state", async () => {
    addIssue(first.number);
    addIssue(second.number);
    await runBatch(
      FakeAgentStep.init(
        blocked([gated]),
        implemented("second.ts"),
        reviewed(),
      ),
      { members: [first, second] },
    );
    github.reply(first.number, "H1: I ran it.");
    const agentStep = FakeAgentStep.init(implemented("first.ts"), reviewed());

    const result = await runBatch(agentStep, { members: [first] });

    expect(result.kind).toBe("finished");
    expect(result.landed).toEqual([first]);
    expect(agentStep.requests[0]?.resumeSessionId).toBe("implement-session");
    expect(agentStep.requests[0]?.prompt).toContain("H1: I ran it.");
  });

  it("stops only the member a `stop spec` answers, its Halts open, and carries on with the rest", async () => {
    [first, second, third].forEach(({ number }) => {
      addIssue(number);
    });
    const agentStep = FakeAgentStep.init(
      blocked([gated, ambiguous]),
      implemented("second.ts", {
        act: () => github.reply(first.number, "H1: stop spec"),
      }),
      reviewed(),
      implemented("third.ts"),
      reviewed(),
    );
    const result = await runBatch(agentStep, {
      members: [first, second, third],
    });

    expect(result.kind).toBe("stopped");
    expect(result.landed).toEqual([second, third]);
    expect(result.message).toBe(
      "Batch ended: byro-repo #302, byro-repo #303 landed; byro-repo #301 waits on you. Rerun the unfinished ones: `npm run runner -- byronbroughten/byro-repo 301`.",
    );
    expect(noticesOn(first.number).at(-1)).toBe(
      "Stopped on `stop spec` for Halt H1: landed nothing; byro-repo #301 stays unlanded.",
    );
    expect(github.issues.get(first.number)?.isOpen).toBe(true);
    expect(await specRun(FakeAgentStep.init()).status(first)).toContain(
      "Open Halts: H2 on byro-repo #301.",
    );
  });
});

function batchRecords(): BatchRecords {
  return BatchRecords.init(stateFolder());
}

function withEventFile(): Partial<SpecRunConfig> {
  const eventFile = EventFileNotices.init(stateFolder());
  return { notices: composedNotices(notices, eventFile) };
}

function batchEventLines(members: MemberList): EventLine[] {
  return readFileSync(batchEventFilePathOf(stateFolder(), members), "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as EventLine);
}

describe("a Batch's record", () => {
  it("names the members in typed order while the Batch runs, reached by any member, and is gone once it ends", async () => {
    addIssue(first.number);
    addIssue(second.number);
    let held: IssueRef[] | undefined;
    const agentStep = FakeAgentStep.init(
      implemented("second.ts", {
        act: () => {
          held = batchRecords().batchOf(first)?.members;
        },
      }),
      reviewed(),
      implemented("first.ts"),
      reviewed(),
    );

    await runBatch(agentStep, { members: [second, first] });

    expect(held).toEqual([second, first]);
    expect(batchRecords().batchOf(first)).toBeUndefined();
  });

  it("writes one event file whose every line names its member, and no member's own", async () => {
    addIssue(first.number);
    addIssue(second.number);
    const agentStep = FakeAgentStep.init(
      implemented("first.ts"),
      reviewed(),
      implemented("second.ts"),
      reviewed(),
    );

    await runBatch(agentStep, {
      members: [first, second],
      ...withEventFile(),
    });

    const lines = batchEventLines([first, second]);
    expect(lines.map(({ spec, kind }) => ({ spec, kind }))).toEqual([
      { spec: "byro-repo#301", kind: "run-started" },
      { spec: "byro-repo#302", kind: "run-started" },
      { spec: "byro-repo#301", kind: "run-ended" },
      { spec: "byro-repo#302", kind: "run-ended" },
    ]);
    expect(existsSync(eventFilePathOf(stateFolder(), first))).toBe(false);
    expect(existsSync(eventFilePathOf(stateFolder(), second))).toBe(false);
  });

  it("isn't written for a member run alone, whose events go to its own file even after a crashed Batch left one", async () => {
    addIssue(first.number);
    addIssue(second.number);
    await batchRecords().open([second, first], process.pid);
    const agentStep = FakeAgentStep.init(implemented("first.ts"), reviewed());

    await runBatch(agentStep, { members: [first], ...withEventFile() });

    expect(batchRecords().batchOf(first)).toBeUndefined();
    expect(eventLinesOf(stateFolder(), first).map(({ kind }) => kind)).toEqual([
      "run-started",
      "run-ended",
    ]);
  });

  it("lets status on any member report on the whole Batch", async () => {
    addIssue(first.number);
    addIssue(second.number);
    let status = "";
    const agentStep = FakeAgentStep.init(
      async (request) => {
        status = await specRun(FakeAgentStep.init()).status(second);
        return implemented("first.ts")(request);
      },
      reviewed(),
      implemented("second.ts"),
      reviewed(),
    );

    await runBatch(agentStep, { members: [first, second] });

    expect(status).toContain("Batch of byro-repo #301, byro-repo #302.");
    expect(status).toContain('byro-repo #301, "Ticket 301"');
    expect(status).toContain('byro-repo #302, "Ticket 302"');
  });

  it("stops the whole Batch after its current ticket on a stop requested on any member", async () => {
    [first, second, third].forEach(({ number }) => {
      addIssue(number);
    });
    const agentStep = FakeAgentStep.init(
      implemented("first.ts", {
        act: () => {
          specRun(FakeAgentStep.init()).requestStop(third);
        },
      }),
      reviewed(),
    );

    const result = await runBatch(agentStep, {
      members: [first, second, third],
    });

    expect(result.kind).toBe("stopped");
    expect(result.landed).toEqual([first]);
    expect(noticesOn(second.number).at(-1)).toContain("Stopped on request");
    expect(noticesOn(third.number).at(-1)).toContain("Stopped on request");
  });

  it("reports a stop requested on one member in status on another", async () => {
    addIssue(first.number);
    addIssue(second.number);
    let status = "";
    const agentStep = FakeAgentStep.init(async (request) => {
      const outside = specRun(FakeAgentStep.init());
      outside.requestStop(first);
      status = await outside.status(second);
      return implemented("first.ts")(request);
    }, reviewed());

    await runBatch(agentStep, { members: [first, second] });

    expect(status).toContain(
      "A stop is requested; the Batch ends after its current ticket.",
    );
  });

  it("keeps the member list across a Restart, and the relaunch resumes each member from its state", async () => {
    addSpec([1, 2]);
    addIssue(first.number);
    const result = await runBatch(
      FakeAgentStep.init(implemented("runner/one.ts"), reviewed()),
      { members: [spec, first] },
    );

    expect(result.kind).toBe("restarting");
    expect(batchRecords().batchOf(first)?.members).toEqual([spec, first]);

    const relaunch = await runBatch(
      FakeAgentStep.init(
        implemented("two.ts"),
        reviewed(),
        implemented("first.ts"),
        reviewed(),
      ),
      { members: [spec, first] },
    );

    expect(relaunch.kind).toBe("finished");
    expect(relaunch.landed).toEqual([refOf(1), refOf(2), first]);
    expect(
      notices.sent
        .filter(({ kind }) => kind === "run-started")
        .map(({ spec: member, isRelaunch }) => [member.number, isRelaunch]),
    ).toEqual([
      [213, undefined],
      [301, undefined],
      [213, true],
      [301, true],
    ]);
  });
});
