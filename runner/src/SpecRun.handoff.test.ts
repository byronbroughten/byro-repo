import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { StepRequest, StepResult } from "./AgentStep.ts";
import { FakeAgentStep } from "./FakeAgentStep.ts";
import { git } from "./GitFixture.ts";
import type { Handoff } from "./implementStep.ts";
import {
  addSpec,
  bodyWith,
  crashed,
  github,
  haltComments,
  implemented,
  implementResultOf,
  primaryOf,
  refOf,
  reviewed,
  spec,
  specRun,
  stateFolder,
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

function runStatePath(): string {
  return join(stateFolder(), "byro-repo-213.run.json");
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
    const agentStep = FakeAgentStep.init(
      handedOff,
      crashed,
      implemented("one.ts"),
      reviewed(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    const [, fresh, retry] = agentStep.requests;
    expect(fresh?.prompt).toContain("## Handoff from the previous step");
    expect(retry?.resumeSessionId).toBe("crashed-session");
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
    const rerunStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    const result = await specRun(rerunStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(rerunStep.requests[0]?.prompt).toContain(
      "Conclusion: The parser is half done.",
    );
    expect(ticketState()["byro-repo #1"]?.sessions).toContainEqual({
      agent: "implement",
      sessionId: "handoff-session",
    });
  });
});
