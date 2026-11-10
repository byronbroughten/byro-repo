// JSON-schema parts shared by the agent steps' record schemas, and the one validator over them.

import { Ajv } from "ajv";

import { blockerKinds, type ImplementRecord } from "./stepRecords.ts";

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

// Each way `value` breaks `schema`, as its JSON path and Ajv's message; empty when it passes.
export function schemaProblemsOf(schema: object, value: unknown): string[] {
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  if (validate(value)) return [];
  return (validate.errors ?? []).map(
    (error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
  );
}
