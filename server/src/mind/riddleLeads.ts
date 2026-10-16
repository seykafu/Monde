/**
 * Riddle lead-ins (GDD §14.2 AI hint guard; MVP Q-01): the short authored line, in the resident's own voice, that
 * comes before the authored hint on a riddle-topic turn ("(Taps the plate.) All I'll give you is this: <hint>").
 * Authored in content/lines/riddle_leads.yaml; a lead-in never holds riddle content (see that file's rules and
 * the tests). Read once, synchronously, the first time a riddle turn needs one.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { z } from "zod";
import { replyHash } from "@monde/shared";

const Pool = z.object({ give: z.array(z.string().min(1)).min(1), again: z.array(z.string().min(1)).min(1) });
export const RiddleLeadLibrary = z.object({
  leads: z.record(z.string(), Pool).refine((leads) => Object.hasOwn(leads, "default"), "leads needs a default pool"),
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
  /** The resident's lines so far in this conversation: a lead-in already used isn't used again. */
  said?: readonly string[];
}

/** The resident's lead-in for this riddle turn, chosen deterministically, preferring one not yet said. */
export function riddleLeadIn(args: LeadInArgs, library = loadRiddleLeads()): string {
  const pools = Object.hasOwn(library.leads, args.residentId) ? library.leads[args.residentId]! : library.leads.default!;
  const pool = args.again ? pools.again : pools.give;
  const start = replyHash(`${args.residentId}|${args.riddleId}|${args.turnIndex}`) % pool.length;
  const said = (args.said ?? []).map((line) => line.trim());
  for (let i = 0; i < pool.length; i++) {
    const lead = pool[(start + i) % pool.length]!.trim();
    if (!said.some((line) => line.startsWith(lead))) return lead;
  }
  return pool[start]!.trim();
}
