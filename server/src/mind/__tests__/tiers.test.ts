import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { createTestDatabase } from "../../db/testDatabase.js";
import { dialogueTurns, favors, residents } from "../../db/schema.js";
import { createWorld } from "../../worlds/createWorld.js";
import { ACQUAINTED_CAP, assignTiers, countTiers, recomputeTiers, type TierCandidate } from "../tiers.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => { database = await createTestDatabase(); }, 30_000);
afterAll(async () => { await database?.client.close(); });

describe("assignTiers", () => {
  it("puts canon cards in Core, recent talk or a live favor in Acquainted, and everyone else in Ambient", () => {
    const tiers = assignTiers([
      { id: "pell", kind: "canon", lastTalkDay: null, favorDay: null },
      { id: "ada", kind: "resident", lastTalkDay: 9, favorDay: null },
      { id: "moss", kind: "resident", lastTalkDay: null, favorDay: 8 },
      { id: "bru", kind: "resident", lastTalkDay: null, favorDay: null },
      { id: "bastien", kind: "animal", lastTalkDay: 10, favorDay: null },
    ]);
    expect(Object.fromEntries(tiers)).toEqual({ pell: "core", ada: "acquainted", moss: "acquainted", bru: "ambient", bastien: "acquainted" });
    expect(countTiers(tiers)).toEqual({ core: 1, acquainted: 3, ambient: 1 });
  });

  it("caps Acquainted at 60, most recent first, ties by id", () => {
    const candidates: TierCandidate[] = Array.from({ length: 70 }, (_, i) => ({
      id: `r${String(i).padStart(2, "0")}`, kind: "resident", lastTalkDay: Math.floor(i / 2), favorDay: null,
    }));
    const tiers = assignTiers(candidates);
    expect(ACQUAINTED_CAP).toBe(60);
    expect(countTiers(tiers)).toEqual({ core: 0, acquainted: 60, ambient: 10 });
    // The ten oldest (days 0-4) drop to Ambient.
    expect([...tiers].filter(([, tier]) => tier === "ambient").map(([id]) => id)).toEqual(
      ["r00", "r01", "r02", "r03", "r04", "r05", "r06", "r07", "r08", "r09"],
    );
  });
});

describe("recomputeTiers", () => {
  it("reads the last 14 days of talk and live favors, and writes the tier column and state", async () => {
    const world = await createWorld(database.db, `device-${randomUUID()}`, "invite");
    const turn = (residentId: string, day: number) => ({
      worldId: world.id, id: `${randomUUID()}/0`, residentId, conversationId: randomUUID(), day, minute: 600,
      playerInput: null, output: { lines: [{ text: "Hm.", expr: "neutral" }], choices: [], effects: { regard_delta: 0, mood: { valence: 0, stress: 0 }, memory: null, favor: null, reveal_secret: null, topic: "" }, wrap_up: false },
      fallback: true, turnIndex: 0,
    });
    await database.db.insert(dialogueTurns).values([turn("ada", 10), turn("bru", 2)]);
    const favor = (id: string, residentId: string, target: string, status: string, expiresDay: number) => ({
      worldId: world.id, id, residentId, template: "introduce", target, text: "x", status, createdDay: 14, expiresDay, reward: {},
    });
    await database.db.insert(favors).values([
      favor("live", "nettie", "moss", "proposed", 18),
      favor("expired", "bastien", "pell", "open", 15),
      favor("done", "bastien", "pell", "completed", 20),
    ]);

    const tiers = await recomputeTiers(database.db, world.id, 16);
    expect(tiers.get("pell")).toBe("core");
    expect(tiers.get("vane")).toBe("core");
    expect(tiers.get("ada")).toBe("acquainted");
    expect(tiers.get("nettie")).toBe("acquainted");
    expect(tiers.get("moss")).toBe("acquainted");
    expect(tiers.get("bru")).toBe("ambient");
    expect(tiers.get("bastien")).toBe("ambient");

    const rows = await database.db.select().from(residents).where(eq(residents.worldId, world.id));
    for (const row of rows) {
      expect(row.tier).toBe(tiers.get(row.id));
      expect(row.state.tier).toBe(tiers.get(row.id));
    }
    // Two weeks later nobody has talked to Ada and the favor has lapsed.
    const later = await recomputeTiers(database.db, world.id, 24);
    expect(later.get("ada")).toBe("ambient");
    expect(later.get("nettie")).toBe("ambient");
    const [ada] = await database.db.select().from(residents).where(and(eq(residents.worldId, world.id), eq(residents.id, "ada")));
    expect(ada).toMatchObject({ tier: "ambient", state: { tier: "ambient" } });
  });
});
