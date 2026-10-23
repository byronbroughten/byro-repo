import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { wrapUpConfig } from "./runnerConfig.ts";

const root = join(import.meta.dirname, "..", "..");

describe("wrap-up's outcome row writer", () => {
  it("writes the row with the given checkout's own code, in a child process", async () => {
    const stateFolder = mkdtempSync(join(tmpdir(), "outcome-row-state-"));
    const outcomes = mkdtempSync(join(tmpdir(), "outcome-row-outcomes-"));
    writeFileSync(
      join(stateFolder, "byro-repo-2.facts.json"),
      JSON.stringify({
        closingComment: "Landed.",
        boxesUndone: [],
        pair: "Opus medium",
      }),
    );

    const written = await wrapUpConfig.writeOutcomeRow?.(root, {
      issue: { repo: "byro-repo", number: 2 },
      spec: { repo: "byro-repo", number: 1 },
      githubOwner: "byronbroughten",
      filesChanged: 3,
      handoffSessionIds: [],
      stateFolder,
      outcomeFolder: relative(root, outcomes),
    });

    expect(written?.commitMessage).toMatch(/^Record the #2 outcome: /);
    const row = readFileSync(join(root, written?.path ?? ""), "utf8");
    expect(row).toContain("| Review cost |");
    expect(row).toContain("| #2 | Opus medium |");
  });
});
