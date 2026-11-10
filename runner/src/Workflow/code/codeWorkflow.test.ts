import { describe, expect, it } from "vitest";

import type {
  TicketState,
  TicketStep,
  TrackedIssue,
} from "../../SpecRun/runState.ts";
import type { ImplementRecord } from "../../stepRecords.ts";
import { codeWorkflow } from "./codeWorkflow.ts";

const ticket: TrackedIssue = {
  issue: { repo: "byro-repo", number: 7 },
  title: "A ticket",
  body: "",
  isOpen: true,
  labels: ["ready-for-agent"],
  url: "https://github.com/owner/byro-repo/issues/7",
  author: "developer",
  bodyEditors: [],
};

const committed: ImplementRecord = {
  status: "committed",
  branches: [{ repo: "byro-repo", branch: "issue-7-a-ticket", sha: "abc" }],
  closingComment: "Landed it.",
  boxesUndone: [],
  blockers: [],
};

const applied: ImplementRecord = {
  status: "applied",
  branches: [],
  closingComment: "Commented.",
  boxesUndone: [],
  blockers: [],
  githubWrites: [
    {
      issue: "owner/byro-repo#7",
      action: "comment",
      url: "https://github.com/owner/byro-repo/issues/7#issuecomment-1",
      summary: "Posted the comment.",
    },
  ],
};

function stateAt(
  step: TicketStep,
  change: Partial<TicketState> = {},
): TicketState {
  return { step, sessions: [], ...change };
}

function nextAfter(state: TicketState): TicketStep | undefined {
  const sequence = codeWorkflow.stepsOf(ticket);
  return sequence.find(({ step }) => step === state.step)?.nextOf?.(state);
}

describe("codeWorkflow", () => {
  it("is named code", () => {
    expect(codeWorkflow.name).toBe("code");
  });

  it("supplies implement or resume, review, resolve, checks and wrap-up, in order", () => {
    const sequence = codeWorkflow.stepsOf(ticket);
    expect(sequence.map(({ step }) => step)).toEqual([
      "implement",
      "resume",
      "review",
      "resolve",
      "checks",
      "wrap-up",
    ]);
  });

  it("goes from a committed implement to review", () => {
    expect(nextAfter(stateAt("implement", { record: committed }))).toBe(
      "review",
    );
  });

  it("skips from an applied implement to wrap-up", () => {
    expect(nextAfter(stateAt("implement", { record: applied }))).toBe(
      "wrap-up",
    );
  });

  it("continues a resume before review at review", () => {
    expect(nextAfter(stateAt("resume", { record: committed }))).toBe("review");
  });

  it("continues a resume after review at checks", () => {
    expect(
      nextAfter(stateAt("resume", { record: committed, findings: [] })),
    ).toBe("checks");
  });

  it("skips from an applied resume to wrap-up", () => {
    expect(nextAfter(stateAt("resume", { record: applied }))).toBe("wrap-up");
  });

  it("goes from a review with findings to resolve", () => {
    expect(nextAfter(stateAt("review", { findings: ["A finding."] }))).toBe(
      "resolve",
    );
  });

  it("skips from a review with no findings to checks", () => {
    expect(nextAfter(stateAt("review", { findings: [] }))).toBe("checks");
  });

  it("goes from resolve to checks, and from checks to wrap-up", () => {
    expect(nextAfter(stateAt("resolve"))).toBe("checks");
    expect(nextAfter(stateAt("checks"))).toBe("wrap-up");
  });

  it("ends at wrap-up", () => {
    expect(nextAfter(stateAt("wrap-up"))).toBeUndefined();
  });
});
