import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { StepRequest, StepResult } from "./AgentStep.ts";
import { FakeAgentStep } from "./FakeAgentStep.ts";
import { git } from "./GitFixture.ts";
import { recordOnlyPrompt } from "./implementStep.ts";
import {
  addSpec,
  github,
  implemented,
  implementResultOf,
  recordOf,
  refOf,
  resultOf,
  reviewed,
  spec,
  specRun,
  stateFolder,
  ticketState,
  useSpecRunHarness,
} from "./specRunHarness.ts";

useSpecRunHarness();

const unmatched: StepResult = {
  ...resultOf(undefined),
  output: {
    status: "schemaFailure",
    rawOutput: '{"status":"done"}',
    problems: ["status must be one of committed, blocked, handoff, applied"],
  },
};

function haltComments(): string[] {
  return github.comments
    .map(({ body }) => body)
    .filter((body) => body.includes("**Halt H"));
}

function stepsPathOf(file: string): string {
  return join(stateFolder(), "byro-repo-213-steps", file);
}

// Commits as a real implementer would, then returns output that fails the schema.
async function committedUnmatched(request: StepRequest): Promise<StepResult> {
  await implemented("one.ts")(request);
  return unmatched;
}

describe("run's schema failures", () => {
  it("posts a Failure Halt at once for an implement output that fails its schema, linking the raw output", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(unmatched);

    await specRun(agentStep).run(spec);

    expect(agentStep.requests).toHaveLength(1);
    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    const [halt] = haltComments();
    expect(halt).toContain("Failure Halt");
    expect(halt).toContain(
      "status must be one of committed, blocked, handoff, applied",
    );
    const outputPath = stepsPathOf("byro-repo-1-1-implement.output.txt");
    expect(halt).toContain(`Raw output: \`${outputPath}\``);
    expect(readFileSync(outputPath, "utf8")).toBe('{"status":"done"}');
    expect(halt).toContain("1. `retry`");
    expect(halt).not.toContain("retry record");
  });

  it("links a record that fails the runner's own check as JSON", async () => {
    addSpec([1]);
    const uncommitted = implementResultOf(recordOf("issue-1", "abc123"));

    await specRun(FakeAgentStep.init(uncommitted)).run(spec);

    const [halt] = haltComments();
    expect(halt).toContain("Failure Halt");
    const outputPath = stepsPathOf("byro-repo-1-1-implement.output.txt");
    expect(halt).toContain(`Raw output: \`${outputPath}\``);
    expect(JSON.parse(readFileSync(outputPath, "utf8"))).toMatchObject({
      record: { status: "committed" },
    });
  });

  it("posts a Failure Halt for a review output that fails its schema", async () => {
    addSpec([1]);

    await specRun(FakeAgentStep.init(implemented("one.ts"), unmatched)).run(
      spec,
    );

    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    const [halt] = haltComments();
    expect(halt).toContain("Failure Halt");
    expect(halt).toContain(
      `Log: \`${stepsPathOf("byro-repo-1-2-review.jsonl")}\``,
    );
  });

  it("offers `retry record` once the implementer has committed", async () => {
    addSpec([1]);

    await specRun(FakeAgentStep.init(committedUnmatched)).run(spec);

    const [halt] = haltComments();
    expect(halt).toContain("1. `retry record`");
    expect(halt).toContain("2. `retry`");
  });

  it("asks the resumed session for the record only on a `retry record` answer, keeping its commits", async () => {
    addSpec([1]);
    await specRun(FakeAgentStep.init(committedUnmatched)).run(spec);
    github.reply(213, "H1: retry record");
    let subjectAtRecord = "";
    const rerunStep = FakeAgentStep.init(async (request) => {
      subjectAtRecord = git(request.cwd, "log", "-1", "--format=%s");
      const branch = git(request.cwd, "branch", "--show-current");
      const head = git(request.cwd, "rev-parse", "HEAD");
      return implementResultOf(recordOf(branch, head));
    }, reviewed());

    const result = await specRun(rerunStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    const [recordStep] = rerunStep.requests;
    expect(recordStep?.prompt).toBe(recordOnlyPrompt);
    expect(recordStep?.resumeSessionId).toBe("session");
    expect(subjectAtRecord).toBe("Add one.ts");
  });
});
