import { afterEach, describe, expect, it, vi } from "vitest";

import type { SessionMode } from "./tiers.ts";

class ParseError extends Error {}

const sessionModes: SessionMode[] = ["interactive", "runnerStep"];

// ShellParser/shellSyntax.ts loads sh-syntax at module top level, so each case reloads the gate behind its own mock.
async function gateDecisionWith(shSyntax: () => object) {
  vi.resetModules();
  vi.doMock("sh-syntax", shSyntax);
  const { gateDecision } = await import("./tiers.ts");
  return gateDecision;
}

describe("a gate whose bash parser won't run", () => {
  afterEach(() => {
    vi.doUnmock("sh-syntax");
  });

  it.each([
    [
      "won't load",
      () => {
        throw new Error("Cannot find package 'sh-syntax'");
      },
    ],
    [
      "throws past a syntax error",
      () => ({
        ParseError,
        parseSync() {
          throw new TypeError("wasm instance gone");
        },
      }),
    ],
  ])(
    "refuses every call in either mode when the parser %s, naming npm install",
    async (_kind, shSyntax) => {
      const gateDecision = await gateDecisionWith(shSyntax);
      sessionModes.forEach((mode) => {
        const decision = gateDecision({
          command: "gh label list",
          mode,
          dryRuns: [],
        });
        expect(decision?.permissionDecision).toBe("deny");
        expect(decision?.reason).toContain("npm install");
      });
    },
  );
});
