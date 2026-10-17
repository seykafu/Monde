import { z } from "zod";
import { ResidentId } from "./ids";

// Report (GDD §9.13: "a Report line button on every generated line flags it to the review queue and swaps in a
// fallback immediately"): POST /v1/worlds/:w/reports. The client names the item; the server copies its own stored
// text into the review queue and never trusts client-supplied text, except for `other`, which has no stored copy.

export const REPORT_KINDS = ["dialogue", "press", "letter", "other"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

const reason = z.string().trim().min(1).max(500);

/** A dialogue turn (the dialogue panel's Report line, a story's {ai_line}). A body without `kind` is one of these. */
export const DialogueReport = z.object({
  kind: z.literal("dialogue"), conversation_id: z.uuid(), turn_index: z.number().int().nonnegative(), reason,
});
/**
 * A model-written item of the Lantern (§9.12): `story` is the story's index in the server's stored edition for `day`,
 * or "front" for the headline and dek. `event_id`, when sent, must match the stored story's (a stale index is refused).
 */
export const PressReport = z.object({
  kind: z.literal("press"), day: z.number().int().positive(),
  story: z.union([z.literal("front"), z.number().int().min(0).max(2)]),
  event_id: z.string().max(200).nullable().optional(), reason,
});
/** A letter written by a resident's reflection (§9.7), by its id. */
export const LetterReport = z.object({ kind: z.literal("letter"), letter_id: z.string().min(1).max(200), reason });
/** Anything else: there is no stored copy, so the client's text is kept as it was sent (marked unverified). */
export const OtherReport = z.object({
  kind: z.literal("other"), ref: z.string().trim().min(1).max(200), text: z.string().trim().min(1).max(2000),
  resident_id: ResidentId.optional(), reason,
});
export const ReportBody = z.discriminatedUnion("kind", [DialogueReport, PressReport, LetterReport, OtherReport]);
export type ReportBody = z.infer<typeof ReportBody>;

/** Parse a report body; one without `kind` is a dialogue report (the original contract, unchanged). */
export function parseReportBody(raw: unknown): ReportBody | null {
  const body = raw && typeof raw === "object" && !Array.isArray(raw) && !("kind" in raw) ? { ...raw, kind: "dialogue" } : raw;
  const parsed = ReportBody.safeParse(body);
  return parsed.success ? parsed.data : null;
}

/**
 * Letters come only from the night's reflections (server reflect.ts `letterId`: `letter_<resident>_<day>`), which
 * the model writes; the rule fallback writes none. Any other id (an authored letter) isn't reportable.
 */
const REFLECTION_LETTER = /^letter_[a-z][a-z0-9_]*_\d+$/;
export const isGeneratedLetterId = (id: string): boolean => REFLECTION_LETTER.test(id);
