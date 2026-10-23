import { describe, expect, it } from "vitest";

import type { StepResult } from "./AgentStep.ts";
import {
  EventFileNotices,
  type EventLine,
  eventLinesOf,
} from "./EventFileNotices.ts";
import { FakeAgentStep } from "./FakeAgentStep.ts";
import { commentUrlOf } from "./FakeGitHub.ts";
import type { Blocker } from "./implementStep.ts";
import { composedNotices } from "./Notices.ts";
import type { SpecRunConfig } from "./SpecRun.ts";
import {
  addSpec,
  blocked,
  github,
  implemented,
  notices,
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
  it("writes a line per Halt, idle, Stop and end, leaving the ntfy notices as they were", async () => {
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
        ticket: undefined,
        kind: "run-ended",
        ending: "finished",
        commentUrl: specUrl,
      },
    ]);
    expect(eventLines()[0]).toMatchObject({
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

  it("writes no line for a notice with no kind", async () => {
    addSpec([1]);

    await specRun(
      FakeAgentStep.init(implemented("one.ts"), reviewed()),
      withEventFile(),
    ).run(spec);

    expect(notices.sent.length).toBeGreaterThan(1);
    expect(eventLines().map(({ kind }) => kind)).toEqual(["run-ended"]);
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

    expect(eventLines()).toEqual([
      expect.objectContaining({
        ticket: "byro-repo#1",
        kind: "run-ended",
        ending: "stopped",
        commentUrl: commentUrlOf(spec, 1),
      }),
    ]);
  });
});
