import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { StepRequest, StepResult } from "./AgentStep.ts";
import { FakeAgentStep } from "./FakeAgentStep.ts";
import { git } from "./GitFixture.ts";
import {
  type Handoff,
  handoffOnlyPrompt,
  type ImplementRecord,
} from "./implementStep.ts";
import {
  addSpec,
  bodyWith,
  capped,
  crashed,
  github,
  haltComments,
  implemented,
  implementResultOf,
  primaryOf,
  refOf,
  resultOf,
  reviewed,
  runStatePath,
  spec,
  specRun,
  stateFolder,
  type StepScript,
  ticketState,
  useSpecRunHarness,
} from "./specRunHarness.ts";

useSpecRunHarness();

const handoff: Handoff = {
  conclusion: "The parser is half done.",
  filesToOpen: [{ path: "half.ts", lines: "1-1" }],
  ruledOut: ["A regex parser."],
  filesChanged: ["half.ts"],
  stillFailing: [],
};

// Leaves an uncommitted edit, then hands off, as a step past its ticket budget would.
async function handedOff(request: StepRequest): Promise<StepResult> {
  writeFileSync(join(request.cwd, "half.ts"), "half a ticket\n");
  return {
    ...implementResultOf({
      status: "handoff",
      branches: [],
      closingComment: "",
      boxesUndone: [],
      blockers: [],
      handoff,
    }),
    sessionId: "handoff-session",
    peakContext: 150_000,
  };
}

describe("run's implement handoff", () => {
  it("passes the ticket to a fresh implement step on the same pair, keeping the work", async () => {
    addSpec([1]);
    github.edit(1, { body: bodyWith("Opus medium") });
    let branch = "";
    let isWorkKept = false;
    const agentStep = FakeAgentStep.init(
      async (request) => {
        branch = git(request.cwd, "branch", "--show-current");
        return handedOff(request);
      },
      async (request) => {
        isWorkKept = existsSync(join(request.cwd, "half.ts"));
        git(request.cwd, "add", "half.ts");
        return implemented("one.ts")(request);
      },
      reviewed(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(isWorkKept).toBe(true);
    expect(
      git(primaryOf("byro-repo"), "show", `backup/${branch}-handoff-1:half.ts`),
    ).toBe("half a ticket");
    const [first, fresh] = agentStep.requests;
    expect(fresh?.pair).toEqual(first?.pair);
    expect(fresh?.account).toBe(first?.account);
    expect(fresh?.maxTurns).toBe(first?.maxTurns);
    expect(fresh?.resumeSessionId).toBeUndefined();
    expect(fresh?.prompt).toContain("## Handoff from the previous step");
    expect(fresh?.prompt).toContain("Conclusion: The parser is half done.");
    const ticketComments = github.comments.filter(
      ({ issue }) => issue.number === 1,
    );
    const handoffComment = ticketComments.find(({ body }) =>
      body.includes("The parser is half done."),
    );
    expect(handoffComment?.body.trimEnd()).toMatch(
      /\nsession: handoff-session$/,
    );
  });

  it("posts a schema-failure Halt for a handoff that committed", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(async (request) => {
      const result = await handedOff(request);
      git(request.cwd, "add", "half.ts");
      git(request.cwd, "commit", "-m", "Add half.ts");
      return result;
    });

    await specRun(agentStep).run(spec);

    expect(agentStep.requests).toHaveLength(1);
    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    expect(haltComments()[0]).toContain(
      "a handoff must leave its work uncommitted, but the step made a new commit",
    );
  });

  it("resumes a crashed handoff step with the usual retry", async () => {
    addSpec([1]);
    let isWorkKept = false;
    const agentStep = FakeAgentStep.init(
      handedOff,
      crashed,
      keepingWork((isKept) => {
        isWorkKept = isKept;
      }),
      reviewed(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(isWorkKept).toBe(true);
    const [, fresh, retry] = agentStep.requests;
    expect(fresh?.prompt).toContain("## Handoff from the previous step");
    expect(retry?.resumeSessionId).toBe("crashed-session");
    expect(retry?.prompt).not.toContain("the tree reset");
  });

  it("keeps the handed-off work through a turn cap and its `resume +N turns`", async () => {
    addSpec([1]);
    await specRun(FakeAgentStep.init(handedOff, capped)).run(spec);
    github.reply(213, "H1: resume +50 turns");
    let isWorkKept = false;
    const rerunStep = FakeAgentStep.init(
      keepingWork((isKept) => {
        isWorkKept = isKept;
      }),
      reviewed(),
    );

    const result = await specRun(rerunStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(isWorkKept).toBe(true);
    const [resumed] = rerunStep.requests;
    expect(resumed?.resumeSessionId).toBe("capped-session");
    expect(resumed?.prompt).not.toContain("the tree reset");
  });

  it("records every implement step's session, so a rerun starts from the latest handoff", async () => {
    addSpec([1]);
    const saved = join(stateFolder(), "saved.run.json");
    await specRun(
      FakeAgentStep.init(handedOff, async () => {
        copyFileSync(runStatePath(), saved);
        throw new Error("killed");
      }),
    ).run(spec);
    copyFileSync(saved, runStatePath());
    let isWorkKept = false;
    const rerunStep = FakeAgentStep.init(
      keepingWork((isKept) => {
        isWorkKept = isKept;
      }),
      reviewed(),
    );

    const result = await specRun(rerunStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(isWorkKept).toBe(true);
    expect(rerunStep.requests[0]?.prompt).toContain(
      "Conclusion: The parser is half done.",
    );
    expect(ticketState()["byro-repo #1"]?.sessions).toContainEqual({
      agent: "implement",
      sessionId: "handoff-session",
    });
  });
});

// Leaves an uncommitted edit, then is killed at the live ceiling without handing off.
async function crossed(request: StepRequest): Promise<StepResult> {
  writeFileSync(join(request.cwd, "half.ts"), "half a ticket\n");
  return {
    ...implementResultOf(blockedRecord),
    output: { status: "none" },
    exitSubtype: undefined,
    sessionId: "crossed-session",
    peakContext: 181_000,
    hasCrossedCeiling: true,
  };
}

const blockedRecord: ImplementRecord = {
  status: "blocked",
  branches: [],
  closingComment: "",
  boxesUndone: [],
  blockers: [
    { kind: "spec-ambiguity", detail: "Unclear.", recommendation: "Decide." },
  ],
};

describe("run's live-ceiling backstop", () => {
  it("kills an implement step past the live ceiling and resumes it for a handoff record, which hands off as any other", async () => {
    addSpec([1]);
    let isWorkKept = false;
    const agentStep = FakeAgentStep.init(
      crossed,
      handedOff,
      keepingWork((isKept) => {
        isWorkKept = isKept;
      }),
      reviewed(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(isWorkKept).toBe(true);
    const [first, backstop, fresh] = agentStep.requests;
    expect(first?.liveCeiling).toBe(180_000);
    expect(backstop?.resumeSessionId).toBe("crossed-session");
    expect(backstop?.prompt).toBe(handoffOnlyPrompt);
    expect(backstop?.liveCeiling).toBeUndefined();
    expect(fresh?.resumeSessionId).toBeUndefined();
    expect(fresh?.prompt).toContain("Conclusion: The parser is half done.");
  });

  it("posts a Failure Halt with the work snapshotted when the backstop's record isn't a handoff", async () => {
    addSpec([1]);
    let branch = "";
    const agentStep = FakeAgentStep.init(
      async (request) => {
        branch = git(request.cwd, "branch", "--show-current");
        return crossed(request);
      },
      async () => implementResultOf(blockedRecord),
    );

    await specRun(agentStep).run(spec);

    expect(agentStep.requests).toHaveLength(2);
    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    expect(haltComments()[0]).toContain(
      "The implement step crossed the live ceiling of 180000, and its handoff record failed: the record is blocked, not a handoff",
    );
    expect(
      git(primaryOf("byro-repo"), "show", `backup/${branch}-implement:half.ts`),
    ).toBe("half a ticket");
  });

  it("posts a Failure Halt with the work snapshotted when the backstop's record fails its schema", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(crossed, async () => ({
      ...resultOf(undefined),
      output: {
        status: "schemaFailure",
        rawOutput: "",
        problems: ["no record"],
      },
    }));

    await specRun(agentStep).run(spec);

    expect(agentStep.requests).toHaveLength(2);
    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    expect(haltComments()[0]).toContain(
      "The implement step crossed the live ceiling of 180000, and its handoff record failed",
    );
  });
});

// Reports whether the handed-off work is still in the tree, then commits it with the rest of the ticket.
function keepingWork(report: (isKept: boolean) => void): StepScript {
  return async (request) => {
    report(existsSync(join(request.cwd, "half.ts")));
    if (existsSync(join(request.cwd, "half.ts"))) {
      git(request.cwd, "add", "half.ts");
    }
    return implemented("one.ts")(request);
  };
}
