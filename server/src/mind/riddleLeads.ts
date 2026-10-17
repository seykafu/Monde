/**
 * Riddle lead-ins (GDD §14.2 AI hint guard; MVP Q-01): the short authored line, in the resident's own voice, that
 * comes before the authored hint on a riddle-topic turn ("(Taps the plate.) All I'll give you is this: <hint>").
 * Authored in content/lines/riddle_leads.yaml; a lead-in never holds riddle content (see that file's rules and
 * the tests). Read once, synchronously, the first time a riddle turn needs one.
 *
 * The same file holds each hint's authored retelling (`retold`): the same hint, at the same level, in other words.
 * Asked again in one conversation, the resident switches between the two (`riddleHintText`), so the Fellow never
 * hears the identical sentence twice in a row. A first ask that trails off ("About the plaque on my door…", which
 * is how the client words every Mark reply) takes a `trail` lead-in that picks up the unfinished sentence.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { z } from "zod";
import { replyHash } from "@monde/shared";

const Lines = z.array(z.string().min(1)).min(1);
const Pool = z.object({ give: Lines, again: Lines, trail: Lines.optional() });
/** A retelling for each of a riddle's three hint levels; null where the hint is never served (absent or unsafe). */
const Retold = z.tuple([z.string().min(1).nullable(), z.string().min(1).nullable(), z.string().min(1).nullable()]);
export const RiddleLeadLibrary = z.object({
  leads: z.record(z.string(), Pool).refine((leads) => Object.hasOwn(leads, "default"), "leads needs a default pool"),
  retold: z.record(z.string(), Retold).default({}),
});
export type RiddleLeadLibrary = z.infer<typeof RiddleLeadLibrary>;

// Source modules live in src/mind; the bundle lives directly in dist (same layout as loadContent.ts).
const defaultContent = fileURLToPath(new URL(
  import.meta.url.includes("/src/") ? "../../../content/" : "../../content/", import.meta.url,
));

const cache = new Map<string, RiddleLeadLibrary>();
export function loadRiddleLeads(directory = process.env.MONDE_CONTENT_DIR ?? defaultContent): RiddleLeadLibrary {
  const root = resolve(directory);
  let library = cache.get(root);
  if (!library) {
    const path = join(root, "lines", "riddle_leads.yaml");
    const parsed = RiddleLeadLibrary.safeParse(parse(readFileSync(path, "utf8")));
    if (!parsed.success) throw new Error(`Invalid ${path}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    library = parsed.data;
    cache.set(root, library);
  }
  return library;
}

export interface LeadInArgs {
  residentId: string;
  riddleId: string;
  /** 0-based exchange number in the conversation. */
  turnIndex: number;
  /** The same hint was already given in this conversation. */
  again: boolean;
  /** The Fellow's line trailed off ("About the plaque on my door…"): a first ask takes a `trail` lead-in. */
  trailing?: boolean;
  /** The resident's lines so far in this conversation: a lead-in already used isn't used again. */
  said?: readonly string[];
}

/** The Fellow's words end unfinished: an ellipsis or a dash. */
export function trailsOff(text: string | null | undefined): boolean {
  return /(?:…|\.{2,}|[-–—])\s*$/.test(text?.trim() ?? "");
}

/** The resident's lead-in for this riddle turn, chosen deterministically, preferring one not yet said. */
export function riddleLeadIn(args: LeadInArgs, library = loadRiddleLeads()): string {
  const pools = Object.hasOwn(library.leads, args.residentId) ? library.leads[args.residentId]! : library.leads.default!;
  const pool = args.again ? pools.again : args.trailing && pools.trail ? pools.trail : pools.give;
  const start = replyHash(`${args.residentId}|${args.riddleId}|${args.turnIndex}`) % pool.length;
  const said = (args.said ?? []).map((line) => line.trim());
  for (let i = 0; i < pool.length; i++) {
    const lead = pool[(start + i) % pool.length]!.trim();
    if (!said.some((line) => line.startsWith(lead))) return lead;
  }
  return pool[start]!.trim();
}

export interface HintTextArgs {
  riddleId: string;
  /** 0-based hint level of `hint` in the riddle's ladder. */
  level: number;
  /** The authored hint being served (fallback.ts authoredHint). */
  hint: string;
  /** The resident's lines so far in this conversation. */
  said: readonly string[];
  /** Whether this resident could say a wording (fallback.ts speakable); a wording they couldn't is used only as a last resort. */
  speakable?: (text: string) => boolean;
}

/**
 * Which wording of the hint to give: the authored hint, or its retelling once the Fellow asks again (never the
 * sentence the resident said last). `again` is true when either wording was already given in this conversation.
 */
export function riddleHintText(args: HintTextArgs, library = loadRiddleLeads()): { text: string; again: boolean } {
  const retold = Object.hasOwn(library.retold, args.riddleId) ? library.retold[args.riddleId]![args.level] ?? null : null;
  const wordings = retold ? [args.hint, retold] : [args.hint];
  const last = [...args.said].reverse().map((line) => wordings.find((w) => line.includes(w))).find((w) => w !== undefined);
  const ok = args.speakable ?? (() => true);
  const order = last === undefined ? wordings : [...wordings.filter((w) => w !== last), last];
  return { text: order.find(ok) ?? order[0]!, again: last !== undefined };
}
