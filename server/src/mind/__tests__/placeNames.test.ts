// Playtest 2026-10-20: Sander said "I'm headed for market_row.market_street". The client describes a resident's
// activity with place ids and the prompt passed them on; the dialogue prompt now names every place, and a line that
// still carries an id is repaired.
import { beforeAll, describe, expect, it } from "vitest";
import { ResidentState, type PersonaCard } from "@monde/shared";
import { loadContent } from "../../content/loadContent.js";
import { buildDialogueRequest, type DialogueInput, type MindRequest } from "../promptBuilder.js";
import { loadPlaceNames } from "../placeNames.js";
import { repairDialogueLine, type ValidationContext } from "../validate.js";

let cards: PersonaCard[];
beforeAll(async () => { cards = await loadContent(); await loadPlaceNames(); });
const card = (id: string) => cards.find((c) => c.id === id)!;
const PLACE_ID = /\b(?:old_quarter|market_row|wharf|commons|millbrook|station_hill|briar_woods|offmap)\.[a-z0-9_]+\b/;

function input(c: PersonaCard, overrides: Partial<DialogueInput> = {}): DialogueInput {
  return {
    card: c, flags: [], relationships: c.relationships,
    state: ResidentState.parse({
      id: c.id, world_id: "w", tier: "core", mood: { valence: 0, energy: 50, stress: 0, emotion: "content", intensity: 0 },
      needs: { rest: 70, food: 70, social: 70, purpose: 70, comfort: 70 }, regard: 0, stances: {}, beliefs: c.beliefs,
      recent_topics: [], dream: { stage: 0, notes: "" }, stay: 50, leaving_notice_since: null, location: null, flags: [],
    }),
    scene: { day: 3, weekday: "Wed", minute: 10 * 60, place: "market_row.market_street", weather: "rain" },
    doing: "walking to market_row.market_street",
    player: { name: "Sarim", pronouns: "they/them", background: "Tinkerer" },
    memories: [], topics: ["the rain on wharf.ferry_slip"], playerSaid: "Morning!",
    ...overrides,
  };
}
const text = (req: MindRequest) => [...req.system.map((b) => b.text), ...req.messages.map((m) => typeof m.content === "string" ? m.content : JSON.stringify(m.content))].join("\n");

describe("the dialogue prompt names places", () => {
  it("never shows a place id: the scene, what the resident is doing, the topics, their home and work", () => {
    const req = buildDialogueRequest(input(card("odile")));
    const all = text(req);
    expect(all).not.toMatch(PLACE_ID);
    expect(all).toContain("walking to Market Street");
    expect(req.system.map((b) => b.text).join("\n")).toContain("Work: Fournier & Fille");
  });
  it("repairs a line that still says one", () => {
    const ctx = { card: card("odile") } as unknown as ValidationContext;
    const adjustments: string[] = [];
    expect(repairDialogueLine("I'm headed for market_row.market_street before the rain thickens.", ctx, adjustments))
      .toBe("I'm headed for Market Street before the rain thickens.");
    expect(adjustments).toContain("place id named");
  });
});
