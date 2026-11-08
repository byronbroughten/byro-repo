import { describe, expect, it } from "vitest";

import {
  mergeMasterOutputSchema,
  mergeMasterPrompt,
} from "./mergeMasterStep.ts";
import { schemaProblemsOf } from "./recordSchema.ts";

describe("mergeMasterPrompt", () => {
  const prompt = mergeMasterPrompt({
    issue: { repo: "byro-repo", number: 7 },
    title: "A ticket",
    branch: "issue-7-a-ticket",
    branchedRepos: ["sheets-framework", "byro-repo"],
    mergingRepos: ["byro-repo"],
    conflict: "Merging issue-7-a-ticket conflicts.",
  });

  it("says the merge is already in progress and names the repos it's in", () => {
    expect(prompt).toContain(
      "The runner has already started the merge of `master`, and it's in progress in byro-repo",
    );
  });

  it("has the step resolve with its edit tools, then add, commit and run the checks", () => {
    expect(prompt).toContain("with Read, Edit and Write");
    expect(prompt).toContain("keeping both sides' intent");
    expect(prompt).toContain("`git add` each resolved file");
    expect(prompt).toContain("`git commit --no-edit`");
    expect(prompt).toContain("`npm run check` until it passes");
  });

  it.each([
    "git merge",
    "git merge --abort",
    "git checkout",
    "git restore",
    "git reset",
    "git rebase",
  ])("forbids `%s`", (command) => {
    const [forbidden] = prompt
      .split("\n")
      .filter((line) => line.startsWith("- Never run `git merge`"));
    expect(forbidden).toContain(`\`${command}\``);
  });

  it("keeps the rules against amending, pushing, issue writes and the wrap-up", () => {
    expect(prompt).toContain(
      "Never amend or push, never comment on or close an issue, and never run the wrap-up.",
    );
  });

  it("has a step that can't tell set `unsure` and commit nothing", () => {
    expect(prompt).toContain(
      "When you can't tell how a conflict should be resolved, don't guess: set `unsure` to each file and the question it raises, and commit nothing.",
    );
  });
});

describe("mergeMasterOutputSchema", () => {
  const summary = "Both sides added an export; kept both.";

  it("accepts a record that is unsure", () => {
    expect(
      schemaProblemsOf(mergeMasterOutputSchema, {
        summary,
        files: ["byro-repo one.ts"],
        unsure: "byro-repo one.ts: which export stays?",
      }),
    ).toEqual([]);
  });

  it("accepts a summary with the conflicting files", () => {
    expect(
      schemaProblemsOf(mergeMasterOutputSchema, {
        summary,
        files: ["byro-repo one.ts"],
      }),
    ).toEqual([]);
  });

  it("refuses a record missing the files", () => {
    expect(schemaProblemsOf(mergeMasterOutputSchema, { summary })).toEqual([
      "/ must have required property 'files'",
    ]);
  });

  it("refuses a record naming no file", () => {
    expect(
      schemaProblemsOf(mergeMasterOutputSchema, { summary, files: [] }),
    ).toEqual(["/files must NOT have fewer than 1 items"]);
  });
});
