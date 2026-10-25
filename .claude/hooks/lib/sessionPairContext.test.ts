import { describe, expect, it } from "vitest";

import {
  isIssueStartCommand,
  sessionPairLineOf,
} from "./sessionPairContext.ts";

describe("isIssueStartCommand", () => {
  it.each([
    "npm run issue:start -- byro-repo 404",
    "npm run issue:start -- --session retro",
  ])("matches %s", (command) => {
    expect(isIssueStartCommand(command)).toBe(true);
  });

  it.each([
    "npm run check",
    "grep -n 'npm run issue:start' AGENTS.md",
    "npm run issue:read -- byro-repo 404",
  ])("doesn't match %s", (command) => {
    expect(isIssueStartCommand(command)).toBe(false);
  });
});

describe("sessionPairLineOf", () => {
  it("states the session's pair", () => {
    const transcript = JSON.stringify({
      type: "assistant",
      effort: "medium",
      message: { model: "claude-opus-5-5" },
    });
    expect(sessionPairLineOf(transcript)).toBe(
      "This session runs Opus medium.",
    );
  });

  it("says nothing when the transcript has no pair", () => {
    expect(sessionPairLineOf("")).toBeUndefined();
  });
});
