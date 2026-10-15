/**
 * Levels of detail (GDD §9.8), recomputed at the start of every night pass:
 *   core        the canon residents (card kind "canon")
 *   acquainted  residents the player talked to in the last 14 days, or tied to a live Favor (as asker or as the
 *               resident it's about), at most 60, most recent first
 *   ambient     everyone else
 * Story beats and Projects (§9.8 also lists them) have no server-side state yet; they join when they do.
 */
import { and, eq, gt, gte, inArray, lte, max } from "drizzle-orm";
import { ResidentState, type PersonaCard } from "@monde/shared";
import { dialogueTurns, favors, residents } from "../db/schema.js";
import type { WorldDatabase } from "../worlds/createWorld.js";
import { LIVE_FAVOR_STATUSES } from "./context.js";

export type Tier = "core" | "acquainted" | "ambient";

/** §9.8: up to 60 Acquainted residents. */
export const ACQUAINTED_CAP = 60;
/** §9.8: talked to in the last 14 days (today and the 13 before it). */
export const ACQUAINTED_WINDOW_DAYS = 14;

export interface TierCandidate {
  id: string;
  kind: PersonaCard["kind"];
  /** The last day the player talked to them within the window, or null. */
  lastTalkDay: number | null;
  /** The newest live Favor they're tied to (its created day), or null. */
  favorDay: number | null;
}

export interface TierCounts { core: number; acquainted: number; ambient: number }

/** Pure tier assignment. Acquainted ties on recency break by id so the cap is deterministic. */
export function assignTiers(candidates: readonly TierCandidate[], cap = ACQUAINTED_CAP): Map<string, Tier> {
  const tiers = new Map<string, Tier>();
  const eligible: { id: string; recency: number }[] = [];
  for (const c of candidates) {
    if (c.kind === "canon") { tiers.set(c.id, "core"); continue; }
    const recency = Math.max(c.lastTalkDay ?? -Infinity, c.favorDay ?? -Infinity);
    if (recency > -Infinity) eligible.push({ id: c.id, recency });
    tiers.set(c.id, "ambient");
  }
  eligible.sort((a, b) => b.recency - a.recency || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const e of eligible.slice(0, cap)) tiers.set(e.id, "acquainted");
  return tiers;
}

export function countTiers(tiers: ReadonlyMap<string, Tier>): TierCounts {
  const counts: TierCounts = { core: 0, acquainted: 0, ambient: 0 };
  for (const tier of tiers.values()) counts[tier]++;
  return counts;
}

/** Load the inputs for `day`, assign tiers, and write the changed ones (the `tier` column and `state.tier`). */
export async function recomputeTiers(db: WorldDatabase, worldId: string, day: number): Promise<Map<string, Tier>> {
  const [rows, talks, liveFavors] = await Promise.all([
    db.select({ id: residents.id, card: residents.card, tier: residents.tier }).from(residents).where(eq(residents.worldId, worldId)),
    db.select({ residentId: dialogueTurns.residentId, last: max(dialogueTurns.day) }).from(dialogueTurns).where(and(
      eq(dialogueTurns.worldId, worldId), gt(dialogueTurns.day, day - ACQUAINTED_WINDOW_DAYS), lte(dialogueTurns.day, day),
    )).groupBy(dialogueTurns.residentId),
    db.select({ residentId: favors.residentId, target: favors.target, createdDay: favors.createdDay }).from(favors).where(and(
      eq(favors.worldId, worldId), inArray(favors.status, [...LIVE_FAVOR_STATUSES]), gte(favors.expiresDay, day),
    )),
  ]);
  const talked = new Map(talks.map((t) => [t.residentId, t.last]));
  const favorDay = new Map<string, number>();
  for (const f of liveFavors) {
    for (const id of [f.residentId, f.target]) favorDay.set(id, Math.max(favorDay.get(id) ?? -Infinity, f.createdDay));
  }
  const tiers = assignTiers(rows.map((r) => ({
    id: r.id, kind: r.card.kind, lastTalkDay: talked.get(r.id) ?? null, favorDay: favorDay.get(r.id) ?? null,
  })));

  const changed = rows.filter((r) => r.tier !== tiers.get(r.id));
  if (changed.length) {
    await db.transaction(async (tx) => {
      for (const r of changed) {
        const where = and(eq(residents.worldId, worldId), eq(residents.id, r.id));
        const [row] = await tx.select({ state: residents.state }).from(residents).where(where).for("update");
        if (!row) continue;
        const tier = tiers.get(r.id)!;
        await tx.update(residents).set({ tier, state: ResidentState.parse({ ...row.state, tier }), updatedAt: new Date() }).where(where);
      }
    });
  }
  return tiers;
}
