import { describe, expect, it } from "vitest";

import { sessionPairLineOf } from "./sessionPairContext.ts";

const transcript = JSON.stringify({
  type: "assistant",
  effort: "medium",
  message: { model: "claude-opus-5-5" },
});

describe("sessionPairLineOf", () => {
  it.each([
    "npm run issue:start -- byro-repo 404",
    "npm run issue:start -- --session retro",
  ])("states the session's pair after %s", (command) => {
    expect(sessionPairLineOf(command, transcript)).toBe(
      "This session runs Opus medium.",
    );
  });

  it.each([
    "npm run check",
    "grep -n 'npm run issue:start' AGENTS.md",
    "npm run issue:read -- byro-repo 404",
  ])("says nothing after %s", (command) => {
    expect(sessionPairLineOf(command, transcript)).toBeUndefined();
  });

  it("says nothing when the transcript has no pair", () => {
    expect(
      sessionPairLineOf("npm run issue:start -- byro-repo 404", ""),
    ).toBeUndefined();
  });
});
