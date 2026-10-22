// JSON-schema parts shared by the agent steps' record schemas.

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
