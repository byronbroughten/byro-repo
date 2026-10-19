import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { Pair, StepResult } from "./AgentStep.ts";
import { FakeAgentStep } from "./FakeAgentStep.ts";
import type { TriageRecord } from "./findingTriage.ts";
import type { FixOutcome } from "./fixStep.ts";
import { git } from "./GitFixture.ts";
import {
  addSpec,
  after,
  bodyWith,
  bodyWithTargets,
  github,
  implemented,
  primaryOf,
  refOf,
  resultOf,
  reviewed,
  spec,
  specRun,
  stateFolder,
  type StepScript,
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
    if (verdict === "defer") {
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

  function factsOf(): { reviewFixes?: string; defers?: number } {
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

  it("keeps a Dismiss, a Defer and a Halt in run state and lands with no fix step, the triage step on its own pair with no targets", async () => {
    addSpec([1]);
    github.edit(1, { body: bodyWithTargets("app spreadsheet") });
    const records = [
      triageRecordOf(1, "dismiss"),
      triageRecordOf(2, "defer"),
      triageRecordOf(3, "halt", "spec"),
    ];
    const agentStep = FakeAgentStep.init(
      implementedAt(90_000),
      reviewed([...findings, "one.ts:3 is wrong."]),
      triaged(...records),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.kind).toBe("finished");
    const triage = agentStep.requests[2];
    expect(triage?.pair).toEqual(opusMedium);
    expect(triage?.targets).toEqual([]);
    expect(triage?.prompt).toContain("3. one.ts:3 is wrong.");
    expect(ticketRunState().triage).toEqual(records);
    expect(factsOf()).toMatchObject({ reviewFixes: "none", defers: 1 });
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

  it("turns a spec-axis give-up into a Halt on the downstream tickets and a standards-axis one into a Defer `decision`", async () => {
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
      implemented("two.ts"),
      reviewed(),
      implemented("three.ts"),
      reviewed(),
    );

    await specRun(agentStep).run(spec);

    expect(ticketRunState().triage).toMatchObject([
      {
        finding: 1,
        verdict: "halt",
        reason: "judgement-call",
        haltScope: ["byro-repo#2", "byro-repo#3"],
      },
      { finding: 2, verdict: "defer", reason: "decision" },
    ]);
    expect(factsOf()).toMatchObject({ reviewFixes: "none", defers: 1 });
  });

  it("Stops on a schema failure when the fixer leaves uncommitted changes", async () => {
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

    const result = await specRun(agentStep).run(spec);

    expect(result.message).toBe("Stopped on byro-repo #1: a schema failure.");
    expect(github.comments[0]?.body).toContain(
      "byro-repo: the step left uncommitted changes",
    );
  });

  it("runs the checks after the fixes", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      implementedAt(90_000),
      reviewed(findings),
      triaged(triageRecordOf(1, "fix"), triageRecordOf(2, "dismiss")),
      fixed("RED", { finding: 1, status: "fixed" }),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.message).toBe("Stopped on byro-repo #1: red checks.");
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

  it("fails the step on a second refused triage record", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      implementedAt(90_000),
      reviewed(findings),
      triaged(triageRecordOf(1, "dismiss")),
      triaged(triageRecordOf(1, "dismiss")),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.message).toBe("Stopped on byro-repo #1: a schema failure.");
    expect(github.comments[0]?.body).toContain(
      "finding 2: each finding gets exactly one verdict, but it got 0",
    );
  });

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
