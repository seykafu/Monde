import { z } from "zod";

/**
 * Convert a zod schema into the JSON Schema subset Claude structured outputs accept (GDD §9.10.2):
 * no numeric/length/array-size constraints, `additionalProperties: false` on every object, every property required.
 * Use the result as `output_config: { format: modelOutputFormat(schema) }`.
 */
const UNSUPPORTED = [
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
  "minLength", "maxLength", "pattern", "minItems", "maxItems", "uniqueItems", "minProperties", "maxProperties",
  "$schema", "default",
];

type Json = { [k: string]: unknown };

function sanitize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitize);
  if (!node || typeof node !== "object") return node;
  const out: Json = {};
  for (const [k, v] of Object.entries(node as Json)) {
    if (UNSUPPORTED.includes(k)) continue;
    out[k] = sanitize(v);
  }
  if (out.type === "object" || (out.properties && typeof out.properties === "object")) {
    out.additionalProperties = false;
    out.required = Object.keys((out.properties as Json) ?? {});
  }
  return out;
}

export function modelJsonSchema(schema: z.ZodType): Json {
  return sanitize(z.toJSONSchema(schema, { io: "output", unrepresentable: "throw" })) as Json;
}

export function modelOutputFormat(schema: z.ZodType): { type: "json_schema"; schema: Json } {
  return { type: "json_schema", schema: modelJsonSchema(schema) };
}

/** Keys that must never appear in a schema sent to the API (used by tests). */
export const UNSUPPORTED_SCHEMA_KEYS: readonly string[] = UNSUPPORTED;
