import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { StepResult } from "./AgentStep.ts";
import { FakeAgentStep } from "./FakeAgentStep.ts";
import { git } from "./GitFixture.ts";
import type { RunResult } from "./SpecRun.ts";
import {
  addSpec,
  bodyWith,
  eventOf,
  github,
  implemented,
  masterSetPath,
  masterSubjects,
  notices,
  primaryOf,
  progressLines,
  refOf,
  resultOf,
  reviewed,
  spec,
  specRun,
  stateFolder,
  temp,
  ticketState,
  useSpecRunHarness,
} from "./specRunHarness.ts";

useSpecRunHarness();

describe("run", () => {
  it("implements, reviews, checks and lands each ticket of a two-ticket spec, leaving the spec open", async () => {
    addSpec([1, 2]);
    const agentStep = FakeAgentStep.init(
      implemented("one.ts"),
      reviewed(),
      implemented("two.ts"),
      reviewed(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result).toEqual<RunResult>({
      kind: "finished",
      landed: [refOf(1), refOf(2)],
      message:
        "Run ended: landed byro-repo #1, byro-repo #2. Every ticket is closed.",
    });
    expect([1, 2, 213].map((n) => github.issues.get(n)?.isOpen)).toEqual([
      false,
      false,
      true,
    ]);
    expect(masterSubjects()).toEqual(
      expect.arrayContaining([
        "Merge issue-1-ticket-1 into master (#1)",
        "Merge issue-2-ticket-2 into master (#2)",
      ]),
    );
    expect(
      git(join(temp, "remotes", "byro-repo.git"), "rev-parse", "master"),
    ).toBe(git(primaryOf("byro-repo"), "rev-parse", "master"));
    expect(existsSync(masterSetPath())).toBe(false);
    expect(notices.sent).toEqual([
      {
        specTitle: "The spec",
        summary:
          "Run started on 2 tickets as account 1: 5-hour 10%, weekly 20%.",
        link: "https://github.com/byronbroughten/byro-repo/issues/213",
      },
      {
        specTitle: "The spec",
        summary: result.message,
        link: "https://github.com/byronbroughten/byro-repo/issues/213",
      },
    ]);
  });

  it("runs every step in the ticket's issue workspace, logging each step's raw stream under the spec", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    await specRun(agentStep).run(spec);

    const steps = join(stateFolder(), "byro-repo-213-steps");
    expect(
      agentStep.requests.map(({ cwd, logPath }) => [cwd, logPath]),
    ).toEqual([
      [
        join(temp, "workspaces", "byro-repo-issue-1-ticket-1"),
        join(steps, "byro-repo-1-1-implement.jsonl"),
      ],
      [
        join(temp, "workspaces", "byro-repo-issue-1-ticket-1"),
        join(steps, "byro-repo-1-2-review.jsonl"),
      ],
    ]);
    expect(ticketState()).toEqual({
      "byro-repo #1": expect.objectContaining({ step: "landed" }),
    });
  });

  it("writes one timestamped progress line per event", async () => {
    addSpec([1]);

    await specRun(FakeAgentStep.init(implemented("one.ts"), reviewed())).run(
      spec,
    );

    const lines = progressLines();
    expect(
      lines.every((line) => line.startsWith("2026-10-12T09:00:00.000Z ")),
    ).toBe(true);
    expect(lines.map(eventOf)).toEqual(
      expect.arrayContaining([
        "Run started on 1 tickets as account 1: 5-hour 10%, weekly 20%.",
        "byro-repo #1: launching on Opus high from implement.",
        "byro-repo #1: checking node -e process.exit(require('fs').existsSync('RED') ? 1 : 0).",
        "byro-repo #1: wrapping up.",
        "byro-repo #1: landed.",
      ]),
    );
  });

  it("keeps a crash with multi-line output to timestamped lines", async () => {
    addSpec([1]);
    const crashed: StepResult = {
      ...resultOf(undefined),
      output: { status: "none" },
      errorText: "API Error: 500\noverloaded",
    };

    await specRun(
      FakeAgentStep.init(crashed, implemented("one.ts"), reviewed()),
    ).run(spec);

    const lines = progressLines();
    expect(
      lines.every((line) => line.startsWith("2026-10-12T09:00:00.000Z ")),
    ).toBe(true);
    expect(lines.map(eventOf)).toContain(
      "byro-repo #1: The implement step ended on an error: API Error: 500 overloaded Retrying, 1 of 1.",
    );
  });

  it("runs a ticket's open blocker first, then breaks ties by sub-issue order", async () => {
    addSpec([1, 2, 3]);
    github.blockers.set(1, [3]);
    const agentStep = FakeAgentStep.init(
      implemented("two.ts"),
      reviewed(),
      implemented("three.ts"),
      reviewed(),
      implemented("one.ts"),
      reviewed(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(2), refOf(3), refOf(1)]);
  });

  it("lands the agent ticket, never launches a human ticket or the one it blocks, and names the blocking", async () => {
    addSpec([1, 2, 3]);
    github.edit(2, { labels: ["ready-for-human"] });
    github.blockers.set(3, [2]);
    const agentStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    const result = await specRun(agentStep).run(spec);

    expect(result).toEqual<RunResult>({
      kind: "finished",
      landed: [refOf(1)],
      message:
        "Run ended: landed byro-repo #1. byro-repo #2 waits on you and blocks byro-repo #3; byro-repo #3 is blocked by byro-repo #2. Rerun once your tickets close: `npm run runner -- byronbroughten/byro-repo 213`.",
    });
    expect(agentStep.requests).toHaveLength(2);
    expect([1, 2, 3].map((n) => github.issues.get(n)?.isOpen)).toEqual([
      false,
      true,
      true,
    ]);
  });

  it("reads the label just before each launch, so a mid-run relabel takes effect", async () => {
    addSpec([1, 2]);
    const agentStep = FakeAgentStep.init(
      implemented("one.ts", {
        act: () => github.edit(2, { labels: ["ready-for-human"] }),
      }),
      reviewed(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(result.message).toBe(
      "Run ended: landed byro-repo #1. byro-repo #2 waits on you. Rerun once your tickets close: `npm run runner -- byronbroughten/byro-repo 213`.",
    );
  });

  it("reads the pair just before each launch, so a mid-run edit takes effect", async () => {
    addSpec([1, 2]);
    const agentStep = FakeAgentStep.init(
      implemented("one.ts", {
        act: () => github.edit(2, { body: bodyWith("Sonnet medium") }),
      }),
      reviewed(),
      implemented("two.ts"),
      reviewed(),
    );

    await specRun(agentStep).run(spec);

    expect(agentStep.requests.map(({ pair }) => pair)).toEqual([
      { model: "opus", effort: "high" },
      { model: "opus", effort: "high" },
      { model: "sonnet", effort: "medium" },
      { model: "sonnet", effort: "medium" },
    ]);
  });
});
