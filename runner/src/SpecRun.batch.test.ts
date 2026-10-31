import { describe, expect, it } from "vitest";

import { FakeAgentStep, type ScriptedStep } from "./FakeAgentStep.ts";
import type { Blocker } from "./implementStep.ts";
import type { ResolveRecord } from "./resolveStep.ts";
import type { Clock } from "./SpecRun.ts";
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

describe("a Batch", () => {
  it("lands two Standalone members in typed order, each with its review list on its own issue", async () => {
    addIssue(first.number);
    addIssue(second.number);
    const agentStep = FakeAgentStep.init(
      ...proposed("second.ts"),
      ...proposed("first.ts"),
    );

    const result = await specRun(agentStep, {}, [second, first]).run(
      second,
      first,
    );

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

    const result = await specRun(
      agentStep,
      {
        async sleep() {
          github.reply(spec.number, "H1: I ran it.");
        },
      },
      [first, spec, second],
    ).run(first, spec, second);

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

    const result = await specRun(agentStep, {}, [spec, first]).run(spec, first);

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
    await specRun(
      FakeAgentStep.init(
        blocked([gated]),
        implemented("second.ts"),
        reviewed(),
      ),
      {},
      [first, second],
    ).run(first, second);
    github.reply(first.number, "H1: I ran it.");
    const agentStep = FakeAgentStep.init(implemented("first.ts"), reviewed());

    const result = await specRun(agentStep, {}, [first]).run(first);

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
    const run = specRun(agentStep, {}, [first, second, third]);

    const result = await run.run(first, second, third);

    expect(result.kind).toBe("stopped");
    expect(result.landed).toEqual([second, third]);
    expect(result.message).toBe(
      "Batch ended: byro-repo #302, byro-repo #303 landed; byro-repo #301 waits on you. Rerun the unfinished ones: `npm run runner -- byronbroughten/byro-repo 301`.",
    );
    expect(noticesOn(first.number).at(-1)).toBe(
      "Stopped on `stop spec` for Halt H1: landed nothing; byro-repo #301 stays unlanded.",
    );
    expect(github.issues.get(first.number)?.isOpen).toBe(true);
    expect(await run.status(first)).toContain(
      "Open Halts: H2 on byro-repo #301.",
    );
  });
});
