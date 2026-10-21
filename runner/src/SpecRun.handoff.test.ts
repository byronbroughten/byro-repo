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

const splitHandoff: Handoff = {
  ...handoff,
  proposedSplit: [
    { delivers: "The parser's error messages.", files: ["errors.ts"] },
    { delivers: "The parser's CLI.", files: ["cli.ts", "bin.ts"] },
  ],
};

// Leaves an uncommitted edit, then hands off, as a step past its ticket budget would.
function handingOff(given: Handoff): StepScript {
  return async (request) => {
    writeFileSync(join(request.cwd, "half.ts"), "half a ticket\n");
    return {
      ...implementResultOf({
        status: "handoff",
        branches: [],
        closingComment: "",
        boxesUndone: [],
        blockers: [],
        handoff: given,
      }),
      sessionId: "handoff-session",
      peakContext: 150_000,
    };
  };
}

const handedOff = handingOff(handoff);

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

    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    expect(haltComments()[0]).toContain(
      "The implement step crossed the live ceiling of 180000, and its handoff record failed: no record",
    );
  });

  it("offers `retry record` when the step had committed before crossing", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(async (request) => {
      writeFileSync(join(request.cwd, "one.ts"), "export {};\n");
      git(request.cwd, "add", "one.ts");
      git(request.cwd, "commit", "-m", "Add one.ts");
      return crossed(request);
    }, handedOff);

    await specRun(agentStep).run(spec);

    expect(haltComments()[0]).toContain(
      "a handoff must leave its work uncommitted, but the step made a new commit",
    );
    expect(haltComments()[0]).toContain("retry record");
  });

  it("keeps asking for a handoff record only when the backstop's resume crashes", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      crossed,
      crashed,
      handedOff,
      keepingWork(() => {}),
      reviewed(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    const [, , retry] = agentStep.requests;
    expect(retry?.resumeSessionId).toBe("crashed-session");
    expect(retry?.prompt).toBe(handoffOnlyPrompt);
  });
});

describe("run's split Halt", () => {
  it("halts a handoff that proposes a split on a Halt carrying the slices, launching no fresh step", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(handingOff(splitHandoff));

    await specRun(agentStep).run(spec);

    expect(agentStep.requests).toHaveLength(1);
    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    const [halt] = haltComments();
    expect(halt).toContain("Split Halt");
    expect(halt).toContain("The parser's error messages. (errors.ts)");
    expect(halt).toContain("The parser's CLI. (cli.ts, bin.ts)");
    expect(halt).toContain("1. `continue`\n2. `stop spec`");
  });

  it("isn't counted by the stuck detector", async () => {
    addSpec([1, 2, 3]);
    const agentStep = FakeAgentStep.init(
      handingOff(splitHandoff),
      crashed,
      crashed,
      implemented("three.ts"),
      reviewed(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(3)]);
  });

  it("launches a fresh step on `continue`, from the ticket's narrowed body and the latest handoff", async () => {
    addSpec([1]);
    await specRun(FakeAgentStep.init(handingOff(splitHandoff))).run(spec);
    github.edit(1, { body: bodyWith().replace("A thing.", "Half a thing.") });
    github.reply(213, "H1: continue");
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
    const [fresh] = rerunStep.requests;
    expect(fresh?.resumeSessionId).toBeUndefined();
    expect(fresh?.prompt).toContain("Half a thing.");
    expect(fresh?.prompt).toContain("Conclusion: The parser is half done.");
    expect(fresh?.prompt).not.toContain("The parser's CLI.");
  });
});

describe("run's handoff cap", () => {
  it("posts the cap's Failure Halt again, launching nothing, on any answer but `continue +1 handoff`", async () => {
    addSpec([1]);
    await specRun(FakeAgentStep.init(handedOff, handedOff, handedOff)).run(
      spec,
    );
    github.reply(213, "H1: retry");
    const rerunStep = FakeAgentStep.init(handedOff);

    await specRun(rerunStep).run(spec);

    expect(rerunStep.requests).toHaveLength(0);
    expect(haltComments()).toHaveLength(2);
    expect(haltComments()[1]).toContain("`continue +1 handoff`");
  });

  it("carries a split proposed on the capped handoff in its Failure Halt, and raises no split Halt after it", async () => {
    addSpec([1]);
    await specRun(
      FakeAgentStep.init(handedOff, handedOff, handingOff(splitHandoff)),
    ).run(spec);
    github.reply(213, "H1: continue +1 handoff");
    const rerunStep = FakeAgentStep.init(
      keepingWork(() => {}),
      reviewed(),
    );

    const result = await specRun(rerunStep).run(spec);

    expect(haltComments()).toHaveLength(1);
    expect(haltComments()[0]).toContain("The parser's CLI. (cli.ts, bin.ts)");
    expect(result.landed).toEqual([refOf(1)]);
  });

  it("posts a Failure Halt on a ticket's third handoff, saying to split it first", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(handedOff, handedOff, handedOff);

    await specRun(agentStep).run(spec);

    expect(agentStep.requests).toHaveLength(3);
    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    const [halt] = haltComments();
    expect(halt).toContain("Failure Halt");
    expect(halt).toContain("Split the ticket");
    expect(halt).toContain("1. `continue +1 handoff`\n2. `stop spec`");
  });

  it("counts a backstop handoff", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      handedOff,
      handedOff,
      crossed,
      handedOff,
    );

    await specRun(agentStep).run(spec);

    expect(agentStep.requests).toHaveLength(4);
    expect(haltComments()[0]).toContain("`continue +1 handoff`");
  });

  it("allows exactly one more handoff on `continue +1 handoff`", async () => {
    addSpec([1]);
    await specRun(FakeAgentStep.init(handedOff, handedOff, handedOff)).run(
      spec,
    );
    github.reply(213, "H1: continue +1 handoff");
    const rerunStep = FakeAgentStep.init(handedOff, handedOff);

    await specRun(rerunStep).run(spec);

    expect(rerunStep.requests).toHaveLength(1);
    const [fresh] = rerunStep.requests;
    expect(fresh?.resumeSessionId).toBeUndefined();
    expect(fresh?.prompt).toContain("Conclusion: The parser is half done.");
    expect(haltComments()).toHaveLength(2);
    expect(haltComments()[1]).toContain("`continue +1 handoff`");
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
