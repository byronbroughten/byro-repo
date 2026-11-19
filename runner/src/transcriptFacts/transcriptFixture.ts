// The transcripts the transcriptFacts tests share: a config folder of fixtures copied for each test, and the sessions and writers over it.

import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach } from "vitest";

import type { OutcomeFacts } from "../outcomeLog.ts";
import {
  type RecordedSession,
  type StepAgent,
  type TicketSessions,
  transcriptFactsOf,
} from "../transcriptFacts.ts";

const fixtures = join(
  import.meta.dirname,
  "..",
  "..",
  "fixtures",
  "transcripts",
);

export let configFolder: string;

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
export function sessions(
  overrides: Partial<TicketSessions> = {},
): TicketSessions {
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

export function step(agent: StepAgent, sessionId: string): RecordedSession {
  return { agent, sessionId, account: 2, configFolder };
}

// Moves the review and resolve transcripts to account 1's folder and records them there.
export function reviewedOnAccountOne(): TicketSessions {
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

export const handoffs = ["session-implement-1"];
export const silenceTimeoutMs = 10 * 60_000;
// Over every gap in the fixtures, so their Duration is each transcript's whole span.
export const fixtureCapMs = 60 * 60_000;

export function factsOf(
  ticketSessions: TicketSessions,
  handoffSessionIds: string[],
  capMs = fixtureCapMs,
): OutcomeFacts {
  return transcriptFactsOf(ticketSessions, {
    handoffSessionIds,
    silenceTimeoutMs: capMs,
  });
}

export function entriesAt(minutes: number[]): string {
  return minutes
    .map((minute) =>
      JSON.stringify({
        type: "user",
        timestamp: new Date(Date.UTC(2026, 9, 6, 10, minute)).toISOString(),
      }),
    )
    .join("\n");
}

export function writeTranscript(sessionId: string, text: string): void {
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

export function at(minute: number): string {
  return new Date(Date.UTC(2026, 9, 6, 10, minute)).toISOString();
}

// An Opus 5.5 reply costing `dollars` in output tokens alone.
export function pricedReply(
  id: string,
  minute: number,
  dollars: number,
): object {
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
export function launchesOf(launchDollars: number[][]): string {
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

export function writeSubagent(
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
