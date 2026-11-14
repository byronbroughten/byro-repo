import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { StepRequest, StepResult } from "./AgentStep.ts";
import { FakeAgentStep } from "./FakeAgentStep.ts";
import { git } from "./GitFixture.ts";
import {
  addSpec,
  github,
  haltComments,
  implemented,
  implementResultOf,
  recordOf,
  refOf,
  reviewed,
  schemaFailedOf,
  spec,
  specRun,
  stateFolder,
  ticketState,
  useSpecRunHarness,
} from "./specRunHarness.ts";
import {
  recordOnlyPrompt,
  schemaResumePromptOf,
} from "./stepPrompts/resumePrompts.ts";

useSpecRunHarness();

const statusProblem =
  "status must be one of committed, blocked, handoff, applied";
const unmatched = schemaFailedOf([statusProblem], {
  rawOutput: '{"status":"done"}',
});
const stillUnmatched = schemaFailedOf(
  ["/ must have required property 'record'"],
  {
    rawOutput: '{"summary":"done"}',
  },
);

function stepsPathOf(file: string): string {
  return join(stateFolder(), "byro-repo-213-steps", file);
}

// Commits as a real implementer would, then returns output that fails the schema.
async function committedUnmatched(request: StepRequest): Promise<StepResult> {
  await implemented("one.ts")(request);
  return unmatched;
}

describe("run's schema failures", () => {
  it("resumes an implement step whose record fails its schema once, naming the problems, and takes the corrected record", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      committedUnmatched,
      async (request) => {
        const branch = git(request.cwd, "branch", "--show-current");
        const head = git(request.cwd, "rev-parse", "HEAD");
        return implementResultOf(recordOf({ branch, sha: head }));
      },
      reviewed(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    const resume = agentStep.requests[1];
    expect(resume?.prompt).toBe(schemaResumePromptOf([statusProblem]));
    expect(resume?.resumeSessionId).toBe("session");
    expect(haltComments()).toEqual([]);
  });

  it("posts a Failure Halt on a second schema failure, with the second record's problems and raw output", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(unmatched, stillUnmatched);

    await specRun(agentStep).run(spec);

    expect(agentStep.requests).toHaveLength(2);
    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    const [halt] = haltComments();
    expect(halt).toContain("Failure Halt");
    expect(halt).toContain("must have required property 'record'");
    expect(halt).not.toContain(statusProblem);
    const outputPath = stepsPathOf("byro-repo-1-2-implement.output.txt");
    expect(halt).toContain(`Raw output: \`${outputPath}\``);
    expect(readFileSync(outputPath, "utf8")).toBe('{"summary":"done"}');
    expect(halt).toContain("1. `retry`");
    expect(halt).not.toContain("retry record");
  });

  it.each([["no structured output"], ["structured output retries ran out"]])(
    "posts a Failure Halt at once, without a resume, on %s",
    async (problem) => {
      addSpec([1]);
      const agentStep = FakeAgentStep.init(
        schemaFailedOf([problem], { isFixable: false }),
      );

      await specRun(agentStep).run(spec);

      expect(agentStep.requests).toHaveLength(1);
      const [halt] = haltComments();
      expect(halt).toContain("Failure Halt");
      expect(halt).toContain(problem);
    },
  );

  it("links a record that fails the runner's own check as JSON", async () => {
    addSpec([1]);
    const uncommitted = implementResultOf(
      recordOf({ branch: "issue-1", sha: "abc123" }),
    );

    await specRun(FakeAgentStep.init(uncommitted)).run(spec);

    const [halt] = haltComments();
    expect(halt).toContain("Failure Halt");
    const outputPath = stepsPathOf("byro-repo-1-1-implement.output.txt");
    expect(halt).toContain(`Raw output: \`${outputPath}\``);
    expect(JSON.parse(readFileSync(outputPath, "utf8"))).toMatchObject({
      record: { status: "committed" },
    });
  });

  it("takes `retry record` on a Halt that didn't offer it as a fresh retry", async () => {
    addSpec([1]);
    await specRun(FakeAgentStep.init(unmatched, stillUnmatched)).run(spec);
    github.reply(213, "H1: retry record");
    const rerunStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    const result = await specRun(rerunStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(rerunStep.requests[0]?.prompt).not.toBe(recordOnlyPrompt);
    expect(rerunStep.requests[0]?.resumeSessionId).toBeUndefined();
  });

  it("resumes a review whose record fails its schema once, and takes the corrected record", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      implemented("one.ts"),
      unmatched,
      reviewed(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    const resume = agentStep.requests[2];
    expect(resume?.prompt).toBe(schemaResumePromptOf([statusProblem]));
    expect(resume?.resumeSessionId).toBe("session");
  });

  it("posts a Failure Halt for a review whose record fails its schema twice", async () => {
    addSpec([1]);

    await specRun(
      FakeAgentStep.init(implemented("one.ts"), unmatched, stillUnmatched),
    ).run(spec);

    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    const [halt] = haltComments();
    expect(halt).toContain("Failure Halt");
    expect(halt).toContain("must have required property 'record'");
    expect(halt).toContain(
      `Log: \`${stepsPathOf("byro-repo-1-3-review.jsonl")}\``,
    );
  });

  it("offers `retry record` once the implementer has committed", async () => {
    addSpec([1]);

    await specRun(FakeAgentStep.init(committedUnmatched, stillUnmatched)).run(
      spec,
    );

    const [halt] = haltComments();
    expect(halt).toContain("1. `retry record`");
    expect(halt).toContain("2. `retry`");
  });

  it("asks the resumed session for the record only on a `retry record` answer, keeping its commits", async () => {
    addSpec([1]);
    await specRun(FakeAgentStep.init(committedUnmatched, stillUnmatched)).run(
      spec,
    );
    github.reply(213, "H1: retry record");
    let subjectAtRecord = "";
    const rerunStep = FakeAgentStep.init(async (request) => {
      subjectAtRecord = git(request.cwd, "log", "-1", "--format=%s");
      const branch = git(request.cwd, "branch", "--show-current");
      const head = git(request.cwd, "rev-parse", "HEAD");
      return implementResultOf(recordOf({ branch, sha: head }));
    }, reviewed());

    const result = await specRun(rerunStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    const [recordStep] = rerunStep.requests;
    expect(recordStep?.prompt).toBe(recordOnlyPrompt);
    expect(recordStep?.resumeSessionId).toBe("session");
    expect(subjectAtRecord).toBe("Add one.ts");
  });
});
