import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { StepResult } from "./AgentStep.ts";
import {
  EventFileNotices,
  type EventLine,
  eventLinesOf,
} from "./EventFileNotices.ts";
import { FakeAgentStep } from "./FakeAgentStep.ts";
import { commentUrlOf } from "./FakeGitHub.ts";
import { git } from "./GitFixture.ts";
import type { Blocker } from "./implementStep.ts";
import { composedNotices } from "./Notices.ts";
import { runKnobsOf } from "./runKnobs.ts";
import type { SpecRunConfig } from "./SpecRun.ts";
import {
  addSpec,
  blocked,
  clonePaths,
  crashed,
  github,
  implemented,
  notices,
  passes,
  primaryRoot,
  reviewed,
  spec,
  specRun,
  stateFolder,
  useSpecRunHarness,
} from "./specRunHarness.ts";

useSpecRunHarness();

const gated: Blocker = {
  kind: "gated-action",
  detail: "It needs app:build.",
  recommendation: "Run it by hand.",
};

function withEventFile(): Partial<SpecRunConfig> {
  const eventFile = EventFileNotices.init(
    stateFolder(),
    () => new Date("2026-10-12T09:00:00Z"),
  );
  return { notices: composedNotices(notices, eventFile) };
}

function eventLines(): EventLine[] {
  return eventLinesOf(stateFolder(), spec);
}

function haltCommentUrl(): string {
  const index = github.comments.findIndex(({ body }) =>
    body.includes("**Halt H1"),
  );
  return commentUrlOf(spec, index + 1);
}

describe("run's event file", () => {
  it("writes a line per start, Halt, idle, Stop and end, leaving the ntfy notices as they were", async () => {
    addSpec([1]);
    const specUrl = "https://github.com/byronbroughten/byro-repo/issues/213";

    await specRun(FakeAgentStep.init(blocked([gated])), withEventFile()).run(
      spec,
    );
    github.reply(213, "H1: I ran it.");
    await specRun(
      FakeAgentStep.init(implemented("one.ts"), reviewed()),
      withEventFile(),
    ).run(spec);

    expect(
      eventLines().map(({ ticket, kind, ending, commentUrl }) => ({
        ticket,
        kind,
        ending,
        commentUrl,
      })),
    ).toEqual([
      {
        ticket: "byro-repo#1",
        kind: "run-started",
        ending: undefined,
        commentUrl: specUrl,
      },
      {
        ticket: "byro-repo#1",
        kind: "halt",
        ending: undefined,
        commentUrl: haltCommentUrl(),
      },
      {
        ticket: undefined,
        kind: "idle",
        ending: undefined,
        commentUrl: specUrl,
      },
      {
        ticket: undefined,
        kind: "run-ended",
        ending: "stopped",
        commentUrl: specUrl,
      },
      {
        ticket: "byro-repo#1",
        kind: "run-started",
        ending: undefined,
        commentUrl: specUrl,
      },
      {
        ticket: undefined,
        kind: "run-ended",
        ending: "finished",
        commentUrl: specUrl,
      },
    ]);
    expect(eventLines()[1]).toMatchObject({
      time: "2026-10-12T09:00:00.000Z",
      spec: "byro-repo#213",
      summary: notices.sent.find(({ kind }) => kind === "halt")?.summary,
    });
    expect(
      notices.sent.map(({ specTitle, link }) => ({ specTitle, link })),
    ).toEqual(
      notices.sent.map(() => ({ specTitle: "The spec", link: specUrl })),
    );
  });

  it("writes the run-started line, naming the first ticket and carrying no warnings, before any step runs", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    await specRun(agentStep, withEventFile()).run(spec);

    expect(eventLines()[0]).toMatchObject({
      time: "2026-10-12T09:00:00.000Z",
      spec: "byro-repo#213",
      ticket: "byro-repo#1",
      kind: "run-started",
      warnings: [],
      summary: expect.stringContaining("Launching byro-repo #1."),
    });
    expect(notices.sent[0]).toMatchObject({ kind: "run-started" });
  });

  it("warns on the run-started line of each mention of a folder holding no clone, and runs on", async () => {
    addSpec([1]);
    writeFileSync(join(primaryRoot, "guide.md"), "See packages/personal.\n");
    git(primaryRoot, "add", "guide.md");
    git(primaryRoot, "commit", "-m", "Name a moved clone");
    const agentStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    const result = await specRun(agentStep, withEventFile()).run(spec);

    expect(eventLines()[0]).toMatchObject({
      kind: "run-started",
      warnings: [
        "byro-repo guide.md:1 names packages/personal, which holds no clone",
      ],
    });
    expect(result.kind).toBe("finished");
  });

  it("writes no run-started line for a run stopped in preflight, its run-ended summary naming the fix", async () => {
    addSpec([1]);
    const knobs = runKnobsOf({
      clonePaths,
      checks: [],
      authChecks: [passes],
      ticketBudget: 180_000,
    });

    const result = await specRun(FakeAgentStep.init(), {
      ...withEventFile(),
      knobs,
    }).run(spec);

    expect(eventLines()).toEqual([
      expect.objectContaining({
        kind: "run-ended",
        ending: "stopped",
        summary: result.message,
      }),
    ]);
    expect(result.message).toContain("raise the live ceiling");
  });

  it("writes a failure-halt line for a Failure Halt, naming its ticket and comment", async () => {
    addSpec([1]);

    await specRun(FakeAgentStep.init(crashed, crashed), withEventFile()).run(
      spec,
    );

    expect(eventLines()[1]).toMatchObject({
      ticket: "byro-repo#1",
      kind: "failure-halt",
      commentUrl: haltCommentUrl(),
    });
  });

  it("writes no line for a notice with no kind", async () => {
    addSpec([1]);

    await specRun(
      FakeAgentStep.init(implemented("one.ts"), reviewed()),
      withEventFile(),
    ).run(spec);

    expect(notices.sent.length).toBeGreaterThan(1);
    expect(eventLines().map(({ kind }) => kind)).toEqual([
      "run-started",
      "run-ended",
    ]);
  });

  it("names the ticket and its Stop comment on a ticket Stop's run-ended line", async () => {
    addSpec([1, 2]);
    const stepError: StepResult = {
      ...reviewed(),
      output: { status: "none" },
      exitSubtype: "error_max_budget_usd",
    };

    await specRun(
      FakeAgentStep.init(implemented("one.ts"), stepError),
      withEventFile(),
    ).run(spec);

    expect(eventLines().slice(1)).toEqual([
      expect.objectContaining({
        ticket: "byro-repo#1",
        kind: "run-ended",
        ending: "stopped",
        commentUrl: commentUrlOf(spec, 1),
      }),
    ]);
  });

  it("writes a run-ended refused line for a refused run, sending ntfy nothing it would push", async () => {
    addSpec([1]);
    github.edit(1, { body: "## What to build\n\nNo section.\n" });

    const result = await specRun(FakeAgentStep.init(), withEventFile()).run(
      spec,
    );

    expect(result.kind).toBe("refused");
    expect(eventLines()).toEqual([
      expect.objectContaining({
        kind: "run-ended",
        ending: "refused",
        summary: `Refused: ${result.message}`,
      }),
    ]);
    expect(notices.sent.map(({ kind }) => kind)).toEqual(["refused"]);
  });
});
