import { describe, expect, it } from "vitest";

import { mergeMasterOutputSchema } from "./mergeMasterStep.ts";
import { schemaProblemsOf } from "./recordSchema.ts";

describe("mergeMasterOutputSchema", () => {
  const summary = "Both sides added an export; kept both.";

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
