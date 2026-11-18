import { describe, expect, it } from "vitest";

import type { AnsweredHalt } from "../halts.ts";
import { type FailureAnswer, haltReplies } from "./haltReplies.ts";

describe("haltReplies.failureAnswerOf", () => {
  it.each([
    "H1: continue +1 handoff: run the checks and land it",
    "H1: `continue +1 handoff`: run the checks and land it",
    "H1: **continue +1 handoff**: run the checks and land it",
    "H1: **continue +1 handoff:** run the checks and land it",
    "H1: Continue +1 handoff — run the checks and land it",
  ])("reads %j as more handoffs carrying the guidance", (reply) => {
    expect(answerOf(reply)).toEqual({
      kind: "more-handoffs",
      guidance: "run the checks and land it",
    });
  });

  it.each(["H1: continue +1 handoff", "H1: **`continue +1 handoff`**."])(
    "reads a bare %j as more handoffs with no guidance",
    (reply) => {
      expect(answerOf(reply)).toEqual({ kind: "more-handoffs" });
    },
  );

  it("keeps a reply that only mentions the option as guidance", () => {
    const text = "Split it first, then continue +1 handoff: land the rest";

    expect(answerOf(`H1: ${text}`)).toEqual({ kind: "guidance", text });
  });

  it("keeps a reply running on from the option with no separator as guidance", () => {
    const text = "continue +1 handoffs please";

    expect(answerOf(`H1: ${text}`)).toEqual({ kind: "guidance", text });
  });
});

function answerOf(reply: string): FailureAnswer {
  const halt: AnsweredHalt = {
    id: "H1",
    ticket: { repo: "byro-repo", number: 1 },
    kind: "failure",
    question: "Handed off past its cap.",
    options: ["`continue +1 handoff`"],
    scope: [],
    isPosted: true,
    isDelivered: false,
    ignoredReplies: [],
    answer: { replyId: "1", text: reply, at: "2026-11-18T00:00:00.000Z" },
  };
  return haltReplies.failureAnswerOf(halt);
}
