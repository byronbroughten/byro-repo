import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  configFolder,
  factsOf,
  handoffs,
  sessions,
} from "./transcriptFixture.ts";

describe("transcriptFactsOf costs", () => {
  it("prices the implementers and their subagents alone, counting a repeated reply once", () => {
    expect(factsOf(sessions(), handoffs).costUsd).toBeCloseTo(1.454, 6);
  });

  it("prices the review and resolve sessions together as review cost", () => {
    expect(factsOf(sessions(), handoffs).reviewCostUsd).toBeCloseTo(0.114, 6);
  });

  it("prices a review that started no further step as the review session alone", () => {
    const steps = sessions().steps.filter(
      ({ agent }) => agent === "implement" || agent === "review",
    );
    expect(factsOf(sessions({ steps }), handoffs).reviewCostUsd).toBeCloseTo(
      0.024,
      6,
    );
  });

  it("leaves review cost unrecorded when no review session was recorded", () => {
    const steps = sessions().steps.filter(({ agent }) => agent === "implement");
    expect(
      factsOf(sessions({ steps }), handoffs).reviewCostUsd,
    ).toBeUndefined();
  });
  it("leaves review cost unrecorded when a model has no price", () => {
    const fix = join(
      configFolder,
      "projects",
      "-workspace-byro-repo",
      "session-fix.jsonl",
    );
    writeFileSync(
      fix,
      readFileSync(fix, "utf8").replace("claude-opus-5-5", "claude-mystery-9"),
    );
    expect(factsOf(sessions(), handoffs).reviewCostUsd).toBeUndefined();
  });

  it("prices a Haiku transcript", () => {
    const fix = join(
      configFolder,
      "projects",
      "-workspace-byro-repo",
      "session-fix.jsonl",
    );
    writeFileSync(
      fix,
      readFileSync(fix, "utf8").replace("claude-opus-5-5", "claude-haiku-5-5"),
    );
    expect(factsOf(sessions(), handoffs).reviewCostUsd).toBeCloseTo(0.085, 6);
  });

  it("leaves cost unrecorded when an implementer's model has no price", () => {
    const implement = join(
      configFolder,
      "projects",
      "-workspace-byro-repo",
      "session-implement-2.jsonl",
    );
    writeFileSync(
      implement,
      readFileSync(implement, "utf8").replaceAll(
        "claude-opus-5-5",
        "claude-mystery-9",
      ),
    );
    expect(factsOf(sessions(), handoffs).costUsd).toBeUndefined();
  });
});
