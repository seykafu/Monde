/**
 * Birthdays in the night pass (GDD §9.11.3 "Life events": every resident has one, a party if they have 3+ friends;
 * §9.11.2: gifts count double on the day, eventIngestion.ts; MVP G-12).
 *
 * Before tomorrow's plans are made, the night of Day N schedules a party for each resident whose birthday is Day N + 1
 * and who has 3+ friends (a pair's mean affinity ≥ 40): a `birthday_party` town event at their home at 18:00, host
 * first, then the guests. Tonight's plan prompts list it among tomorrow's events, the Lantern lists it in its notices
 * (with the day's "Many happy returns" line, press.ts), and on the day it is planned time together for the host and
 * each guest (ties.ts). Ids are deterministic, so a repeat schedules nothing new.
 */
import { eq } from "drizzle-orm";
import {
  BIRTHDAY_PARTY, areFriends, birthdaysOn, partyEventId, partySummary, throwsParty, type PersonaCard,
} from "@monde/shared";
import { events, relationships, residents } from "../db/schema.js";
import type { WorldDatabase } from "../worlds/createWorld.js";

/** The parties the night of `day` schedules for Day `day + 1`, as their host ids. */
export async function scheduleBirthdayParties(db: WorldDatabase, worldId: string, day: number): Promise<string[]> {
  const [rows, edges] = await Promise.all([
    db.select({ id: residents.id, card: residents.card }).from(residents).where(eq(residents.worldId, worldId)),
    db.select({ fromId: relationships.fromId, toId: relationships.toId, affinity: relationships.affinity })
      .from(relationships).where(eq(relationships.worldId, worldId)),
  ]);
  const cards = new Map<string, PersonaCard>(rows.map((r) => [r.id, r.card]));
  const hosts = birthdaysOn([...cards.values()], day + 1);
  if (!hosts.length) return [];
  const affinity = new Map(edges.map((e) => [`${e.fromId}>${e.toId}`, e.affinity]));
  const others = new Map<string, Set<string>>();
  for (const e of edges) {
    if (e.fromId === e.toId || !cards.has(e.fromId) || !cards.has(e.toId)) continue;
    for (const [self, other] of [[e.fromId, e.toId], [e.toId, e.fromId]] as const) {
      if (!others.has(self)) others.set(self, new Set());
      others.get(self)!.add(other);
    }
  }
  const parties = hosts.flatMap((host) => {
    const friends = [...(others.get(host.id) ?? [])]
      .filter((other) => areFriends(affinity.get(`${host.id}>${other}`), affinity.get(`${other}>${host.id}`))).sort();
    return throwsParty(friends.length) ? [{ host, friends }] : [];
  });
  if (!parties.length) return [];
  await db.insert(events).values(parties.map(({ host, friends }) => ({
    worldId, id: partyEventId(host.id, day + 1), day: day + 1, minute: BIRTHDAY_PARTY.minute, type: "birthday_party",
    wherePlace: host.home, who: [host.id, ...friends], importance: BIRTHDAY_PARTY.importance, tags: ["birthday", "party"],
    summary: partySummary(host.name),
  }))).onConflictDoNothing();
  return parties.map((p) => p.host.id);
}
