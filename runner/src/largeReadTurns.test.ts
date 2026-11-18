import { describe, expect, it } from "vitest";

import {
  type KindTurns,
  largeReadChars,
  largeReadTurnsOf,
} from "./largeReadTurns.ts";
import { reviewFramingOf, stepOpeningOf } from "./promptText.ts";
import type { LocalTranscript, TranscriptEntry } from "./transcriptFacts.ts";
import { draftingTicketKind } from "./Workflow/piece/implementStep.ts";

const bigText = "x".repeat(largeReadChars);
const smallText = "x".repeat(largeReadChars - 1);

let replyCount = 0;

function prompt(text: string): TranscriptEntry {
  return { type: "user", message: { content: text } };
}

function slashCommand(name: string): TranscriptEntry[] {
  return [
    prompt(
      `<command-message>${name}</command-message>\n<command-name>/${name}</command-name>\n<command-args>byro-repo 1</command-args>`,
    ),
  ];
}

// The skill's SKILL.md body, which Claude Code adds after its slash command or Skill call.
function skillBody(name: string): TranscriptEntry {
  return {
    type: "user",
    isMeta: true,
    message: {
      content: [
        {
          type: "text",
          text: `Base directory for this skill: /workspace/.claude/skills/${name}\n\n# ${name}`,
        },
      ],
    },
  };
}

function reply(...content: unknown[]): TranscriptEntry {
  replyCount += 1;
  return {
    type: "assistant",
    message: { id: `msg-${replyCount}`, model: "claude-opus-5-5", content },
  };
}

function toolCall(id: string, name: string): unknown {
  return { type: "tool_use", id, name, input: {} };
}

function toolResult(id: string, text: string): TranscriptEntry {
  return {
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: id, content: text }],
    },
  };
}

// A Read call, its result and the replies after it.
function readThen(
  id: string,
  text: string,
  turnsAfter: number,
): TranscriptEntry[] {
  return [
    reply(toolCall(id, "Read")),
    toolResult(id, text),
    ...Array.from({ length: turnsAfter }, () =>
      reply({ type: "text", text: "ok" }),
    ),
  ];
}

function transcript(
  sessionId: string,
  entries: TranscriptEntry[],
): LocalTranscript {
  return { sessionId, entries };
}

function kindOf(kinds: KindTurns[], kind: string): KindTurns | undefined {
  return kinds.find((turns) => turns.kind === kind);
}

describe("largeReadTurnsOf", () => {
  it("counts the main-loop replies after a large Read, by the runner step kind its prompt names", () => {
    const kinds = largeReadTurnsOf([
      transcript("a", [
        prompt(
          "You are the implement step of an unattended run. Implement byro-repo#1.",
        ),
        ...readThen("r1", bigText, 3),
      ]),
      transcript("b", [
        prompt(
          "You are the implement step of an unattended run. Implement byro-repo#2.",
        ),
        ...readThen("r2", bigText, 7),
      ]),
      transcript("c", [
        prompt(
          "You are the implement step of an unattended run. Implement byro-repo#3.",
        ),
        ...readThen("r3", bigText, 5),
      ]),
    ]);
    expect(kinds).toEqual([
      {
        kind: "implement step",
        sessionCount: 3,
        turnsAfter: [3, 7, 5],
        median: 5,
      },
    ]);
  });

  it("leaves out a Read under the size line, and a large result of another tool", () => {
    const kinds = largeReadTurnsOf([
      transcript("a", [
        prompt("You are the resolve step of an unattended run."),
        ...readThen("r1", smallText, 4),
        reply(toolCall("g1", "Grep")),
        toolResult("g1", bigText),
        reply({ type: "text", text: "done" }),
      ]),
    ]);
    expect(kinds).toEqual([]);
  });

  it("reads a text-block result, and counts a reply split across entries once", () => {
    const split = reply({ type: "text", text: "one" });
    const kinds = largeReadTurnsOf([
      transcript("a", [
        prompt("You are the red-checks step of an unattended run."),
        reply(toolCall("r1", "Read")),
        {
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "r1",
                content: [{ type: "text", text: bigText }],
              },
            ],
          },
        },
        split,
        { ...split },
        reply({ type: "text", text: "two" }),
      ]),
    ]);
    expect(kindOf(kinds, "red-checks step")?.turnsAfter).toEqual([2]);
  });

  it("names the review step a run's resumed implementer runs, from its prompt on", () => {
    const kinds = largeReadTurnsOf([
      transcript("a", [
        prompt(
          "You are the implement step of an unattended run. Implement byro-repo#1.",
        ),
        ...readThen("r1", bigText, 2),
        prompt(
          "You implemented this ticket, and you now run its review step in an unattended run: you orchestrate the review.",
        ),
        ...readThen("r2", bigText, 1),
      ]),
    ]);
    // The read stays in context through the review: its 2 replies, the review's Read call and its 1.
    expect(kindOf(kinds, "implement step")?.turnsAfter).toEqual([4]);
    expect(kindOf(kinds, "review step")?.turnsAfter).toEqual([1]);
  });

  it("names the gap check and an interactive session's slash-command skill", () => {
    const kinds = largeReadTurnsOf([
      transcript("a", [
        prompt("You are the gap check of an unattended run."),
        ...readThen("r1", bigText, 1),
      ]),
      transcript("b", [
        ...slashCommand("start-issue"),
        skillBody("start-issue"),
        ...readThen("r2", bigText, 2),
      ]),
    ]);
    expect(kindOf(kinds, "gap check")?.turnsAfter).toEqual([1]);
    expect(kindOf(kinds, "/start-issue")?.turnsAfter).toEqual([2]);
  });

  it("names no kind for a built-in slash command, which loads no skill, nor for a skill the agent calls", () => {
    const kinds = largeReadTurnsOf([
      transcript("a", [
        ...slashCommand("clear"),
        prompt("Look at the runner."),
        reply(toolCall("s1", "Skill")),
        toolResult("s1", "Launching skill: code-style"),
        skillBody("code-style"),
        ...readThen("r1", bigText, 1),
      ]),
    ]);
    expect(kinds.map(({ kind }) => kind)).toEqual(["other"]);
  });

  it("puts a session with no skill or step in one other kind, and lists kinds by read count", () => {
    const kinds = largeReadTurnsOf([
      transcript("a", [
        prompt("What does this do?"),
        ...readThen("r1", bigText, 1),
      ]),
      transcript("b", [
        prompt("Explain the run loop."),
        ...readThen("r2", bigText, 2),
        ...readThen("r3", bigText, 4),
      ]),
      transcript("c", [
        prompt("You are the resolve step of an unattended run."),
        ...readThen("r4", bigText, 6),
      ]),
    ]);
    expect(kinds).toEqual([
      { kind: "other", sessionCount: 2, turnsAfter: [1, 7, 4], median: 4 },
      { kind: "resolve step", sessionCount: 1, turnsAfter: [6], median: 6 },
    ]);
  });

  it("stops counting at a compaction, which drops the read from context", () => {
    const kinds = largeReadTurnsOf([
      transcript("a", [
        prompt("You are the implement step of an unattended run."),
        ...readThen("r1", bigText, 2),
        {
          type: "user",
          isCompactSummary: true,
          message: { content: "summary" },
        },
        reply({ type: "text", text: "after" }),
      ]),
    ]);
    expect(kindOf(kinds, "implement step")?.turnsAfter).toEqual([2]);
  });

  it("takes an even count's median as the mean of its middle two", () => {
    const kinds = largeReadTurnsOf([
      transcript("a", [
        prompt("Look around."),
        ...readThen("r1", bigText, 1),
        ...readThen("r2", bigText, 2),
      ]),
    ]);
    // Each Read call is a reply too, so the first read is followed by its own 1 and the second's 3.
    expect(kindOf(kinds, "other")).toEqual({
      kind: "other",
      sessionCount: 1,
      turnsAfter: [4, 2],
      median: 3,
    });
  });
});

describe("the step openings the prompts are worded from", () => {
  const steps = [
    "implement step",
    "research step",
    "resolve step",
    "red-checks step",
    "merge-master step",
    "gap check",
  ];

  it.each(
    steps.flatMap((step) => [
      [step, stepOpeningOf(step)],
      [step, stepOpeningOf(step, draftingTicketKind)],
    ]),
  )("names the %s from its prompt's opening", (step, opening) => {
    const kinds = largeReadTurnsOf([
      transcript("a", [
        prompt(`${opening} More.`),
        ...readThen("r1", bigText, 1),
      ]),
    ]);
    expect(kinds.map(({ kind }) => kind)).toEqual([step]);
  });

  it.each(["", draftingTicketKind])(
    "names a run's resumed review step from its opening%s",
    (ticketKind) => {
      const kinds = largeReadTurnsOf([
        transcript("a", [
          prompt(reviewFramingOf(undefined, ticketKind).opening),
          ...readThen("r1", bigText, 1),
        ]),
      ]);
      expect(kinds.map(({ kind }) => kind)).toEqual(["review step"]);
    },
  );
});
