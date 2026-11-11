// The research record the step returns: its output schema and the checks the runner makes on it before ../../../SpecRun/ResearchStepper.ts keeps it.
// researchWords.ts holds the step's prompt and comment words; ../pieceWorkflow.ts registers both as the piece Workflow's research rules.

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { outlineEditSchema } from "../../../outlineEdits.ts";
import {
  arraySchema,
  blockerSchema,
  objectSchema,
  schemaProblemsOf,
  stringSchema,
} from "../../../recordSchema.ts";
import type { ResearchRecord } from "../../../stepRecords.ts";

const countSchema = { type: "integer", minimum: 0 };

// One variant per status, so only the status that needs a field carries it.
const recordVariantsSchema = {
  oneOf: [
    objectSchema({
      status: { const: "ready" },
      commentPath: stringSchema,
      textsFolder: stringSchema,
      counts: objectSchema({
        supported: countSchema,
        rewritten: countSchema,
        unverified: countSchema,
      }),
      outlineEdits: arraySchema(outlineEditSchema),
      unverified: arraySchema(
        objectSchema({
          fact: stringSchema,
          reason: stringSchema,
          isWanted: { type: "boolean" },
        }),
      ),
      blockers: arraySchema(blockerSchema),
    }),
    objectSchema({
      status: { const: "blocked" },
      blockers: arraySchema(blockerSchema, { minItems: 1 }),
    }),
    objectSchema({
      status: { const: "handoff" },
      blockers: arraySchema(blockerSchema),
      handoff: objectSchema({
        conclusion: stringSchema,
        sourcesDone: arraySchema(stringSchema),
        sourcesLeft: arraySchema(stringSchema),
      }),
    }),
  ],
};

// The API refuses a top-level oneOf in a tool's input schema, so the record sits under `record`.
export const researchOutputSchema = objectSchema({
  record: recordVariantsSchema,
});

export function researchRecordOf(output: unknown): ResearchRecord {
  return (output as { record: ResearchRecord }).record;
}

// What the schema can't see: whether a ready record's comment is where it says.
export function researchRecordProblems(output: unknown, cwd: string): string[] {
  const problems = schemaProblemsOf(researchOutputSchema, output);
  if (problems.length > 0) return problems;
  const record = researchRecordOf(output);
  if (record.status !== "ready") return [];
  const commentPath = resolve(cwd, record.commentPath);
  if (existsSync(commentPath)) return [];
  return [`the record is ready, but the comment at ${commentPath} isn't there`];
}
