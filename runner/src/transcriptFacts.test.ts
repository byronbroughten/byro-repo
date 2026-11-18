import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { OutcomeFacts } from "./outcomeLog.ts";
import {
  handoffSessionIdOf,
  latestPairOf,
  localTranscriptsOf,
  type RecordedSession,
  type StepAgent,
  type TicketSessions,
  transcriptFactsOf,
  unrecordedFactsOf,
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

// One handed-off implement session (from its comment), then the final implement step, review and two resolve sessions.
function sessions(overrides: Partial<TicketSessions> = {}): TicketSessions {
  return {
    steps: [
      step("implement", "session-implement-2"),
      step("review", "session-review"),
      step("resolve", "session-triage"),
      step("resolve", "session-fix"),
    ],
    ...overrides,
  };
}

function step(agent: StepAgent, sessionId: string): RecordedSession {
  return { agent, sessionId, account: 2, configFolder };
}

// Moves the review and resolve transcripts to account 1's folder and records them there.
function reviewedOnAccountOne(): TicketSessions {
  const accountOne = join(configFolder, "account-1");
  const from = join(configFolder, "projects", "-workspace-byro-repo");
  const to = join(accountOne, "projects", "-workspace-byro-repo");
  mkdirSync(to, { recursive: true });
  const reviewIds = ["session-review", "session-triage", "session-fix"];
  for (const id of reviewIds) {
    renameSync(join(from, `${id}.jsonl`), join(to, `${id}.jsonl`));
  }
  return {
    steps: sessions().steps.map((recorded) =>
      reviewIds.includes(recorded.sessionId)
        ? { ...recorded, account: 1, configFolder: accountOne }
        : recorded,
    ),
  };
}

const handoffs = ["session-implement-1"];
const silenceTimeoutMs = 10 * 60_000;
// Over every gap in the fixtures, so their Duration is each transcript's whole span.
const fixtureCapMs = 60 * 60_000;

function factsOf(
  ticketSessions: TicketSessions,
  handoffSessionIds: string[],
  capMs = fixtureCapMs,
): OutcomeFacts {
  return transcriptFactsOf(ticketSessions, {
    handoffSessionIds,
    silenceTimeoutMs: capMs,
  });
}

function entriesAt(minutes: number[]): string {
  return minutes
    .map((minute) =>
      JSON.stringify({
        type: "user",
        timestamp: new Date(Date.UTC(2026, 9, 6, 10, minute)).toISOString(),
      }),
    )
    .join("\n");
}

function writeTranscript(sessionId: string, text: string): void {
  writeFileSync(
    join(
      configFolder,
      "projects",
      "-workspace-byro-repo",
      `${sessionId}.jsonl`,
    ),
    `${text}\n`,
  );
}

function at(minute: number): string {
  return new Date(Date.UTC(2026, 9, 6, 10, minute)).toISOString();
}

// An Opus 5.5 reply costing `dollars` in output tokens alone.
function pricedReply(id: string, minute: number, dollars: number): object {
  return {
    type: "assistant",
    timestamp: at(minute),
    message: {
      id,
      model: "claude-opus-5-5",
      usage: { output_tokens: Math.round(dollars * 50_000) },
    },
  };
}

// One session's launches, ten minutes apart: each a prompt, then its replies' dollars, each followed by a tool result.
function launchesOf(launchDollars: number[][]): string {
  return launchDollars
    .flatMap((replies, launch) => [
      {
        type: "user",
        timestamp: at(launch * 10),
        message: { content: `launch ${launch}` },
      },
      ...replies.flatMap((dollars, reply) => [
        pricedReply(`msg-${launch}-${reply}`, launch * 10 + reply + 1, dollars),
        {
          type: "user",
          timestamp: at(launch * 10 + reply + 1),
          message: { content: [{ type: "tool_result", content: "ok" }] },
        },
      ]),
    ])
    .map((entry) => JSON.stringify(entry))
    .join("\n");
}

function writeSubagent(
  sessionId: string,
  { minute, dollars }: { minute: number; dollars: number },
): void {
  const folder = join(
    configFolder,
    "projects",
    "-workspace-byro-repo",
    sessionId,
    "subagents",
  );
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, `agent-${minute}.jsonl`),
    `${JSON.stringify(pricedReply(`sub-${minute}`, minute, dollars))}\n`,
  );
}

describe("transcriptFactsOf", () => {
  it("reads the pair from the implementer's transcripts", () => {
    expect(factsOf(sessions(), handoffs).pair).toBe("Opus medium");
  });

  it("lists each implementer session's peak in order, leaving out the resolver", () => {
    expect(factsOf(sessions(), handoffs).peakContext).toEqual([
      150_000, 90_000,
    ]);
  });

  it("prices the implementers and their subagents alone, counting a repeated reply once", () => {
    expect(factsOf(sessions(), handoffs).costUsd).toBeCloseTo(1.454, 6);
  });

  it("prices the review and resolve sessions together as review cost", () => {
    expect(factsOf(sessions(), handoffs).reviewCostUsd).toBeCloseTo(0.114, 6);
  });

  it("prices a review that started no further step as the review session alone", () => {
    const steps = sessions().steps.filter(
      ({ agent }) => agent === "implement" || agent === "review",
    );
    expect(factsOf(sessions({ steps }), handoffs).reviewCostUsd).toBeCloseTo(
      0.024,
      6,
    );
  });

  it("leaves review cost unrecorded when no review session was recorded", () => {
    const steps = sessions().steps.filter(({ agent }) => agent === "implement");
    expect(
      factsOf(sessions({ steps }), handoffs).reviewCostUsd,
    ).toBeUndefined();
  });

  it("sums every step session's span, review and handoffs included", () => {
    expect(factsOf(sessions(), handoffs).durationMinutes).toBe(42);
  });

  it("leaves a gap over the silence timeout, as a Halt wait, out of the duration", () => {
    writeTranscript("session-halted", entriesAt([0, 5, 9, 50, 53]));
    const steps = [step("review", "session-halted")];
    expect(
      factsOf(sessions({ steps }), [], silenceTimeoutMs).durationMinutes,
    ).toBe(12);
  });

  it("gives the whole span when no gap is over the silence timeout", () => {
    writeTranscript("session-steady", entriesAt([0, 10, 12]));
    const steps = [step("review", "session-steady")];
    expect(
      factsOf(sessions({ steps }), [], silenceTimeoutMs).durationMinutes,
    ).toBe(12);
  });

  it("writes the account and every session id, handoffs first", () => {
    const facts = factsOf(sessions(), handoffs);
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

  it("finds each step session's transcript in its own config folder", () => {
    const facts = factsOf(reviewedOnAccountOne(), handoffs);
    expect([facts.account, facts.durationMinutes]).toEqual(["2, 1", 42]);
    expect(facts.costUsd).toBeCloseTo(1.454, 6);
    expect(facts.reviewCostUsd).toBeCloseTo(0.114, 6);
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
    expect(factsOf(sessions(), handoffs).durationMinutes).toBeUndefined();
  });

  it("leaves every implementer fact unrecorded when a handoff transcript is missing", () => {
    const facts = factsOf(sessions(), ["session-gone"]);
    expect([
      facts.pair,
      facts.peakContext,
      facts.costUsd,
      facts.durationMinutes,
    ]).toEqual([undefined, undefined, undefined, undefined]);
    expect(facts.reviewCostUsd).toBeCloseTo(0.114, 6);
  });

  // The #453 cause: a `/clear` successor that inherited the lease and never replied was recorded as an implementer.
  it("takes the pair and peak from the run's implementer when a reply-less interactive session joins it", () => {
    writeFileSync(
      join(
        configFolder,
        "projects",
        "-workspace-byro-repo",
        "session-clear.jsonl",
      ),
      `${JSON.stringify({ type: "user", timestamp: "2026-10-06T10:00:00Z" })}\n`,
    );
    const steps = [...sessions().steps, step("implement", "session-clear")];

    const facts = factsOf(sessions({ steps }), []);

    expect([facts.pair, facts.peakContext]).toEqual(["Opus medium", [90_000]]);
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
    expect(factsOf(sessions(), handoffs).reviewCostUsd).toBeUndefined();
  });

  it("prices a Haiku transcript", () => {
    const fix = join(
      configFolder,
      "projects",
      "-workspace-byro-repo",
      "session-fix.jsonl",
    );
    writeFileSync(
      fix,
      readFileSync(fix, "utf8").replace("claude-opus-5-5", "claude-haiku-5-5"),
    );
    expect(factsOf(sessions(), handoffs).reviewCostUsd).toBeCloseTo(0.085, 6);
  });

  it("leaves cost unrecorded when an implementer's model has no price", () => {
    const implement = join(
      configFolder,
      "projects",
      "-workspace-byro-repo",
      "session-implement-2.jsonl",
    );
    writeFileSync(
      implement,
      readFileSync(implement, "utf8").replaceAll(
        "claude-opus-5-5",
        "claude-mystery-9",
      ),
    );
    expect(factsOf(sessions(), handoffs).costUsd).toBeUndefined();
  });

  it("leaves the implementer's facts unrecorded when no implementer session was recorded", () => {
    const steps = sessions().steps.filter(({ agent }) => agent !== "implement");
    const facts = factsOf(sessions({ steps }), []);
    expect([
      facts.pair,
      facts.peakContext,
      facts.costUsd,
      facts.durationMinutes,
    ]).toEqual([undefined, undefined, undefined, 12]);
  });

  describe("a resolve step that resumes the implementer", () => {
    it("prices the implementer's turns before the resume as cost, and the resumed turns and their subagents as review cost", () => {
      writeTranscript(
        "session-warm",
        launchesOf([[1, 0.5], [0.25], [0.2, 0.1]]),
      );
      writeSubagent("session-warm", { minute: 1, dollars: 0.04 });
      writeSubagent("session-warm", { minute: 21, dollars: 0.05 });
      const steps = [
        step("implement", "session-warm"),
        step("implement", "session-warm"),
        step("review", "session-review"),
        step("resolve", "session-warm"),
      ];

      const facts = factsOf(sessions({ steps }), []);

      expect(facts.costUsd).toBeCloseTo(1.79, 6);
      expect(facts.reviewCostUsd).toBeCloseTo(0.374, 6);
    });

    it("prices a Halt's answer, which resumes the implementer after its resolve, as review cost", () => {
      writeTranscript("session-warm", launchesOf([[1], [0.2], [0.1]]));
      const steps = [
        step("implement", "session-warm"),
        step("review", "session-review"),
        step("resolve", "session-warm"),
        step("implement", "session-warm"),
      ];

      const facts = factsOf(sessions({ steps }), []);

      expect(facts.costUsd).toBeCloseTo(1, 6);
      expect(facts.reviewCostUsd).toBeCloseTo(0.324, 6);
    });

    it("prices a budget handoff resuming the implementer between review and resolve as cost", () => {
      writeTranscript("session-warm", launchesOf([[1], [0.5]]));
      writeTranscript("session-fresh", launchesOf([[0.3]]));
      const steps = [
        step("implement", "session-warm"),
        step("review", "session-review"),
        step("implement", "session-warm"),
        step("resolve", "session-fresh"),
      ];

      const facts = factsOf(sessions({ steps }), []);

      expect(facts.costUsd).toBeCloseTo(1.5, 6);
      expect(facts.reviewCostUsd).toBeCloseTo(0.324, 6);
    });

    it("cuts at the resume prompt past a task notification before it", () => {
      const lines = launchesOf([[1], [0.2]]).split("\n");
      const notified = [
        {
          type: "user",
          timestamp: at(5),
          origin: { kind: "task-notification" },
          message: { content: "<task-notification>done</task-notification>" },
        },
        pricedReply("msg-notified", 6, 0.5),
      ].map((entry) => JSON.stringify(entry));
      writeTranscript(
        "session-warm",
        [...lines.slice(0, 3), ...notified, ...lines.slice(3)].join("\n"),
      );
      const steps = [
        step("implement", "session-warm"),
        step("review", "session-review"),
        step("resolve", "session-warm"),
      ];

      const facts = factsOf(sessions({ steps }), []);

      expect(facts.costUsd).toBeCloseTo(1.5, 6);
      expect(facts.reviewCostUsd).toBeCloseTo(0.224, 6);
    });

    it("keeps the whole implementer session as cost beside a fresh resolver", () => {
      writeTranscript("session-warm", launchesOf([[1], [0.5]]));
      writeTranscript("session-fresh", launchesOf([[0.3], [0.1]]));
      const steps = [
        step("implement", "session-warm"),
        step("implement", "session-warm"),
        step("review", "session-review"),
        step("resolve", "session-fresh"),
        step("resolve", "session-fresh"),
      ];

      const facts = factsOf(sessions({ steps }), []);

      expect(facts.costUsd).toBeCloseTo(1.5, 6);
      expect(facts.reviewCostUsd).toBeCloseTo(0.424, 6);
    });
  });

  describe("a review step that resumes the implementer", () => {
    function startedAt(minute: number): Pick<RecordedSession, "startedAt"> {
      return { startedAt: at(minute) };
    }

    it("prices the turns and subagents from the review's recorded start as review cost, and those before it as cost", () => {
      writeTranscript("session-warm", launchesOf([[1], [0.2], [0.1]]));
      writeSubagent("session-warm", { minute: 1, dollars: 0.04 });
      writeSubagent("session-warm", { minute: 11, dollars: 0.05 });
      const steps = [
        { ...step("implement", "session-warm"), ...startedAt(0) },
        { ...step("review", "session-warm"), ...startedAt(10) },
        { ...step("resolve", "session-warm"), ...startedAt(20) },
      ];

      const facts = factsOf(sessions({ steps }), []);

      expect(facts.costUsd).toBeCloseTo(1.04, 6);
      expect(facts.reviewCostUsd).toBeCloseTo(0.35, 6);
    });

    it("cuts at the recorded start, not a prompt, so a task notification after it is review cost", () => {
      const lines = launchesOf([[1], [0.2]]).split("\n");
      const notified = [
        {
          type: "user",
          timestamp: at(9),
          origin: { kind: "task-notification" },
          message: { content: "<task-notification>done</task-notification>" },
        },
        pricedReply("msg-notified", 9, 0.5),
      ].map((entry) => JSON.stringify(entry));
      writeTranscript(
        "session-warm",
        [...lines.slice(0, 3), ...notified, ...lines.slice(3)].join("\n"),
      );
      const steps = [
        { ...step("implement", "session-warm"), ...startedAt(0) },
        { ...step("review", "session-review"), ...startedAt(8) },
        { ...step("resolve", "session-warm"), ...startedAt(10) },
      ];

      const facts = factsOf(sessions({ steps }), []);

      expect(facts.costUsd).toBeCloseTo(1, 6);
      expect(facts.reviewCostUsd).toBeCloseTo(0.724, 6);
    });

    it("splits at the review's own launch when the session was recorded without a start", () => {
      writeTranscript("session-warm", launchesOf([[1], [0.2], [0.1]]));
      writeSubagent("session-warm", { minute: 11, dollars: 0.05 });
      const steps = [
        step("implement", "session-warm"),
        step("review", "session-warm"),
        step("resolve", "session-warm"),
      ];

      const facts = factsOf(sessions({ steps }), []);

      expect(facts.costUsd).toBeCloseTo(1, 6);
      expect(facts.reviewCostUsd).toBeCloseTo(0.35, 6);
    });
  });
});

describe("unrecordedFactsOf", () => {
  it("names nothing when every fact is recorded", () => {
    expect(unrecordedFactsOf(sessions(), silenceTimeoutMs)).toEqual([]);
  });

  it("names a fact left unrecorded with every transcript found, and why", () => {
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
    expect(unrecordedFactsOf(sessions(), silenceTimeoutMs)).toEqual([
      {
        label: "review cost",
        reason: "a model it used is missing from the price table",
      },
    ]);
  });

  it("names nothing for a step that never ran", () => {
    const steps = sessions().steps.filter(({ agent }) => agent === "implement");
    expect(unrecordedFactsOf(sessions({ steps }), silenceTimeoutMs)).toEqual(
      [],
    );
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

describe("latestPairOf", () => {
  function reply(model: string, effort?: string, isSidechain = false): string {
    return JSON.stringify({
      type: "assistant",
      isSidechain,
      ...(effort === undefined ? {} : { effort }),
      message: { model },
    });
  }

  it("reads the latest main-loop reply's pair", () => {
    const text = [
      reply("claude-sonnet-5-5", "high"),
      JSON.stringify({ type: "user", message: {} }),
      reply("claude-opus-5-5", "medium"),
    ].join("\n");
    expect(latestPairOf(text)).toBe("Opus medium");
  });

  it("skips a later subagent or synthetic reply", () => {
    const text = [
      reply("claude-opus-5-5", "low"),
      reply("claude-haiku-5-5", "high", true),
      reply("<synthetic>", "high"),
    ].join("\n");
    expect(latestPairOf(text)).toBe("Opus low");
  });

  it("finds no pair when the latest main-loop reply has no effort", () => {
    const text = [
      reply("claude-opus-5-5", "medium"),
      reply("claude-opus-5-5"),
    ].join("\n");
    expect(latestPairOf(text)).toBeUndefined();
  });

  it("finds no pair in a transcript with no main-loop reply", () => {
    const text = [
      JSON.stringify({ type: "user", message: {} }),
      reply("claude-opus-5-5", "medium", true),
      "not json",
    ].join("\n");
    expect(latestPairOf(text)).toBeUndefined();
  });
});

describe("localTranscriptsOf", () => {
  let home: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "large-reads-")));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  function writeSession(
    folder: string,
    sessionId: string,
    timestamps: string[],
  ): void {
    const project = join(home, folder, "projects", "-workspace");
    mkdirSync(project, { recursive: true });
    const lines = timestamps.map((timestamp) =>
      JSON.stringify({ type: "user", timestamp, message: { content: "hi" } }),
    );
    writeFileSync(join(project, `${sessionId}.jsonl`), `${lines.join("\n")}\n`);
  }

  it("reads each session that started in the range, once across the config folders, leaving out subagents", () => {
    writeSession("live", "inside", ["2026-11-02T10:00:00Z"]);
    writeSession("account-1", "inside", ["2026-11-02T10:00:00Z"]);
    writeSession("account-1", "also-inside", [
      "2026-11-09T10:00:00Z",
      "2026-11-12T10:00:00Z",
    ]);
    writeSession("account-1", "before", ["2026-10-30T10:00:00Z"]);
    writeSession("account-1", "after", ["2026-11-10T00:00:00Z"]);
    const subagents = join(
      home,
      "account-1",
      "projects",
      "-workspace",
      "inside",
      "subagents",
    );
    mkdirSync(subagents, { recursive: true });
    writeFileSync(join(subagents, "agent-1.jsonl"), "{}\n");
    const found = localTranscriptsOf(
      [join(home, "live"), join(home, "account-1"), join(home, "missing")],
      {
        from: new Date("2026-11-01T00:00:00Z"),
        to: new Date("2026-11-10T00:00:00Z"),
      },
    );
    expect(found.map(({ sessionId }) => sessionId).sort()).toEqual([
      "also-inside",
      "inside",
    ]);
  });

  it("skips a transcript last written before the range without reading it", () => {
    writeSession("live", "stale", ["2026-11-02T10:00:00Z"]);
    const path = join(home, "live", "projects", "-workspace", "stale.jsonl");
    const longAgo = new Date("2026-01-01T00:00:00Z");
    utimesSync(path, longAgo, longAgo);
    const found = localTranscriptsOf([join(home, "live")], {
      from: new Date("2026-11-01T00:00:00Z"),
      to: new Date("2026-11-10T00:00:00Z"),
    });
    expect(found).toEqual([]);
  });
});
