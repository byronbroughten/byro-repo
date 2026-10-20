import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FakeAgentStep } from "./FakeAgentStep.ts";
import { git } from "./GitFixture.ts";
import {
  addSpec,
  eventOf,
  github,
  haltComments,
  implemented,
  primaryOf,
  progressLines,
  refOf,
  resultOf,
  reviewed,
  spec,
  specRun,
  type StepScript,
  ticketState,
  useSpecRunHarness,
} from "./specRunHarness.ts";

useSpecRunHarness();

const key = `sk-ant-${"q9".repeat(12)}`;

function commitOnMaster(file: string, content: string): void {
  const primary = primaryOf("byro-repo");
  writeFileSync(join(primary, file), content);
  git(primary, "add", file);
  git(primary, "commit", "-m", `Add ${file} on master`);
}

function remoteMaster(): string {
  return git(primaryOf("byro-repo"), "ls-remote", "origin", "master").split(
    "\t",
  )[0] as string;
}

// Merges master into the ticket's branch keeping the branch's side, as a merge-master step would.
const mergedMaster: StepScript = async (request) => {
  git(request.cwd, "merge", "-X", "ours", "-m", "Merge master", "master");
  return resultOf({ summary: "Kept the branch's one.ts." });
};

const unmerged: StepScript = async () =>
  resultOf({ summary: "Left it alone." });

function implementedAfter(act: () => void, file = "one.ts"): StepScript {
  return implemented(file, { act });
}

describe("run's wrap-up failures", () => {
  it("resumes the implementer once to merge master on a conflict, then reruns the wrap-up and lands", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      implementedAfter(() => commitOnMaster("one.ts", "export const a = 1;\n")),
      reviewed(),
      mergedMaster,
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    const merge = agentStep.requests[2];
    expect(merge?.resumeSessionId).toBe("session");
    expect(merge?.prompt).toMatch(/^You are the merge-master step/);
    expect(merge?.prompt).toContain("Merging issue-1-");
    expect(progressLines().map(eventOf)).toContain(
      "byro-repo #1: the wrap-up conflicted with master; resuming the implementer to merge it.",
    );
  });

  it("posts a Failure Halt when the wrap-up still conflicts after the merge-master resume", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      implementedAfter(() => commitOnMaster("one.ts", "export const a = 1;\n")),
      reviewed(),
      unmerged,
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([]);
    expect(agentStep.requests).toHaveLength(3);
    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    const [halt] = haltComments();
    expect(haltComments()).toHaveLength(1);
    expect(halt).toContain("Failure Halt");
    expect(halt).toContain(
      "The wrap-up still conflicts after the merge-master resume: Merging issue-1-",
    );
  });

  it("posts a Failure Halt naming each token-shaped line and pushes nothing, then a `retry` once it is removed pushes", async () => {
    addSpec([1]);
    const remoteBefore = remoteMaster();
    const agentStep = FakeAgentStep.init(
      implemented("keys.ts", { content: `const key = "${key}";\n` }),
      reviewed(),
    );

    await specRun(agentStep).run(spec);

    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    const [halt] = haltComments();
    expect(halt).toContain("Failure Halt");
    expect(halt).toContain("byro-repo keys.ts:1");
    expect(halt).not.toContain(key);
    expect(remoteMaster()).toBe(remoteBefore);

    const primary = primaryOf("byro-repo");
    git(primary, "rm", "-q", "keys.ts");
    git(primary, "commit", "-m", "Drop the key");
    github.reply(213, "H1: retry");
    const rerunStep = FakeAgentStep.init();
    const result = await specRun(rerunStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(rerunStep.requests).toHaveLength(0);
    expect(remoteMaster()).toBe(git(primary, "rev-parse", "master"));
  });

  it.each([
    {
      kind: "red checks after the merges",
      act: () => commitOnMaster("RED", ""),
      detail: "failed after the merges",
    },
    {
      kind: "a dirty tree",
      act: () => {},
      dirty: true,
      detail: "has uncommitted changes",
    },
    {
      kind: "a foreign branch",
      act: () => git(primaryOf("byro-repo"), "switch", "-q", "-c", "other"),
      detail: "primary checkout is on other, not master",
    },
    {
      kind: "a failed parent check",
      act: () =>
        github.parents.set(1, {
          issue: spec,
          labels: [],
          subIssues: undefined,
        }),
      detail: "sub-issue summary could not be read",
    },
  ])("posts a Failure Halt on $kind", async ({ act, dirty, detail }) => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(async (request) => {
      const implementResult = await implementedAfter(act)(request);
      if (dirty) writeFileSync(join(request.cwd, "stray.ts"), "stray\n");
      return implementResult;
    }, reviewed());

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([]);
    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    const [halt] = haltComments();
    expect(halt).toContain("Failure Halt");
    expect(halt).toContain(detail);
  });

  it("stops on a network failure past its retries, leaving the wrap-up for a rerun", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      implementedAfter(() =>
        git(primaryOf("byro-repo"), "remote", "set-url", "origin", "/gone"),
      ),
      reviewed(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.kind).toBe("stopped");
    expect(haltComments()).toEqual([]);
    expect(ticketState()["byro-repo #1"]?.step).toBe("wrap-up");
  });
});
