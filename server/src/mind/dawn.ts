/**
 * The dawn package (GDD §9.7 step 3, §19.4 GET /v1/worlds/:w/dawn/:day; MVP M-07): what the client needs at
 * 06:00 to run the day. Plans for every resident (the night's model plan where there is one, else the routine
 * template computed here, exactly as the client would), the letters written last night (marked delivered as they
 * are read), the Favors proposed since yesterday, and the town's ties (G-13, §9.11.3): every pair of residents who
 * have met with their label and romance stage, plus the milestones of the night before (new Friends, Rivals…),
 * for the People page, emotes and the Dawn Report's lines. The Dawn Report itself, arrivals and departures come
 * with M-10 and G-02.
 */
import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { DawnTies, PlanOutput } from "@monde/shared";
import { favors, letters, plans, residents } from "../db/schema.js";
import type { WorldDatabase } from "../worlds/createWorld.js";
import { weekdayOf } from "./context.js";
import { templatePlan } from "./templatePlan.js";
import { buildDawnTies } from "./ties.js";

export interface DawnPlan {
  resident_id: string;
  tier: string;
  source: "model" | "template";
  plan: PlanOutput;
}

export interface DawnLetter { id: string; from: string; to: string; day: number; text: string }

export interface DawnFavor {
  id: string;
  resident_id: string;
  template: string;
  target: string;
  text: string;
  created_day: number;
  expires_day: number;
}

export interface DawnPackage {
  day: number;
  weekday: string;
  plans: DawnPlan[];
  letters: DawnLetter[];
  favors: DawnFavor[];
  ties: DawnTies;
}

const byId = <T extends { id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export async function buildDawnPackage(db: WorldDatabase, worldId: string, day: number): Promise<DawnPackage> {
  const [rows, stored, proposed, ties] = await Promise.all([
    db.select({ id: residents.id, card: residents.card, tier: residents.tier }).from(residents).where(eq(residents.worldId, worldId)),
    db.select().from(plans).where(and(eq(plans.worldId, worldId), eq(plans.day, day))),
    // New since yesterday: proposed last night (or during yesterday's conversations) and still open today.
    db.select().from(favors).where(and(
      eq(favors.worldId, worldId), eq(favors.status, "proposed"), eq(favors.createdDay, day - 1), gte(favors.expiresDay, day),
    )).orderBy(asc(favors.id)),
    buildDawnTies(db, worldId, day),
  ]);
  // One statement: a letter is handed over exactly once, even if two dawn requests race.
  const delivered = await db.update(letters).set({ delivered: true })
    .where(and(eq(letters.worldId, worldId), eq(letters.delivered, false), lte(letters.day, day)))
    .returning();

  const planFor = new Map(stored.map((p) => [p.residentId, p]));
  return {
    day,
    weekday: weekdayOf(day),
    plans: [...rows].sort(byId).map((r) => {
      const row = planFor.get(r.id);
      return row
        ? { resident_id: r.id, tier: r.tier, source: row.source, plan: row.plan }
        : { resident_id: r.id, tier: r.tier, source: "template" as const, plan: templatePlan(r.card, day) };
    }),
    letters: delivered.sort(byId).map((l) => ({ id: l.id, from: l.fromId, to: l.toId, day: l.day, text: l.text })),
    favors: proposed.map((f) => ({
      id: f.id, resident_id: f.residentId, template: f.template, target: f.target, text: f.text,
      created_day: f.createdDay, expires_day: f.expiresDay,
    })),
    ties,
  };
}
