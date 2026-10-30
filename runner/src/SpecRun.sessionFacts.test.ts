import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import type { StepRequest, StepResult } from "./AgentStep.ts";
import { FakeAgentStep } from "./FakeAgentStep.ts";
import { git } from "./GitFixture.ts";
import {
  addSpec,
  eventOf,
  implemented,
  primaryOf,
  progressLines,
  reviewed,
  spec,
  specRun,
  type StepScript,
  temp,
  ticketFacts,
  useSpecRunHarness,
} from "./specRunHarness.ts";
import { StepStream } from "./StepStream.ts";

useSpecRunHarness();

describe("a landed ticket's session facts", () => {
  let configFolder: string;

  beforeEach(() => {
    addSpec([1]);
    configFolder = join(temp, "config");
  });

  // A 2.1.312 stream: its init event names the session but carries no `memory_paths`.
  function streamed(
    sessionId: string,
    step: StepScript | StepResult,
  ): StepScript {
    return async (request: StepRequest) => {
      const ran = typeof step === "function" ? await step(request) : step;
      const record =
        ran.output.status === "valid" ? ran.output.record : undefined;
      const init = { type: "system", subtype: "init", session_id: sessionId };
      const result = {
        type: "result",
        subtype: "success",
        session_id: sessionId,
        structured_output: record,
      };
      return StepStream.init()
        .observeLine(JSON.stringify(init))
        .observeLine(JSON.stringify(result))
        .toResult(request);
    };
  }

  // Two Opus medium replies `minutes` apart, the second at `peak` tokens.
  function transcript(sessionId: string, peak: number, minutes: number): void {
    const projectDir = join(configFolder, "projects", "-workspace");
    mkdirSync(projectDir, { recursive: true });
    const replies = [replyOf("m1", 1_000, 0), replyOf("m2", peak, minutes)].map(
      (reply) => `${JSON.stringify(reply)}\n`,
    );
    writeFileSync(join(projectDir, `${sessionId}.jsonl`), replies.join(""));
  }

  function runSteps(): FakeAgentStep {
    return FakeAgentStep.init(
      streamed("implement-session", implemented("one.ts")),
      streamed("review-session", reviewed()),
    );
  }

  function outcomeRow(): string {
    return git(
      primaryOf("byro-repo"),
      "show",
      "master:docs/agents/outcomes/byro-repo-213/byro-repo-1.md",
    );
  }

  function warnings(): string[] {
    return progressLines()
      .map(eventOf)
      .filter((line) => line.includes(" warning: "));
  }

  it("records every step's session under the runner's own config folder from a stream naming none, and writes the transcript facts", async () => {
    transcript("implement-session", 90_000, 10);
    transcript("review-session", 40_000, 5);

    const result = await specRun(runSteps(), { configFolder }).run(spec);

    expect(result.kind).toBe("finished");
    const recorded = { account: 1, configFolder };
    expect(ticketFacts().sessions).toEqual({
      steps: [
        { agent: "implement", sessionId: "implement-session", ...recorded },
        { agent: "review", sessionId: "review-session", ...recorded },
      ],
    });
    const row = outcomeRow();
    expect(row).toContain("| #1 | Opus medium | 1 |");
    expect(row).toContain("| 15 min |");
    expect(row).toContain("| implement-session, review-session |");
    expect(row).not.toContain("unrecorded");
    expect(warnings()).toEqual([]);
  });

  it("leaves only the facts a missing transcript feeds unrecorded, warning on each", async () => {
    transcript("implement-session", 90_000, 10);

    await specRun(runSteps(), { configFolder }).run(spec);

    expect(outcomeRow()).toContain("| #1 | Opus medium | 1 |");
    const missing = `no transcript for session review-session under ${configFolder}`;
    expect(warnings()).toEqual([
      `byro-repo #1: warning: duration written unrecorded: ${missing}.`,
      `byro-repo #1: warning: review cost written unrecorded: ${missing}.`,
    ]);
  });
});

function replyOf(id: string, tokens: number, minute: number): object {
  return {
    type: "assistant",
    timestamp: new Date(Date.UTC(2026, 9, 12, 9, minute)).toISOString(),
    effort: "medium",
    message: {
      id,
      model: "claude-opus-5-5",
      usage: { input_tokens: tokens, output_tokens: 100 },
    },
  };
}
