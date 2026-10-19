import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FakeAgentStep } from "./FakeAgentStep.ts";
import { git } from "./GitFixture.ts";
import type { Blocker } from "./implementStep.ts";
import {
  addSpec,
  after,
  blocked,
  bodyWithTargets,
  github,
  implemented,
  implementResultOf,
  notices,
  recordOf,
  reviewed,
  spec,
  specRun,
  stateFolder,
  type StepScript,
  ticketState,
  timed,
  timingLines,
  useSpecRunHarness,
} from "./specRunHarness.ts";

useSpecRunHarness();

describe("run's Halts", () => {
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
  const denied: Blocker = {
    kind: "denied-tool",
    detail: "The gate refused a write to the app spreadsheet.",
    recommendation: "Skip the write.",
  };

  function haltComments(): string[] {
    return github.comments
      .map(({ body }) => body)
      .filter((body) => body.includes("**Halt H"));
  }

  function noteComments(): string[] {
    return github.comments
      .map(({ body }) => body)
      .filter((body) => /^<!-- spec-runner -->\nHalt H/.test(body));
  }

  function factsOf(): { halt?: string } {
    const path = join(stateFolder(), "byro-repo-1.facts.json");
    return JSON.parse(readFileSync(path, "utf8")) as ReturnType<typeof factsOf>;
  }

  it("posts one comment and one notice per Halt and, with nothing downstream, holds only the blocked ticket", async () => {
    addSpec([1, 2]);
    const agentStep = FakeAgentStep.init(
      blocked([gated, ambiguous]),
      implemented("two.ts"),
      reviewed(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.kind).toBe("stopped");
    expect(result.message).toBe(
      "Stopped on request: landed byro-repo #2. byro-repo #1 waits on Halt H1, H2.",
    );
    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    const [first, second] = haltComments();
    expect(haltComments()).toHaveLength(2);
    expect(first).toContain(
      '**Halt H1** · Halt 1 of 2 · byro-repo #1, "Ticket 1" · gated-action blocker',
    );
    expect(first).toContain("It needs app:build.");
    expect(first).toContain("Blocks: only this ticket.");
    expect(first).toContain("1. Run it by hand.\n2. `stop spec`");
    expect(second).toContain("**Halt H2** · Halt 2 of 2 · byro-repo #1");
    expect(notices.sent.slice(1, 3)).toEqual([
      {
        specTitle: "The spec",
        summary:
          "Halt 1 of 2 · byro-repo #1: a gated-action blocker needs an answer (H1).",
        link: "https://github.com/byronbroughten/byro-repo/issues/213",
      },
      {
        specTitle: "The spec",
        summary:
          "Halt 2 of 2 · byro-repo #1: a spec-ambiguity blocker needs an answer (H2).",
        link: "https://github.com/byronbroughten/byro-repo/issues/213",
      },
    ]);
  });

  it("holds only the tickets downstream of a blocker's ticket and runs the rest", async () => {
    addSpec([1, 2, 3]);
    github.blockers.set(2, [1]);
    const agentStep = FakeAgentStep.init(
      blocked([gated]),
      implemented("three.ts"),
      reviewed(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.message).toBe(
      "Stopped on request: landed byro-repo #3. byro-repo #1 waits on Halt H1; byro-repo #2 waits on Halt H1.",
    );
    expect(haltComments()[0]).toContain(
      "Blocks: byro-repo#2 and their downstream.",
    );
  });

  it("writes the halted step's duration line, then resumes the implementer with every answer in one prompt and lands `Halted then passed`", async () => {
    addSpec([1]);
    const clock = timed();
    await specRun(
      FakeAgentStep.init(after(30, blocked([gated, ambiguous]))),
      clock,
    ).run(spec);
    expect(timingLines()).toContain("byro-repo #1: implement took 30s.");
    github.reply(213, "H1: I ran it.");
    github.reply(213, "For H2, read it the second way.");
    const agentStep = FakeAgentStep.init(
      after(20, implemented("one.ts")),
      reviewed(),
    );

    const result = await specRun(agentStep, clock).run(spec);

    expect(result.message).toBe(
      "Run ended: landed byro-repo #1. Every ticket is closed.",
    );
    const [resumed] = agentStep.requests;
    expect(resumed?.resumeSessionId).toBe("implement-session");
    expect(resumed?.prompt).toContain("Answer, verbatim:\n\nH1: I ran it.");
    expect(resumed?.prompt).toContain(
      "Answer, verbatim:\n\nFor H2, read it the second way.",
    );
    expect(timingLines()).toContain("byro-repo #1: resume took 20s.");
    expect(noteComments()).toEqual([
      "<!-- spec-runner -->\nHalt H1 answered via a spec-issue reply.",
      "<!-- spec-runner -->\nHalt H2 answered via a spec-issue reply.",
    ]);
    expect(factsOf().halt).toBe("gated-action blocker, spec-ambiguity blocker");
  });

  it("keeps the ticket halted while one of its Halts is unanswered", async () => {
    addSpec([1]);
    await specRun(FakeAgentStep.init(blocked([gated, ambiguous]))).run(spec);
    github.reply(213, "H1: I ran it.");
    const agentStep = FakeAgentStep.init();

    const result = await specRun(agentStep).run(spec);

    expect(agentStep.requests).toHaveLength(0);
    expect(result.message).toContain("byro-repo #1 waits on Halt H2");
  });

  it("reads no answer from a reply posted before the Halt", async () => {
    addSpec([1]);
    github.reply(213, "H1: an old note.");
    await specRun(FakeAgentStep.init(blocked([gated]))).run(spec);
    const agentStep = FakeAgentStep.init();

    const result = await specRun(agentStep).run(spec);

    expect(agentStep.requests).toHaveLength(0);
    expect(result.message).toContain("byro-repo #1 waits on Halt H1");
  });

  it("reads no answer from another login's reply", async () => {
    addSpec([1]);
    await specRun(FakeAgentStep.init(blocked([gated]))).run(spec);
    github.reply(213, "H1: I ran it.", "someone-else");
    const agentStep = FakeAgentStep.init();

    const result = await specRun(agentStep).run(spec);

    expect(agentStep.requests).toHaveLength(0);
    expect(result.message).toContain("byro-repo #1 waits on Halt H1");
    expect(noteComments()).toEqual([]);
  });

  it("takes the first answer and notes a later one as ignored, once", async () => {
    addSpec([1]);
    await specRun(FakeAgentStep.init(blocked([gated]))).run(spec);
    github.reply(213, "H1: I ran it.");
    github.reply(213, "Actually, H1: skip it.");
    const agentStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    await specRun(agentStep).run(spec);
    await specRun(FakeAgentStep.init()).run(spec);

    expect(agentStep.requests[0]?.prompt).toContain("H1: I ran it.");
    expect(agentStep.requests[0]?.prompt).not.toContain("skip it");
    expect(noteComments()).toEqual([
      "<!-- spec-runner -->\nHalt H1 answered via a spec-issue reply.",
      "<!-- spec-runner -->\nHalt H1 was already answered; the later reply `comment-3` is ignored.",
    ]);
  });

  it("resumes with a fresh implementer on the committed branch once the session reached the ticket budget", async () => {
    addSpec([1]);
    await specRun(
      FakeAgentStep.init(blocked([gated], { peakContext: 150_000 })),
    ).run(spec);
    github.reply(213, "H1: I ran it.");
    const agentStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    await specRun(agentStep).run(spec);

    const [fresh] = agentStep.requests;
    expect(fresh?.resumeSessionId).toBeUndefined();
    expect(fresh?.prompt).toContain("## The developer's answers");
    expect(fresh?.prompt).toContain("H1: I ran it.");
  });

  it("offers adding a denied tool's target, and the resumed step launches with the ticket's targets read again", async () => {
    addSpec([1]);
    await specRun(FakeAgentStep.init(blocked([denied]))).run(spec);
    expect(haltComments()[0]).toContain(
      "1. Skip the write.\n2. Add it to the ticket's `## Targets`, then resume\n3. `stop spec`",
    );
    github.edit(1, { body: bodyWithTargets("app spreadsheet") });
    github.reply(213, "H1: 2");
    const agentStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    const result = await specRun(agentStep).run(spec);

    expect(result.message).toContain("landed byro-repo #1");
    expect(agentStep.requests[0]?.targets).toEqual([
      { kind: "spreadsheet", name: "app" },
    ]);
    expect(factsOf().halt).toBe("denied-tool blocker");
  });

  it("halts on a blocker in a committed record only after the work is reviewed, then resumes at checks", async () => {
    addSpec([1]);
    const committedWithBlocker: StepScript = async (request) => {
      const result = await implemented("one.ts")(request);
      const output = result.output as {
        status: "valid";
        record: { record: object };
      };
      return {
        ...result,
        sessionId: "implement-session",
        output: {
          ...output,
          record: { record: { ...output.record.record, blockers: [gated] } },
        },
      };
    };
    const first = FakeAgentStep.init(committedWithBlocker, reviewed());
    await specRun(first).run(spec);
    expect(first.requests).toHaveLength(2);
    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    github.reply(213, "H1: no change needed.");
    const agentStep = FakeAgentStep.init(async (request) =>
      implementResultOf(
        recordOf(
          git(request.cwd, "branch", "--show-current"),
          git(request.cwd, "rev-parse", "HEAD"),
        ),
      ),
    );

    const result = await specRun(agentStep).run(spec);

    expect(agentStep.requests).toHaveLength(1);
    expect(result.message).toContain("landed byro-repo #1");
  });
});
