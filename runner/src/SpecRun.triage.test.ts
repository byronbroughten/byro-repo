import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { Pair, StepResult } from "./AgentStep.ts";
import { FakeAgentStep } from "./FakeAgentStep.ts";
import type { TriageRecord } from "./findingTriage.ts";
import type { FixOutcome } from "./fixStep.ts";
import { git } from "./GitFixture.ts";
import type { Handoff } from "./implementStep.ts";
import {
  addSpec,
  after,
  bodyWith,
  bodyWithTargets,
  github,
  greened,
  handoffResultOf,
  implemented,
  primaryOf,
  refOf,
  resultOf,
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

describe("run's finding triage", () => {
  const opusMedium: Pair = { model: "opus", effort: "medium" };
  const opusHigh: Pair = { model: "opus", effort: "high" };
  const findings = ["one.ts:1 is wrong.", "one.ts:2 is wrong."];

  function triageRecordOf(
    finding: number,
    verdict: TriageRecord["verdict"],
    axis: TriageRecord["axis"] = "standards",
  ): TriageRecord {
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

  function triaged(...records: TriageRecord[]): StepScript {
    return stepOf(resultOf({ records }), { sessionId: "triage-session" });
  }

  // Commits `file` as the fix commit, as a fixer would, and returns its outcomes.
  function fixed(file: string, ...outcomes: FixOutcome[]): StepScript {
    return async (request) => {
      writeFileSync(join(request.cwd, file), "export {};\n");
      git(request.cwd, "add", file);
      git(request.cwd, "commit", "-m", `Fix ${file}`);
      return resultOf({ outcomes });
    };
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
    triage?: TriageRecord[];
    fixer?: string;
  } {
    const path = join(stateFolder(), "byro-repo-213.run.json");
    const state = JSON.parse(readFileSync(path, "utf8")) as {
      tickets: Record<string, ReturnType<typeof ticketRunState>>;
    };
    return state.tickets["byro-repo #1"] ?? { step: "none" };
  }

  function factsOf(): {
    reviewFixes?: string;
    proposals?: number;
    halt?: string;
  } {
    const path = join(stateFolder(), "byro-repo-1.facts.json");
    return JSON.parse(readFileSync(path, "utf8")) as ReturnType<typeof factsOf>;
  }

  it("skips triage and the fix step when review finds nothing", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(implementedAt(90_000), reviewed());

    const result = await specRun(agentStep).run(spec);

    expect(result.kind).toBe("finished");
    expect(agentStep.requests).toHaveLength(2);
    expect(factsOf().reviewFixes).toBe("none");
  });

  it("keeps a Dismiss, a Propose and a Halt in run state and halts with no fix step, the triage step on its own pair with no targets", async () => {
    addSpec([1]);
    github.edit(1, { body: bodyWithTargets("app spreadsheet") });
    const records = [
      triageRecordOf(1, "dismiss"),
      triageRecordOf(2, "propose"),
      triageRecordOf(3, "halt", "spec"),
    ];
    const agentStep = FakeAgentStep.init(
      implementedAt(90_000),
      reviewed([...findings, "one.ts:3 is wrong."]),
      triaged(...records),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.kind).toBe("stopped");
    const triage = agentStep.requests[2];
    expect(triage?.pair).toEqual(opusMedium);
    expect(triage?.targets).toEqual([]);
    expect(triage?.prompt).toContain("3. one.ts:3 is wrong.");
    expect(ticketRunState()).toMatchObject({ step: "halted", triage: records });
    expect(result.message).toContain("byro-repo #1 waits on Halt H1");
    expect(github.comments[0]?.body).toContain(
      '**Halt H1** · Halt 1 of 1 · byro-repo #1, "Ticket 1" · triage Halt',
    );
    expect(github.comments[0]?.body).toContain("Blocks: the whole spec.");
  });

  it("hands the Fix batch to the resumed implementer under the ticket budget, landing the fix as its own commit", async () => {
    addSpec([1]);
    github.edit(1, { body: bodyWithTargets("app spreadsheet") });
    const agentStep = FakeAgentStep.init(
      implementedAt(90_000),
      reviewed(findings),
      triaged(triageRecordOf(1, "fix"), triageRecordOf(2, "dismiss")),
      fixed("fix.ts", { finding: 1, status: "fixed" }),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.kind).toBe("finished");
    const fixer = agentStep.requests[3];
    expect(fixer?.resumeSessionId).toBe("implement-session");
    expect(fixer?.pair).toEqual(opusHigh);
    expect(fixer?.targets).toEqual([{ kind: "spreadsheet", name: "app" }]);
    expect(fixer?.liveCeiling).toBe(180_000);
    expect(fixer?.prompt).toContain("Finding 1: Line 1 is wrong.");
    expect(fixer?.prompt).not.toContain("Finding 2");
    const merge = git(
      primaryOf("byro-repo"),
      "log",
      "--merges",
      "-1",
      "--format=%H",
      "master",
    );
    expect(
      git(primaryOf("byro-repo"), "log", "--format=%s", "-3", `${merge}^2`),
    ).toBe(["Fix fix.ts", "Add one.ts", "Initial commit"].join("\n"));
    expect(factsOf().reviewFixes).toBe("implementer");
  });

  it("hands the Fix batch to the triage agent on the stronger pair once the implementer's peak reaches the ticket budget", async () => {
    addSpec([1]);
    github.edit(1, { body: bodyWith("Sonnet high") });
    const agentStep = FakeAgentStep.init(
      implementedAt(150_000),
      reviewed(findings),
      triaged(triageRecordOf(1, "fix"), triageRecordOf(2, "fix")),
      fixed(
        "fix.ts",
        { finding: 1, status: "fixed" },
        { finding: 2, status: "fixed" },
      ),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.kind).toBe("finished");
    const fixer = agentStep.requests[3];
    expect(fixer?.resumeSessionId).toBe("triage-session");
    expect(fixer?.pair).toEqual(opusMedium);
    expect(factsOf().reviewFixes).toBe("triage");
  });

  it.each([
    {
      fixer: "implementer",
      handoffPeak: 150_000,
      freshPeak: 90_000,
      resumeSessionId: "implement-session",
    },
    {
      fixer: "triage",
      handoffPeak: 90_000,
      freshPeak: 150_000,
      resumeSessionId: "triage-session",
    },
  ])(
    "hands a fix after a handoff to the $fixer when the last implement step peaked at $freshPeak",
    async ({ fixer, handoffPeak, freshPeak, resumeSessionId }) => {
      addSpec([1]);
      const agentStep = FakeAgentStep.init(
        handedOffAt(handoffPeak),
        implementedAt(freshPeak),
        reviewed(findings),
        triaged(triageRecordOf(1, "fix"), triageRecordOf(2, "dismiss")),
        fixed("fix.ts", { finding: 1, status: "fixed" }),
      );

      const result = await specRun(agentStep).run(spec);

      expect(result.kind).toBe("finished");
      expect(agentStep.requests[4]?.resumeSessionId).toBe(resumeSessionId);
      expect(factsOf().reviewFixes).toBe(fixer);
    },
  );

  it("kills a fixer that crosses the live ceiling, discards its work and hands the batch to the triage agent", async () => {
    addSpec([1]);
    let leftover = false;
    const agentStep = FakeAgentStep.init(
      implementedAt(90_000),
      reviewed(findings),
      triaged(triageRecordOf(1, "fix"), triageRecordOf(2, "fix")),
      killed("half.ts"),
      async (request) => {
        leftover = existsSync(join(request.cwd, "half.ts"));
        return fixed(
          "fix.ts",
          { finding: 1, status: "fixed" },
          { finding: 2, status: "fixed" },
        )(request);
      },
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.kind).toBe("finished");
    expect(leftover).toBe(false);
    const fixer = agentStep.requests[4];
    expect(fixer?.resumeSessionId).toBe("triage-session");
    expect(fixer?.pair).toEqual(opusHigh);
    expect(fixer?.prompt).toContain("Finding 2: Line 2 is wrong.");
    expect(factsOf().reviewFixes).toBe("triage");
  });

  it("Stops on a step error, its work discarded, when the triage agent's fix crosses the live ceiling", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      implementedAt(150_000),
      reviewed(findings),
      triaged(triageRecordOf(1, "fix"), triageRecordOf(2, "dismiss")),
      killed("half.ts"),
    );
    const run = specRun(agentStep);

    const result = await run.run(spec);

    expect(result.message).toBe("Stopped on byro-repo #1: a step error.");
    const workspace = await run.workspaces.find(refOf(1));
    expect(existsSync(join(workspace?.path ?? "", "half.ts"))).toBe(false);
    expect(github.comments[0]?.body).toContain(
      "The triage agent's fix crossed the live ceiling of 180000",
    );
  });

  it("turns a spec-axis give-up into a Halt on the downstream tickets and a standards-axis one into a Propose `decision`", async () => {
    addSpec([1, 2, 3]);
    github.blockers.set(2, [1]);
    github.blockers.set(3, [2]);
    const agentStep = FakeAgentStep.init(
      implementedAt(90_000),
      reviewed(findings),
      triaged(triageRecordOf(1, "fix", "spec"), triageRecordOf(2, "fix")),
      async () =>
        resultOf({
          outcomes: [
            {
              finding: 1,
              status: "gave-up",
              reason: "judgement-call",
              note: "The spec reads both ways.",
            },
            {
              finding: 2,
              status: "gave-up",
              reason: "checks-red",
              note: "The fix breaks a test.",
            },
          ],
        }),
    );

    const result = await specRun(agentStep).run(spec);

    expect(ticketRunState().triage).toMatchObject([
      {
        finding: 1,
        verdict: "halt",
        reason: "judgement-call",
        haltScope: ["byro-repo#2", "byro-repo#3"],
      },
      { finding: 2, verdict: "propose", reason: "decision" },
    ]);
    expect(agentStep.requests).toHaveLength(4);
    expect(result.message).toContain("byro-repo #2 waits on Halt H1");
    expect(result.message).toContain("byro-repo #3 waits on Halt H1");
    expect(github.comments[0]?.body).toContain(
      'Halt 1 of 1 · byro-repo #1, "Ticket 1" · fixer give-up',
    );
    expect(github.comments[0]?.body).toContain(
      "Blocks: byro-repo#2, byro-repo#3 and their downstream.",
    );
  });

  it.each([
    { fixerPeak: 120_000, resumeSessionId: "fixer-session" },
    { fixerPeak: 160_000, resumeSessionId: undefined },
  ])(
    "resumes a give-up's ticket in the implementer's fix session only while its peak is under the ticket budget, then lands it: $fixerPeak",
    async ({ fixerPeak, resumeSessionId }) => {
      addSpec([1]);
      const gaveUp = stepOf(
        resultOf({
          outcomes: [
            {
              finding: 1,
              status: "gave-up",
              reason: "judgement-call",
              note: "The spec reads both ways.",
            },
          ],
        }),
        { sessionId: "fixer-session", peakContext: fixerPeak },
      );
      await specRun(
        FakeAgentStep.init(
          implementedAt(90_000),
          reviewed(findings),
          triaged(
            triageRecordOf(1, "fix", "spec"),
            triageRecordOf(2, "dismiss"),
          ),
          gaveUp,
        ),
      ).run(spec);
      github.reply(213, "H1: read it the first way.");
      const agentStep = FakeAgentStep.init(implemented("fix.ts"));

      const result = await specRun(agentStep).run(spec);

      expect(result.message).toContain("landed byro-repo #1");
      expect(agentStep.requests).toHaveLength(1);
      expect(agentStep.requests[0]?.resumeSessionId).toBe(resumeSessionId);
      expect(agentStep.requests[0]?.prompt).toContain(
        "H1: read it the first way.",
      );
      expect(factsOf().halt).toBe("fixer give-up");
    },
  );

  it("posts a Failure Halt when the fixer leaves uncommitted changes", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      implementedAt(90_000),
      reviewed(findings),
      triaged(triageRecordOf(1, "fix"), triageRecordOf(2, "fix")),
      async (request) => {
        writeFileSync(join(request.cwd, "unreverted.ts"), "export {};\n");
        return fixed(
          "fix.ts",
          { finding: 1, status: "fixed" },
          {
            finding: 2,
            status: "gave-up",
            reason: "checks-red",
            note: "The fix breaks a test.",
          },
        )(request);
      },
    );

    await specRun(agentStep).run(spec);

    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    const halt = github.comments.at(-1)?.body;
    expect(halt).toContain("Failure Halt");
    expect(halt).toContain("byro-repo: the step left uncommitted changes");
    expect(halt).toContain("Raw output: `");
  });

  it("runs the checks after the fixes, resuming the fixer on red", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      implementedAt(90_000),
      reviewed(findings),
      triaged(triageRecordOf(1, "fix"), triageRecordOf(2, "dismiss")),
      fixed("RED", { finding: 1, status: "fixed" }),
      greened(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.kind).toBe("finished");
    const resumed = agentStep.requests[4];
    expect(resumed?.resumeSessionId).toBe("session"); // The fix step's, which made the last commit.
    expect(resumed?.prompt).toContain("You are the red-checks step");
  });

  it("saves a crashed fix step's uncommitted work to a backup branch and resumes it", async () => {
    addSpec([1]);
    let branch = "";
    const agentStep = FakeAgentStep.init(
      implementedAt(90_000),
      reviewed(findings),
      triaged(triageRecordOf(1, "fix"), triageRecordOf(2, "dismiss")),
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
      fixed("two.ts", { finding: 1, status: "fixed" }),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.kind).toBe("finished");
    expect(
      git(primaryOf("byro-repo"), "show", `backup/${branch}-fix:half.ts`),
    ).toBe("half a fix");
    const retry = agentStep.requests[4];
    expect(retry?.resumeSessionId).toBe("fix-session");
    expect(retry?.prompt).toContain("set aside on a backup branch");
  });

  it("gives a refused triage record one retry in the same session, then lands", async () => {
    addSpec([1]);
    const noQuote = { ...triageRecordOf(1, "fix"), quote: undefined };
    const agentStep = FakeAgentStep.init(
      implementedAt(90_000),
      reviewed(findings),
      triaged(noQuote, triageRecordOf(2, "dismiss")),
      triaged(triageRecordOf(1, "dismiss"), triageRecordOf(2, "dismiss")),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.kind).toBe("finished");
    const retry = agentStep.requests[3];
    expect(retry?.resumeSessionId).toBe("triage-session");
    expect(retry?.targets).toEqual([]);
    expect(retry?.prompt).toContain(
      "finding 1: a Fix needs `quote`, the quoted code with its file:line",
    );
  });

  it("posts a Failure Halt on a second refused triage record", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      implementedAt(90_000),
      reviewed(findings),
      triaged(triageRecordOf(1, "dismiss")),
      triaged(triageRecordOf(1, "dismiss")),
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

  it.each([
    { step: "triage", fixes: [] },
    {
      step: "fix",
      fixes: [triaged(triageRecordOf(1, "fix"), triageRecordOf(2, "dismiss"))],
    },
  ])(
    "posts a Failure Halt at once when the $step output fails its schema",
    async ({ step, fixes }) => {
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
        FakeAgentStep.init(
          implementedAt(90_000),
          reviewed(findings),
          ...fixes,
          unmatched,
        ),
      ).run(spec);

      expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
      const halt = github.comments.at(-1)?.body;
      expect(halt).toContain("Failure Halt");
      expect(halt).toContain("records is required");
      expect(halt).toContain(`-${step}.output.txt\``);
    },
  );

  it("logs the triage and fix steps' times between review's and the checks'", async () => {
    addSpec([1]);

    await specRun(
      FakeAgentStep.init(
        implementedAt(90_000),
        reviewed(findings),
        after(
          40,
          triaged(triageRecordOf(1, "fix"), triageRecordOf(2, "dismiss")),
        ),
        after(70, fixed("fix.ts", { finding: 1, status: "fixed" })),
      ),
      timed(),
    ).run(spec);

    expect(timingLines().slice(3)).toEqual([
      "byro-repo #1: implement took 0s.",
      "byro-repo #1: review took 0s.",
      "byro-repo #1: triage took 40s.",
      "byro-repo #1: fix took 70s.",
      "byro-repo #1: checks took 0s.",
      "byro-repo #1: wrap-up took 0s.",
    ]);
  });
});
