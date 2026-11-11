// JSON-schema parts shared by the agent steps' record schemas, the gap-check record both Workflows' gap checks return, and the one validator over them.

import { Ajv } from "ajv";

import {
  blockerKinds,
  type GapCheckRecord,
  type ImplementRecord,
} from "./stepRecords.ts";
import { type Axis, verdicts } from "./verdicts.ts";

export const stringSchema = { type: "string" };

export function objectSchema(
  properties: Record<string, object>,
  { optional = [] }: { optional?: string[] } = {},
): object {
  return {
    type: "object",
    properties,
    required: Object.keys(properties).filter((key) => !optional.includes(key)),
    additionalProperties: false,
  };
}

interface ArrayBounds {
  minItems?: number;
  maxItems?: number;
}

export function arraySchema(items: object, bounds: ArrayBounds = {}): object {
  return { type: "array", items, ...bounds };
}

export const blockerSchema = objectSchema({
  kind: { enum: blockerKinds },
  detail: stringSchema,
  recommendation: stringSchema,
});

export const branchSchema = objectSchema({
  repo: stringSchema,
  branch: stringSchema,
  sha: stringSchema,
});

export const handoffSchema = objectSchema(
  {
    conclusion: stringSchema,
    filesToOpen: arraySchema(
      objectSchema({ path: stringSchema, lines: stringSchema }),
    ),
    ruledOut: arraySchema(stringSchema),
    filesChanged: arraySchema(stringSchema),
    stillFailing: arraySchema(stringSchema),
    proposedSplit: arraySchema(
      objectSchema({
        delivers: stringSchema,
        files: arraySchema(stringSchema),
      }),
      { minItems: 1 },
    ),
  },
  { optional: ["proposedSplit"] },
);

export function implementVariantSchema(
  status: ImplementRecord["status"],
  overrides: Record<string, object>,
): object {
  return objectSchema({
    status: { const: status },
    branches: arraySchema(branchSchema),
    closingComment: stringSchema,
    boxesUndone: arraySchema(
      objectSchema({ box: stringSchema, reason: stringSchema }),
    ),
    blockers: arraySchema(blockerSchema),
    ...overrides,
  });
}

export const uncommittedVariantSchemas = {
  blocked: implementVariantSchema("blocked", {
    branches: arraySchema(branchSchema, { maxItems: 0 }),
    blockers: arraySchema(blockerSchema, { minItems: 1 }),
  }),
  handoff: implementVariantSchema("handoff", {
    branches: arraySchema(branchSchema, { maxItems: 0 }),
    handoff: handoffSchema,
  }),
} as const;

// The review record every Workflow's review step returns, on that Workflow's axes, plus any fields of its own.
export function reviewRecordSchemaOf(
  reviewAxes: readonly Axis[],
  properties: Record<string, object> = {},
): object {
  const finding = objectSchema({
    axis: { enum: reviewAxes },
    where: stringSchema,
    claim: stringSchema,
    suggestedVerdict: { enum: verdicts },
    reason: stringSchema,
  });
  return objectSchema({ findings: arraySchema(finding), ...properties });
}

// The gap-check record every Workflow's gap check returns; reviewList.ts turns it into the last review list.
export const gapCheckOutputSchema = objectSchema({
  gaps: arraySchema(
    objectSchema({
      ask: stringSchema,
      evidence: stringSchema,
      recommendation: stringSchema,
      draftIssueTitle: stringSchema,
    }),
  ),
});

export function gapCheckRecordOf(output: unknown): GapCheckRecord {
  return output as GapCheckRecord;
}

// Each way `value` breaks `schema`, as its JSON path and Ajv's message; empty when it passes.
export function schemaProblemsOf(schema: object, value: unknown): string[] {
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  if (validate(value)) return [];
  return (validate.errors ?? []).map(
    (error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
  );
}
