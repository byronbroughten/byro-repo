import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { Pair, StepResult } from "./AgentStep.ts";
import { FakeAgentStep } from "./FakeAgentStep.ts";
import { git } from "./GitFixture.ts";
import type { Handoff } from "./implementStep.ts";
import type { ResolveRecord } from "./resolveStep.ts";
import {
  addSpec,
  after,
  bodyWith,
  bodyWithTargets,
  capped,
  eventOf,
  findingOf,
  github,
  greened,
  handoffResultOf,
  implemented,
  noConversation,
  primaryOf,
  progressLines,
  refOf,
  resolved,
  resultOf,
  reviewed,
  spec,
  specRun,
  stateFolder,
  type StepScript,
  ticketFacts,
  ticketState,
  timed,
  timingLines,
  useSpecRunHarness,
} from "./specRunHarness.ts";

useSpecRunHarness();

describe("run's resolve", () => {
  const opusMedium: Pair = { model: "opus", effort: "medium" };
  const opusHigh: Pair = { model: "opus", effort: "high" };
  const findings = [findingOf(1), findingOf(2)];

  function recordOf(
    finding: number,
    verdict: ResolveRecord["verdict"],
    axis: ResolveRecord["axis"] = "standards",
  ): ResolveRecord {
    const base = {
      finding,
      axis,
      where: `one.ts:${finding}`,
      claim: `Line ${finding} is wrong.`,
      evidence: "Checked it.",
    };
    if (verdict === "fix") {
      return {
        ...base,
        verdict,
        quote: `one.ts:${finding} \`export {};\``,
        rule: "config/docs/code-style.md: a rule.",
      };
    }
    if (verdict === "dismiss") {
      return { ...base, verdict, reason: "false-positive" };
    }
    if (verdict === "propose") {
      return { ...base, verdict, reason: "decision", recommendation: "Pick." };
    }
    return { ...base, verdict, recommendation: "Answer it." };
  }

  function stepOf(
    result: StepResult | StepScript,
    facts: Partial<StepResult>,
  ): StepScript {
    return async (request) => {
      const base =
        typeof result === "function" ? await result(request) : result;
      return { ...base, ...facts };
    };
  }

  function implementedAt(peakContext: number): StepScript {
    return stepOf(implemented("one.ts"), {
      sessionId: "implement-session",
      peakContext,
    });
  }

  function handedOffAt(peakContext: number): StepScript {
    const handoff: Handoff = {
      conclusion: "Half done.",
      filesToOpen: [],
      ruledOut: [],
      filesChanged: [],
      stillFailing: [],
    };
    return stepOf(handoffResultOf(handoff), {
      sessionId: "handoff-session",
      peakContext,
    });
  }

  function freshResolved(
    records: ResolveRecord[],
    fixFile?: string,
  ): StepScript {
    return stepOf(resolved(records, fixFile), { sessionId: "fresh-session" });
  }

  // Leaves an uncommitted edit, then is killed at the live ceiling.
  function killed(file: string): StepScript {
    return async (request) => {
      writeFileSync(join(request.cwd, file), "half a fix\n");
      return {
        ...resultOf(undefined),
        output: { status: "none" },
        exitSubtype: undefined,
        peakContext: 181_000,
        hasCrossedCeiling: true,
      };
    };
  }

  function ticketRunState(): {
    step: string;
    resolveRecords?: ResolveRecord[];
    resolver?: string;
  } {
    const path = join(stateFolder(), "byro-repo-213.run.json");
    const state = JSON.parse(readFileSync(path, "utf8")) as {
      tickets: Record<string, ReturnType<typeof ticketRunState>>;
    };
    return state.tickets["byro-repo #1"] ?? { step: "none" };
  }

  // The landed branch's commits, newest first.
  function landedSubjects(count: number): string[] {
    const primary = primaryOf("byro-repo");
    const merge = git(
      primary,
      "log",
      "--merges",
      "-1",
      "--format=%H",
      "master",
    );
    return git(primary, "log", "--format=%s", `-${count}`, `${merge}^2`).split(
      "\n",
    );
  }

  function reviewListOf(ticket: number): string | undefined {
    return github.comments
      .map(({ body }) => body)
      .find((body) => body.includes(`<!-- review-list ticket=#${ticket} -->`));
  }

  it("skips resolve when review finds nothing", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(implementedAt(90_000), reviewed());

    const result = await specRun(agentStep).run(spec);

    expect(result.kind).toBe("finished");
    expect(agentStep.requests).toHaveLength(2);
    expect(ticketFacts().reviewFixes).toBe("none");
  });

  it("resolves in one session resumed from the implementer under the ticket budget, landing the fixes as one commit and the Propose on the review list", async () => {
    addSpec([1]);
    github.edit(1, { body: bodyWithTargets("app spreadsheet") });
    const agentStep = FakeAgentStep.init(
      implementedAt(90_000),
      reviewed(findings),
      resolved([recordOf(1, "fix"), recordOf(2, "propose")], "fix.ts"),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.kind).toBe("finished");
    expect(agentStep.requests).toHaveLength(3);
    const resolver = agentStep.requests[2];
    expect(resolver?.resumeSessionId).toBe("implement-session");
    expect(resolver?.pair).toEqual(opusHigh);
    expect(resolver?.targets).toEqual([{ kind: "spreadsheet", name: "app" }]);
    expect(resolver?.liveCeiling).toBe(180_000);
    expect(landedSubjects(3)).toEqual([
      "Fix fix.ts",
      "Add one.ts",
      "Initial commit",
    ]);
    expect(reviewListOf(1)).toContain(
      "**R1.1** · Propose `decision` · Finding 2: Line 2 is wrong. (one.ts:2)",
    );
    expect(ticketFacts()).toMatchObject({
      reviewFixes: "implementer",
      whatReviewCaught:
        "Fixed: Line 1 is wrong. (one.ts:1). Proposed: Line 2 is wrong. (one.ts:2).",
    });
  });

  it("keeps a Dismiss, a Propose and a Halt with no commit and halts the ticket", async () => {
    addSpec([1]);
    const records = [
      recordOf(1, "dismiss"),
      recordOf(2, "propose"),
      recordOf(3, "halt", "spec"),
    ];
    const agentStep = FakeAgentStep.init(
      implementedAt(90_000),
      reviewed([...findings, findingOf(3, "spec")]),
      resolved(records),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.kind).toBe("stopped");
    expect(ticketRunState()).toMatchObject({
      step: "halted",
      resolveRecords: records,
    });
    expect(ticketRunState().resolver).toBeUndefined();
    expect(result.message).toContain("byro-repo #1 waits on Halt H1");
    expect(github.comments[0]?.body).toContain(
      '**Halt H1** · Halt 1 of 1 · byro-repo #1, "Ticket 1" · verdict Halt',
    );
    expect(github.comments[0]?.body).toContain("Blocks: the whole spec.");
  });

  it("keeps each finding's reviewer axis and suggested verdict on its record, whatever the resolver wrote", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      implementedAt(90_000),
      reviewed([findingOf(1, "spec", "dismiss"), findingOf(2)]),
      resolved([recordOf(1, "dismiss"), recordOf(2, "dismiss", "spec")]),
    );

    await specRun(agentStep).run(spec);

    expect(ticketRunState().resolveRecords).toMatchObject([
      { finding: 1, axis: "spec", suggestedVerdict: "dismiss" },
      { finding: 2, axis: "standards", suggestedVerdict: "fix" },
    ]);
  });

  it("resolves in a fresh session on the stronger pair once the implementer's peak reaches the ticket budget", async () => {
    addSpec([1]);
    github.edit(1, { body: bodyWith("Sonnet high") });
    const agentStep = FakeAgentStep.init(
      implementedAt(150_000),
      reviewed(findings),
      freshResolved([recordOf(1, "fix"), recordOf(2, "fix")], "fix.ts"),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.kind).toBe("finished");
    const resolver = agentStep.requests[2];
    expect(resolver?.resumeSessionId).toBeUndefined();
    expect(resolver?.pair).toEqual(opusMedium);
    expect(resolver?.prompt).toContain("You are the resolve step");
    expect(landedSubjects(2)).toEqual(["Fix fix.ts", "Add one.ts"]);
    expect(ticketFacts().reviewFixes).toBe("fresh");
  });

  it("resolves in a fresh session when the implementer's session has no conversation, and lands", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      implementedAt(90_000),
      reviewed(findings),
      noConversation,
      freshResolved([recordOf(1, "fix"), recordOf(2, "fix")], "fix.ts"),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(agentStep.requests[2]?.resumeSessionId).toBe("implement-session");
    const resolver = agentStep.requests[3];
    expect(resolver?.resumeSessionId).toBeUndefined();
    expect(resolver?.prompt).toContain("You are the resolve step");
    expect(landedSubjects(2)).toEqual(["Fix fix.ts", "Add one.ts"]);
    expect(ticketFacts().reviewFixes).toBe("fresh");
    expect(progressLines().map(eventOf)).toContain(
      "byro-repo #1: the resolve step's session implement-session has no conversation; running it as a fresh session.",
    );
  });

  it.each([
    {
      resolver: "implementer",
      handoffPeak: 150_000,
      freshPeak: 90_000,
      resumeSessionId: "implement-session",
    },
    {
      resolver: "fresh",
      handoffPeak: 90_000,
      freshPeak: 150_000,
      resumeSessionId: undefined,
    },
  ])(
    "resolves after a handoff as the $resolver resolver when the last implement step peaked at $freshPeak",
    async ({ resolver, handoffPeak, freshPeak, resumeSessionId }) => {
      addSpec([1]);
      const agentStep = FakeAgentStep.init(
        handedOffAt(handoffPeak),
        implementedAt(freshPeak),
        reviewed(findings),
        resolved([recordOf(1, "fix"), recordOf(2, "dismiss")], "fix.ts"),
      );

      const result = await specRun(agentStep).run(spec);

      expect(result.kind).toBe("finished");
      expect(agentStep.requests[3]?.resumeSessionId).toBe(resumeSessionId);
      expect(ticketFacts().reviewFixes).toBe(resolver);
    },
  );

  it("kills an implementer that crosses the live ceiling, discards its work and resolves in a fresh session", async () => {
    addSpec([1]);
    let leftover = false;
    const agentStep = FakeAgentStep.init(
      implementedAt(90_000),
      reviewed(findings),
      killed("half.ts"),
      async (request) => {
        leftover = existsSync(join(request.cwd, "half.ts"));
        return resolved(
          [recordOf(1, "fix"), recordOf(2, "fix")],
          "fix.ts",
        )(request);
      },
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.kind).toBe("finished");
    expect(leftover).toBe(false);
    const resolver = agentStep.requests[3];
    expect(resolver?.resumeSessionId).toBeUndefined();
    expect(resolver?.pair).toEqual(opusHigh);
    expect(landedSubjects(2)).toEqual(["Fix fix.ts", "Add one.ts"]);
    expect(ticketFacts().reviewFixes).toBe("fresh");
  });

  it("Stops on a step error, its work discarded, when the fresh resolver crosses the live ceiling", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      implementedAt(150_000),
      reviewed(findings),
      killed("half.ts"),
    );
    const run = specRun(agentStep);

    const result = await run.run(spec);

    expect(result.message).toBe("Stopped on byro-repo #1: a step error.");
    const workspace = await run.workspaces.find(refOf(1));
    expect(existsSync(join(workspace?.path ?? "", "half.ts"))).toBe(false);
    expect(github.comments[0]?.body).toContain(
      "The fresh resolver crossed the live ceiling of 180000",
    );
  });

  it("gives a refused record one retry in the same session, then lands", async () => {
    addSpec([1]);
    const noQuote = { ...recordOf(1, "fix"), quote: undefined };
    const agentStep = FakeAgentStep.init(
      implementedAt(90_000),
      reviewed(findings),
      resolved([noQuote, recordOf(2, "dismiss")], "fix.ts"),
      stepOf(resolved([recordOf(1, "fix"), recordOf(2, "dismiss")]), {
        sessionId: "retried-session",
      }),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.kind).toBe("finished");
    const retry = agentStep.requests[3];
    expect(retry?.resumeSessionId).toBe("session");
    expect(retry?.prompt).toContain(
      "finding 1: a Fix needs `quote`, the quoted code or text, with its file:line",
    );
    expect(landedSubjects(2)).toEqual(["Fix fix.ts", "Add one.ts"]);
  });

  it("gives a fresh resolver the findings and the refusal when the retry's session has no conversation", async () => {
    addSpec([1]);
    const noQuote = { ...recordOf(1, "fix"), quote: undefined };
    const agentStep = FakeAgentStep.init(
      implementedAt(90_000),
      reviewed(findings),
      resolved([noQuote, recordOf(2, "dismiss")], "fix.ts"),
      noConversation,
      freshResolved([recordOf(1, "fix"), recordOf(2, "dismiss")]),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    const resolver = agentStep.requests[4];
    expect(resolver?.resumeSessionId).toBeUndefined();
    expect(resolver?.prompt).toContain("You are the resolve step");
    expect(resolver?.prompt).toContain(
      "finding 1: a Fix needs `quote`, the quoted code or text, with its file:line",
    );
  });

  it("hands the findings to a fresh resolver, its work discarded, when the implementer's retry crosses the live ceiling", async () => {
    addSpec([1]);
    const noQuote = { ...recordOf(1, "fix"), quote: undefined };
    const agentStep = FakeAgentStep.init(
      implementedAt(90_000),
      reviewed(findings),
      resolved([noQuote, recordOf(2, "dismiss")], "fix.ts"),
      killed("half.ts"),
      freshResolved([recordOf(1, "fix"), recordOf(2, "dismiss")], "fix.ts"),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.kind).toBe("finished");
    const resolver = agentStep.requests[4];
    expect(resolver?.resumeSessionId).toBeUndefined();
    expect(resolver?.pair).toEqual(opusHigh);
    expect(landedSubjects(2)).toEqual(["Fix fix.ts", "Add one.ts"]);
    expect(ticketFacts().reviewFixes).toBe("fresh");
  });

  it("reruns the resolve, its work reset away, when the retry hits its turn cap", async () => {
    addSpec([1]);
    const noQuote = { ...recordOf(1, "fix"), quote: undefined };
    const agentStep = FakeAgentStep.init(
      implementedAt(90_000),
      reviewed(findings),
      resolved([noQuote, recordOf(2, "dismiss")], "fix.ts"),
      capped,
      resolved([recordOf(1, "fix"), recordOf(2, "dismiss")], "fix.ts"),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.kind).toBe("finished");
    expect(agentStep.requests[4]?.prompt).toContain("You are the resolve step");
    expect(landedSubjects(2)).toEqual(["Fix fix.ts", "Add one.ts"]);
  });

  it("refuses a suggested Halt resolved as a Fix, and lands once the retry Halts it", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      implementedAt(90_000),
      reviewed([findingOf(1, "spec", "halt")]),
      resolved([recordOf(1, "fix", "spec")], "fix.ts"),
      async (request) => {
        git(request.cwd, "revert", "--no-edit", "HEAD");
        return resolved([recordOf(1, "halt", "spec")])(request);
      },
    );

    await specRun(agentStep).run(spec);

    expect(agentStep.requests[3]?.prompt).toContain(
      "finding 1: a suggested Halt resolves only as a Halt or a Propose `decision`",
    );
    expect(ticketRunState()).toMatchObject({
      step: "halted",
      resolveRecords: [{ verdict: "halt", suggestedVerdict: "halt" }],
    });
  });

  it("refuses a Fix the resolver never committed", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      implementedAt(90_000),
      reviewed(findings),
      resolved([recordOf(1, "fix"), recordOf(2, "dismiss")]),
      resolved([recordOf(1, "fix"), recordOf(2, "dismiss")], "fix.ts"),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.kind).toBe("finished");
    expect(agentStep.requests[3]?.prompt).toContain(
      "the records give a Fix, but the step committed no change",
    );
  });

  it("posts a Failure Halt when the resolver leaves uncommitted changes through its retry", async () => {
    addSpec([1]);
    const dirty: StepScript = async (request) => {
      writeFileSync(join(request.cwd, "unreverted.ts"), "export {};\n");
      return resolved(
        [recordOf(1, "fix"), recordOf(2, "dismiss")],
        "fix.ts",
      )(request);
    };
    const agentStep = FakeAgentStep.init(
      implementedAt(90_000),
      reviewed(findings),
      dirty,
      resolved([recordOf(1, "fix"), recordOf(2, "dismiss")]),
    );

    await specRun(agentStep).run(spec);

    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    const halt = github.comments.at(-1)?.body;
    expect(halt).toContain("Failure Halt");
    expect(halt).toContain("byro-repo: the step left uncommitted changes");
    expect(halt).toContain("Raw output: `");
  });

  it("posts a Failure Halt on a second refused record", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      implementedAt(90_000),
      reviewed(findings),
      resolved([recordOf(1, "dismiss")]),
      resolved([recordOf(1, "dismiss")]),
    );

    await specRun(agentStep).run(spec);

    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    const halt = github.comments.at(-1)?.body;
    expect(halt).toContain("Failure Halt");
    expect(halt).toContain(
      "finding 2: each finding gets exactly one verdict, but it got 0",
    );
    expect(halt).toContain("Raw output: `");
  });

  it("posts a Failure Halt at once when the resolve output fails its schema", async () => {
    addSpec([1]);
    const unmatched: StepResult = {
      ...resultOf(undefined),
      output: {
        status: "schemaFailure",
        rawOutput: "{}",
        problems: ["records is required"],
      },
    };

    await specRun(
      FakeAgentStep.init(implementedAt(90_000), reviewed(findings), unmatched),
    ).run(spec);

    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    const halt = github.comments.at(-1)?.body;
    expect(halt).toContain("Failure Halt");
    expect(halt).toContain("records is required");
    expect(halt).toContain("-resolve.output.txt`");
  });

  it("runs the checks after the resolve, resuming the resolver on red", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      implementedAt(150_000),
      reviewed(findings),
      freshResolved([recordOf(1, "fix"), recordOf(2, "dismiss")], "RED"),
      greened(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.kind).toBe("finished");
    const resumed = agentStep.requests[3];
    expect(resumed?.resumeSessionId).toBe("fresh-session");
    expect(resumed?.prompt).toContain("You are the red-checks step");
  });

  it("saves a crashed resolve's uncommitted work to a backup branch and resumes it", async () => {
    addSpec([1]);
    let branch = "";
    const agentStep = FakeAgentStep.init(
      implementedAt(90_000),
      reviewed(findings),
      async (request) => {
        writeFileSync(join(request.cwd, "half.ts"), "half a fix\n");
        branch = git(request.cwd, "branch", "--show-current");
        return {
          ...resultOf(undefined),
          output: { status: "none" },
          sessionId: "fix-session",
          exitSubtype: "error_during_execution",
        };
      },
      resolved([recordOf(1, "fix"), recordOf(2, "dismiss")], "two.ts"),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.kind).toBe("finished");
    expect(
      git(primaryOf("byro-repo"), "show", `backup/${branch}-resolve:half.ts`),
    ).toBe("half a fix");
    const retry = agentStep.requests[3];
    expect(retry?.resumeSessionId).toBe("fix-session");
    expect(retry?.prompt).toContain("set aside on a backup branch");
  });

  it("logs the resolve step's time between review's and the checks'", async () => {
    addSpec([1]);

    await specRun(
      FakeAgentStep.init(
        implementedAt(90_000),
        reviewed(findings),
        after(
          70,
          resolved([recordOf(1, "fix"), recordOf(2, "dismiss")], "fix.ts"),
        ),
      ),
      timed(),
    ).run(spec);

    expect(timingLines().slice(3)).toEqual([
      "byro-repo #1: implement took 0s.",
      "byro-repo #1: review took 0s.",
      "byro-repo #1: resolve took 70s.",
      "byro-repo #1: checks took 0s.",
      "byro-repo #1: wrap-up took 0s.",
    ]);
  });
});
