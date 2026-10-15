import { describe, expect, it } from "vitest";

import { secretShapeOf } from "./secretShapes.ts";

// Built by concatenation, so this file never carries a token shape the wrap-up would refuse to push.
const tail = "Ab3_dE6-gH9jK2mN5pQ8sT1vW4yZ7cF0iL3oR6uX9";

describe("secretShapeOf", () => {
  it.each([
    ["Google OAuth access token", `token = "ya29.${tail}"`],
    ["Google OAuth refresh token", `"refresh_token": "1//0g${tail}"`],
    ["Google API key", `key: "AIza${tail.slice(0, 35)}"`],
    ["GitHub token", `GH=ghp_${"a1B2c3D4e5".repeat(4).slice(0, 36)}`],
    ["GitHub token", `GH=gho_${"a1B2c3D4e5".repeat(4).slice(0, 36)}`],
    ["GitHub token", `GH=github_pat_11${"A".repeat(20)}_${tail}`],
    ["Anthropic key", `ANTHROPIC_API_KEY=sk-ant-api03-${tail}`],
    ["private key block", "-----BEGIN RSA " + "PRIVATE KEY-----"],
    ["private key block", "-----BEGIN " + "PRIVATE KEY-----"],
    [
      "OAuth client secret",
      `{"client_id":"x","client_secret"` + `: "GOCSPX-abc"}`,
    ],
  ])("finds a %s", (shape, line) => {
    expect(secretShapeOf(line)).toBe(shape);
  });

  it.each([
    [
      "a bare prefix in prose",
      "Access tokens start with ya29. and refresh ones with 1//.",
    ],
    ["a URL with a double slash", "see https://example.com//path"],
    ["a short GitHub-prefixed name", "const ghp_count = 3;"],
    ["a public key block", "-----BEGIN PUBLIC KEY-----"],
    ["a client secret field name", "clientSecret: config.client_secret,"],
  ])("ignores %s", (_case, line) => {
    expect(secretShapeOf(line)).toBeUndefined();
  });
});
