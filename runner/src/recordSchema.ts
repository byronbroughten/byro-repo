// JSON-schema parts shared by the agent steps' record schemas, and the one validator over them.

import { Ajv } from "ajv";

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

// Each way `value` breaks `schema`, as its JSON path and Ajv's message; empty when it passes.
export function schemaProblemsOf(schema: object, value: unknown): string[] {
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  if (validate(value)) return [];
  return (validate.errors ?? []).map(
    (error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
  );
}
