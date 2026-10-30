import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { StepResult } from "./AgentStep.ts";
import { FakeAgentStep } from "./FakeAgentStep.ts";
import { git } from "./GitFixture.ts";
import {
  addSpec,
  eventOf,
  github,
  haltComments,
  implemented,
  noConversation,
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

const capped: StepResult = {
  ...resultOf(undefined),
  output: { status: "none" },
  exitSubtype: "error_max_turns",
};

const unmatched: StepResult = {
  ...resultOf(undefined),
  output: {
    status: "schemaFailure",
    rawOutput: "{}",
    problems: ["summary must be a string"],
  },
};

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
  return resultOf({
    summary: "Kept the branch's one.ts.",
    files: ["byro-repo one.ts"],
  });
};

const unmerged: StepScript = async () =>
  resultOf({ summary: "Left it alone.", files: ["byro-repo one.ts"] });

// Each review-list item for a merge-master resolution with no record, up to its recommendation.
function unrecordedMergeItems(): string[] {
  return github.comments
    .filter(({ body }) => body.includes("<!-- review-list ticket=#1 -->"))
    .flatMap(({ body }) =>
      body
        .split("\n- ")
        .filter((item) => item.includes("kept no record of"))
        .map((item) => `- ${item.split("\n  Recommendation:")[0]}`),
    );
}

// Commits one.ts on the branch after master gained its own, so the wrap-up conflicts.
const conflicting = implemented("one.ts", {
  act: () => commitOnMaster("one.ts", "export const a = 1;\n"),
});

describe("run's wrap-up failures", () => {
  it("resumes the implementer once to merge master on a conflict, then reruns the wrap-up and lands", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(conflicting, reviewed(), mergedMaster);

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

  it("posts the merge-master resolution as the review list's one `decision` Propose, naming its files and summary", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(conflicting, reviewed(), mergedMaster);

    await specRun(agentStep).run(spec);

    const lists = github.comments
      .filter(({ issue }) => issue.number === 213)
      .map(({ body }) => body)
      .filter((body) => body.includes("<!-- review-list ticket=#1 -->"));
    expect(lists).toEqual([
      [
        "<!-- spec-runner -->\n<!-- review-list ticket=#1 -->",
        '**Review list** · byro-repo #1, "Ticket 1"',
        "### Merge with master",
        "**Proposed**\n\n- [ ] **R1.1** · Propose `decision` · The merge with master resolved conflicts in byro-repo one.ts\n  Evidence: Kept the branch's one.ts.\n  Recommendation: Confirm each resolution kept the intent you want from both sides; correct it on master if not.",
      ].join("\n\n"),
    ]);
  });

  it("merges master in a fresh session when the implementer's session has no conversation, then lands", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      conflicting,
      reviewed(),
      noConversation,
      mergedMaster,
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(agentStep.requests[2]?.resumeSessionId).toBe("session");
    const merge = agentStep.requests[3];
    expect(merge?.resumeSessionId).toBeUndefined();
    expect(merge?.prompt).toMatch(/^You are the merge-master step/);
    expect(haltComments()).toEqual([]);
    expect(progressLines().map(eventOf)).toContain(
      "byro-repo #1: the merge-master step's session session has no conversation; running it as a fresh session.",
    );
  });

  it("posts a Failure Halt when the wrap-up still conflicts after the merge-master resume", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(conflicting, reviewed(), unmerged);

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([]);
    expect(agentStep.requests).toHaveLength(3);
    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    const halts = haltComments();
    expect(halts).toHaveLength(1);
    expect(halts[0]).toContain("Failure Halt");
    expect(halts[0]).toContain(
      "The wrap-up still conflicts after the merge-master resume: Merging issue-1-",
    );
  });

  it("shows no merge-master resolution that never landed, once a `retry` lands a hand merge", async () => {
    addSpec([1]);
    let workspace = "";
    const agentStep = FakeAgentStep.init(
      conflicting,
      reviewed(),
      async (request) => {
        workspace = request.cwd;
        return unmerged(request);
      },
    );
    await specRun(agentStep).run(spec);

    git(workspace, "merge", "-X", "ours", "-m", "Merge master", "master");
    github.reply(213, "H1: retry");
    const result = await specRun(FakeAgentStep.init()).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(
      github.comments.filter(({ body }) =>
        body.includes("<!-- review-list ticket=#1 -->"),
      ),
    ).toEqual([]);
  });

  it("sets a turn-capped merge-master's uncommitted work aside, then halts on the conflict it left", async () => {
    addSpec([1]);
    let branch = "";
    const agentStep = FakeAgentStep.init(
      conflicting,
      reviewed(),
      async (request) => {
        branch = git(request.cwd, "branch", "--show-current");
        writeFileSync(join(request.cwd, "half.ts"), "half a merge\n");
        return capped;
      },
    );

    await specRun(agentStep).run(spec);

    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    expect(
      git(primaryOf("byro-repo"), "show", `backup/${branch}-wrap-up:half.ts`),
    ).toBe("half a merge");
    expect(haltComments()[0]).toContain(
      "The wrap-up still conflicts after the merge-master resume",
    );
  });

  it("posts a `decision` Propose for a turn-capped merge-master's committed merge once it lands", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      conflicting,
      reviewed(),
      async (request) => {
        await mergedMaster(request);
        return capped;
      },
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(unrecordedMergeItems()).toEqual([
      "- [ ] **R1.1** · Propose `decision` · The merge with master resolved conflicts it kept no record of\n  Evidence: The merge-master session hit its turn cap before returning its record.",
    ]);
  });

  it("posts a `decision` Propose for a merge whose record failed its schema, once a `retry` lands it", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      conflicting,
      reviewed(),
      async (request) => {
        await mergedMaster(request);
        return unmatched;
      },
    );
    await specRun(agentStep).run(spec);

    github.reply(213, "H1: retry");
    const result = await specRun(FakeAgentStep.init()).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    const [item] = unrecordedMergeItems();
    expect(item).toContain(
      "Evidence: The merge-master session's record failed its checks:",
    );
    expect(item).toContain("summary must be a string");
  });

  it("posts a Failure Halt on a merge-master record that fails its schema", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(conflicting, reviewed(), unmatched);

    await specRun(agentStep).run(spec);

    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    const [halt] = haltComments();
    expect(halt).toContain("Failure Halt");
    expect(halt).toContain("summary must be a string");
  });

  it("posts a Failure Halt naming each token-shaped line and pushes nothing, then a `retry` once it is removed pushes", async () => {
    addSpec([1]);
    const remoteBefore = remoteMaster();
    const agentStep = FakeAgentStep.init(
      implemented("keys.ts", {
        content: `const key = "${key}";\nconst again = "${key}";\n`,
      }),
      reviewed(),
    );

    await specRun(agentStep).run(spec);

    expect(ticketState()["byro-repo #1"]?.step).toBe("halted");
    const [halt] = haltComments();
    expect(halt).toContain("Failure Halt");
    expect(halt).toContain("byro-repo keys.ts:1");
    expect(halt).toContain("byro-repo keys.ts:2");
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
      const implementResult = await implemented("one.ts", { act })(request);
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
      implemented("one.ts", {
        act: () =>
          git(primaryOf("byro-repo"), "remote", "set-url", "origin", "/gone"),
      }),
      reviewed(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.kind).toBe("stopped");
    expect(haltComments()).toEqual([]);
    expect(ticketState()["byro-repo #1"]?.step).toBe("wrap-up");
  });
});
