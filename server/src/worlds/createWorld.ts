import { randomInt, randomUUID } from "node:crypto";
import { ResidentState, type PersonaCard } from "@monde/shared";
import type { createDatabase } from "../db/client.js";
import type { createTestDatabase } from "../db/testDatabase.js";
import { devices, worlds, residents, relationships } from "../db/schema.js";
import { loadContent } from "../content/loadContent.js";

export type WorldDatabase = NonNullable<ReturnType<typeof createDatabase>>["db"] | Awaited<ReturnType<typeof createTestDatabase>>["db"];
export function initialState(card: PersonaCard, worldId: string): ResidentState {
  return ResidentState.parse({
    id: card.id, world_id: worldId, tier: card.kind === "canon" ? "core" : "ambient",
    // GDD-GAP: exact Day-1 mood numbers are unspecified; neutral defaults until simulation runs.
    mood: { valence: 0, energy: 50, stress: 0, emotion: "content", intensity: 0 },
    needs: { rest: 70, food: 70, social: 70, purpose: 70, comfort: 70 },
    regard: 0, stances: {}, beliefs: card.beliefs, recent_topics: [],
    dream: { stage: 0, notes: "" }, stay: 50, leaving_notice_since: null,
    location: card.routine.weekday[0]!.where, flags: [],
  });
}
export async function createWorld(db: WorldDatabase, deviceId: string, inviteCode: string, contentDirectory?: string) {
  const cards = await loadContent(contentDirectory);
  const worldId = randomUUID();
  return db.transaction(async (tx) => {
    await tx.insert(devices).values({ id: deviceId, inviteCode })
      .onConflictDoUpdate({ target: devices.id, set: { lastSeenAt: new Date() } });
    const [world] = await tx.insert(worlds).values({
      id: worldId, deviceId, seed: randomInt(0, 2147483647), branchId: randomUUID(),
      status: "active", aiSpendDay: 1,
    }).returning();
    await tx.insert(residents).values(cards.map((card) => {
      const state = initialState(card, worldId);
      return { worldId, id: card.id, card, state, tier: state.tier };
    }));
    const rows = cards.flatMap((card) => card.relationships.map(({ id, ...relationship }) => ({
      worldId, fromId: card.id, toId: id, ...relationship,
    })));
    if (rows.length) await tx.insert(relationships).values(rows);
    return world!;
  });
}
