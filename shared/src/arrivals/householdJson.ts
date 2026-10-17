/**
 * The household card contract as text (A.3.6). Strict structured output (output_config.format) can't carry this schema:
 * the API refuses it ("The compiled grammar is too large", 400 invalid_request; staging, 2026-10-17), so arrivals and
 * the Day-1 census ask for the JSON in a byte-stable, cached system block instead, parse it tolerantly, and let
 * validateHousehold (V01: one JSON object) and the retry loop with the validator's errors do what the grammar would have.
 */
import { modelOutputFormat } from "../modelSchema";
import { ArrivalHouseholdOutput } from "./card";

export const HOUSEHOLD_JSON_BLOCK = `REPLY FORMAT
Reply with one JSON object and nothing else: no code fence, no comment before or after. It must match this JSON Schema exactly (every property present, no others; null only where the schema allows it):
${JSON.stringify(modelOutputFormat(ArrivalHouseholdOutput).schema)}`;

/** The one JSON object in a model reply: tolerates a code fence or a stray line around it; undefined if there's none. */
export function parseJsonObject(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = (fenced ? fenced[1]! : text).trim();
  const start = body.indexOf("{"), end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return undefined; }
}
