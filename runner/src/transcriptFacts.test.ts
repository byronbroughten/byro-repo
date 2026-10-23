import {
  cpSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  handoffSessionIdOf,
  type TicketSessions,
  transcriptFactsOf,
} from "./transcriptFacts.ts";

const fixtures = join(import.meta.dirname, "..", "fixtures", "transcripts");

let configFolder: string;

beforeEach(() => {
  configFolder = realpathSync(mkdtempSync(join(tmpdir(), "transcripts-")));
  cpSync(fixtures, join(configFolder, "projects", "-workspace-byro-repo"), {
    recursive: true,
  });
});

afterEach(() => {
  rmSync(configFolder, { recursive: true, force: true });
});

// One handed-off implement session (from its comment), then the final implement step, review, triage and a fixer.
function sessions(overrides: Partial<TicketSessions> = {}): TicketSessions {
  return {
    account: 2,
    configFolder,
    steps: [
      { agent: "implement", sessionId: "session-implement-2" },
      { agent: "review", sessionId: "session-review" },
      { agent: "triage", sessionId: "session-triage" },
      { agent: "fix", sessionId: "session-fix" },
    ],
    ...overrides,
  };
}

const handoffs = ["session-implement-1"];

describe("transcriptFactsOf", () => {
  it("reads the pair from the implementer's transcripts", () => {
    expect(transcriptFactsOf(sessions(), handoffs).pair).toBe("Opus medium");
  });

  it("lists each implementer session's peak in order, leaving out the fixer", () => {
    expect(transcriptFactsOf(sessions(), handoffs).peakContext).toEqual([
      150_000, 90_000,
    ]);
  });

  it("prices the implementers and their subagents alone, counting a repeated reply once", () => {
    expect(transcriptFactsOf(sessions(), handoffs).costUsd).toBeCloseTo(
      1.454,
      6,
    );
  });

  it("prices the review, triage and fix sessions together as review cost", () => {
    expect(transcriptFactsOf(sessions(), handoffs).reviewCostUsd).toBeCloseTo(
      0.114,
      6,
    );
  });

  it("prices a review that started no further step as the review session alone", () => {
    const steps = sessions().steps.filter(
      ({ agent }) => agent === "implement" || agent === "review",
    );
    expect(
      transcriptFactsOf(sessions({ steps }), handoffs).reviewCostUsd,
    ).toBeCloseTo(0.024, 6);
  });

  it("leaves review cost unrecorded when no review session was recorded", () => {
    const steps = sessions().steps.filter(({ agent }) => agent === "implement");
    expect(
      transcriptFactsOf(sessions({ steps }), handoffs).reviewCostUsd,
    ).toBeUndefined();
  });

  it("sums every step session's span, review and handoffs included", () => {
    expect(transcriptFactsOf(sessions(), handoffs).durationMinutes).toBe(42);
  });

  it("writes the account and every session id, handoffs first", () => {
    const facts = transcriptFactsOf(sessions(), handoffs);
    expect([facts.account, facts.sessionIds]).toEqual([
      "2",
      [
        "session-implement-1",
        "session-implement-2",
        "session-review",
        "session-triage",
        "session-fix",
      ],
    ]);
  });

  it("leaves duration unrecorded when the review transcript is missing", () => {
    rmSync(
      join(
        configFolder,
        "projects",
        "-workspace-byro-repo",
        "session-review.jsonl",
      ),
    );
    expect(
      transcriptFactsOf(sessions(), handoffs).durationMinutes,
    ).toBeUndefined();
  });

  it("leaves every implementer fact unrecorded when a handoff transcript is missing", () => {
    const facts = transcriptFactsOf(sessions(), ["session-gone"]);
    expect([
      facts.pair,
      facts.peakContext,
      facts.costUsd,
      facts.durationMinutes,
    ]).toEqual([undefined, undefined, undefined, undefined]);
    expect(facts.reviewCostUsd).toBeCloseTo(0.114, 6);
  });

  it("leaves review cost unrecorded when a model has no price", () => {
    const fix = join(
      configFolder,
      "projects",
      "-workspace-byro-repo",
      "session-fix.jsonl",
    );
    writeFileSync(
      fix,
      readFileSync(fix, "utf8").replace("claude-opus-5-5", "claude-mystery-9"),
    );
    expect(
      transcriptFactsOf(sessions(), handoffs).reviewCostUsd,
    ).toBeUndefined();
  });

  it("leaves the implementer's facts unrecorded when no implementer session was recorded", () => {
    const steps = sessions().steps.filter(({ agent }) => agent !== "implement");
    const facts = transcriptFactsOf(sessions({ steps }), []);
    expect([
      facts.pair,
      facts.peakContext,
      facts.costUsd,
      facts.durationMinutes,
    ]).toEqual([undefined, undefined, undefined, 12]);
  });
});

describe("handoffSessionIdOf", () => {
  it("reads the session id from a handoff comment's last line", () => {
    expect(
      handoffSessionIdOf("## Handoff\n\nWork.\n\nsession: abc-123\n"),
    ).toBe("abc-123");
  });

  it("finds no session id in a comment that doesn't end with one", () => {
    expect(
      handoffSessionIdOf("session: abc-123\n\nA later note."),
    ).toBeUndefined();
  });
});
