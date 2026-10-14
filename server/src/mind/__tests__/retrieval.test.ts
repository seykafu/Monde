import { describe, expect, it } from "vitest";
import { ResidentState, type Memory } from "@monde/shared";
import { contentWords, isArchived, relevance, retrieveMemories, topicCards, type RetrievalContext } from "../retrieval.js";
import { applyTurnToState, memoryValence } from "../effects.js";
import { costUsd, formatUsd } from "../pricing.js";
import { weekdayOf } from "../context.js";

let n = 0;
const mem = (overrides: Partial<Memory> = {}): Memory => ({
  id: `m${n++}`, resident_id: "odile", day: 5, minute: 600, kind: "saw", text: "Somebody swept Market Row.",
  who: [], where: "market_row.bakery", importance: 5, valence: 0, ...overrides,
});

const ctx = (overrides: Partial<RetrievalContext> = {}): RetrievalContext => ({
  today: 5, who: new Set(["player"]), place: "market_row.bakery", terms: contentWords("tell me about the flour and the starter"), ...overrides,
});

describe("memory retrieval (§9.6)", () => {
  it("scores relevance from who, where, event tags and shared nouns", () => {
    expect(relevance({ memory: mem({ who: ["player"], text: "The Fellow bought flour for the starter." }), tags: ["trade"] }, ctx())).toBe((1 + 1 + 0 + 1) / 4);
    expect(relevance({ memory: mem({ where: "market_row.cafe_liss", text: "Quiet." }), tags: ["flour"] }, ctx())).toBe((0 + 0.5 + 1 + 0) / 4);
    expect(relevance({ memory: mem({ where: "wharf.ferry_slip", text: "Gulls." }), tags: [] }, ctx())).toBe(0);
  });

  it("ranks by 0.5·relevance + 0.3·importance/10 + 0.2·recency and keeps the top 8", () => {
    const old = mem({ day: 1, importance: 9, text: "The cannery fire, years back." });
    const fresh = mem({ day: 5, importance: 4, who: ["player"], text: "The Fellow asked about rye flour." });
    const filler = Array.from({ length: 10 }, (_, i) => mem({ day: 2, importance: 2, where: "commons.duck_pond", text: `Ducks ${i}.` }));
    const top = retrieveMemories([old, fresh, ...filler].map((memory) => ({ memory, tags: [] })), ctx());
    expect(top).toHaveLength(8);
    expect(top[0]).toBe(fresh);
    expect(top[1]).toBe(old);
  });

  it("never retrieves archived memories (importance < 3, older than 20 days)", () => {
    const stale = mem({ day: 1, importance: 2, who: ["player"], text: "rye flour rye flour" });
    expect(isArchived(stale, 30)).toBe(true);
    expect(isArchived(mem({ day: 1, importance: 3 }), 30)).toBe(false);
    expect(retrieveMemories([{ memory: stale, tags: [] }], ctx({ today: 30 }))).toEqual([]);
  });
});

describe("topic cards (§9.10)", () => {
  const base = {
    today: 5, place: "market_row.bakery", weather: "fog", activity: "work at market_row.bakery", recentTopics: [],
    memories: [], favors: [], dream: "Teach someone the starter.", events: [],
  };

  it("draws three cards of different kinds: recent memory, favor, event, dream", () => {
    const cards = topicCards({
      ...base,
      memories: [mem({ importance: 6, text: "The Tollmen kicked the bins over." }), mem({ importance: 3, text: "Too small to mention." })],
      favors: [{ text: "Bring me rye that isn't from Carrow." }],
      events: [{ summary: "Rook's crate fell in the harbor.", where: "wharf.fish_market", importance: 4 }],
    });
    expect(cards).toEqual(["The Tollmen kicked the bins over.", "your favor: Bring me rye that isn't from Carrow.", "Rook's crate fell in the harbor."]);
  });

  it("demotes what was already discussed, skips hidden dreams, and fills with the scene", () => {
    const input = {
      ...base, dream: "(hidden) Leave Monde.", memories: [mem({ importance: 8, text: "The bins again." })],
      events: [{ summary: "Rook's crate fell in the harbor.", where: "wharf.fish_market", importance: 6 }],
    };
    expect(topicCards(input)).toEqual(["The bins again.", "Rook's crate fell in the harbor.", "the weather: fog"]);
    expect(topicCards({ ...input, recentTopics: ["the bins"] })).toEqual(["Rook's crate fell in the harbor.", "The bins again.", "the weather: fog"]);
    expect(topicCards({ ...base, activity: null })).toEqual(["your dream: Teach someone the starter.", "the weather: fog"]);
  });
});

describe("turn effects on state", () => {
  const state = ResidentState.parse({
    id: "odile", world_id: "w", tier: "core",
    mood: { valence: 95, energy: 50, stress: 3, emotion: "content", intensity: 0 },
    needs: { rest: 70, food: 70, social: 70, purpose: 70, comfort: 70 },
    regard: 98, stances: {}, beliefs: [], recent_topics: Array.from({ length: 10 }, (_, i) => `t${i}`),
    dream: { stage: 0, notes: "" }, stay: 50, leaving_notice_since: null, location: null, flags: [],
  });
  const effects = { regard_delta: 5, mood: { valence: 10, stress: -10 }, memory: null, favor: null, reveal_secret: null, topic: "t3" };

  it("adds Regard and mood within their ranges and keeps the last 10 topics, newest last", () => {
    const next = applyTurnToState(state, effects);
    expect(next.regard).toBe(100);
    expect(next.mood).toMatchObject({ valence: 100, stress: 0 });
    expect(next.recent_topics).toEqual(["t0", "t1", "t2", "t4", "t5", "t6", "t7", "t8", "t9", "t3"]);
    expect(applyTurnToState(state, { ...effects, topic: "new" }).recent_topics).toEqual([...state.recent_topics.slice(1), "new"]);
    expect(applyTurnToState(state, { ...effects, topic: " " }).recent_topics).toEqual(state.recent_topics);
    expect(memoryValence(10)).toBe(5);
    expect(memoryValence(-3)).toBe(-2);
  });
});

describe("pricing and calendar", () => {
  it("prices a §9.15 dialogue turn at about $0.00025", () => {
    const cost = costUsd({ input: 1200, output: 180, cacheRead: 3800, cacheWrite: 0 });
    expect(cost).toBeCloseTo(0.000248, 9);
    expect(formatUsd(cost)).toBe("0.0002480000");
    expect(costUsd({ input: 0, output: 0, cacheRead: 0, cacheWrite: 1_000_000 })).toBeCloseTo(0.125, 9);
  });

  it("starts the year on a Tuesday", () => {
    expect([1, 2, 5, 6, 7, 8].map(weekdayOf)).toEqual(["Tue", "Wed", "Sat", "Sun", "Mon", "Tue"]);
  });
});
