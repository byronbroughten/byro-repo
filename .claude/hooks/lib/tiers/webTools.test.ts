import { describe, expect, it } from "vitest";

import { webGateDecision } from "./webTools.ts";

function decisionOf(toolName: string, url?: string) {
  return webGateDecision(toolName, url === undefined ? {} : { url })
    ?.permissionDecision;
}

describe("webGateDecision", () => {
  it.each([
    "https://developers.google.com/workspace/sheets/api/reference/rest",
    "https://support.google.com/docs/answer/3093281",
    "http://docs.anthropic.com/en/docs/claude-code/hooks",
  ])("allows a WebFetch of %s", (url) => {
    expect(decisionOf("WebFetch", url)).toBe("allow");
  });

  it("allows a WebSearch", () => {
    expect(decisionOf("WebSearch")).toBe("allow");
  });

  it.each([
    "https://example.com/?q=developers.google.com",
    "https://developers.google.com.example.com/x",
    "https://developers.google.com@example.com/x",
    "https://evil.developers.google.com/x",
    "ftp://developers.google.com/x",
    "developers.google.com/x",
  ])("decides nothing for a WebFetch of %s", (url) => {
    expect(decisionOf("WebFetch", url)).toBeUndefined();
  });

  it("decides nothing for a WebFetch with no URL, or another tool", () => {
    expect(decisionOf("WebFetch")).toBeUndefined();
    expect(
      decisionOf("Bash", "https://developers.google.com/x"),
    ).toBeUndefined();
  });
});
