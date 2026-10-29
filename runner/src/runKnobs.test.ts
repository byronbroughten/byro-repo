import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  defaultRunKnobs,
  loadRunKnobs,
  runKnobsOrDefaults,
} from "./runKnobs.ts";

let temp: string;

beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), "run-knobs-"));
});

afterEach(() => {
  rmSync(temp, { recursive: true, force: true });
});

function overrideFile(content: string): string {
  const path = join(temp, "runner.config.json");
  writeFileSync(path, content);
  return path;
}

describe("loadRunKnobs", () => {
  it("lays the override file over the defaults, one nested knob at a time, and takes the repo map from its caller", () => {
    const path = overrideFile(
      JSON.stringify({
        clonePaths: { stale: "packages/stale" },
        allowedTools: { review: ["Read"] },
        wallClockMs: { review: 5_000 },
        handoffDocPath: "docs/handoffs.md",
      }),
    );

    const knobs = loadRunKnobs(path, { "byro-repo": "." });

    expect(knobs.clonePaths).toEqual({ "byro-repo": "." });
    expect(knobs.allowedTools).toEqual({
      ...defaultRunKnobs.allowedTools,
      review: ["Read"],
    });
    expect(knobs.handoffDocPath).toBe("docs/handoffs.md");
    expect(knobs.ticketBudget).toBe(150_000);
    expect(knobs.liveCeiling).toBe(180_000);
    expect(knobs.resolverPair).toEqual({ model: "opus", effort: "medium" });
    expect(knobs.gapCheckPair).toEqual({ model: "opus", effort: "medium" });
    expect(knobs.reviewListCadence).toBe("end-of-run");
    expect(knobs.maxTurns.gapCheck).toBe(80);
    expect(knobs.wallClockMs).toEqual({
      ...defaultRunKnobs.wallClockMs,
      review: 5_000,
    });
    expect(knobs.wallClockMs.implement).toBe(3_600_000);
    expect(knobs.silenceTimeoutMs).toBe(600_000);
    expect(knobs.retriesPerFailure).toBe(1);
    expect(knobs.skillNames.review).toBe("code-review");
  });

  it("checks GitHub auth and the default claude login unless the auth checks are overridden", () => {
    expect(loadRunKnobs(overrideFile("{}"), {}).authChecks).toEqual([
      ["gh", "auth", "status"],
      ["claude", "auth", "status"],
    ]);
    expect(
      loadRunKnobs(overrideFile('{ "authChecks": [["true"]] }'), {}).authChecks,
    ).toEqual([["true"]]);
  });

  it("throws on an unreadable override file", () => {
    expect(() => loadRunKnobs(join(temp, "missing.json"), {})).toThrow();
  });
});

describe("runKnobsOrDefaults", () => {
  it("falls back to the defaults when the override file can't load", () => {
    expect(runKnobsOrDefaults(overrideFile("{ not json"))).toEqual(
      defaultRunKnobs,
    );
  });
});
