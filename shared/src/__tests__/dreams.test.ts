import { describe, expect, it } from "vitest";
import {
  SaveGame, dreamFavor, dreamFavorId, dreamFavorRequest, dreamFavorStage, dreamRewardTag, dreamWords, emptyQuests, isHiddenDream,
  parseDreamStage, stageWords, type FavorWorld
} from "../index";

describe("dream stage conditions (A.2 / §12 conventions)", () => {
  it("reads Regard thresholds, for the dreamer and for someone named", () => {
    expect(parseDreamStage("Admit she needs help (Regard ≥ 30)")).toEqual({
      text: "Admit she needs help (Regard ≥ 30)", words: "Admit she needs help", clauses: [{ kind: "regard", min: 30, with: null }], fallback: false
    });
    expect(parseDreamStage("Admit she needs help (Regard ≥ 30 with player)").clauses).toEqual([{ kind: "regard", min: 30, with: null }]);
    expect(parseDreamStage("Get Kasimir to set a floor beam and widen the door (Regard ≥ 30 with Kasimir)").clauses)
      .toEqual([{ kind: "regard", min: 30, with: "Kasimir" }]);
    expect(parseDreamStage("Get him to talk about the books (Regard ≥ 40; he answers only while counting)").clauses)
      .toEqual([{ kind: "regard", min: 40, with: null }, { kind: "note", text: "he answers only while counting" }]);
  });

  it("reads Favors, flags, Projects, Scuffles and newcomers", () => {
    expect(parseDreamStage("Stand beside him at the back door on a Saturday (Favor: be there at eleven)").clauses).toEqual([{ kind: "favor", ask: "be there at eleven" }]);
    expect(parseDreamStage("Restock cuttings from the Community Garden (Favor)").clauses).toEqual([{ kind: "favor", ask: null }]);
    expect(parseDreamStage("Teach them the starter (a 3-day Favor chain; sets flag.odile_apprentice)").clauses)
      .toEqual([{ kind: "favor", ask: null }, { kind: "signal", flag: "odile_apprentice" }]);
    expect(parseDreamStage("Take the co-op job (needs flag.cannery_coop and Regard ≥ 30; he leaves the Tollmen the same day)").clauses)
      .toEqual([{ kind: "needs", flag: "cannery_coop" }, { kind: "regard", min: 30, with: null }, { kind: "note", text: "he leaves the Tollmen the same day" }]);
    expect(parseDreamStage("Ask him to run the floor (Regard ≥ 60, three fair Scuffles won; sets flag.rook_turned)").clauses)
      .toEqual([{ kind: "regard", min: 60, with: null }, { kind: "scuffles", won: 3 }, { kind: "signal", flag: "rook_turned" }]);
    expect(parseDreamStage("Get him to talk at the quarry (needs one fair Scuffle won; Regard ≥ 20)").clauses)
      .toEqual([{ kind: "scuffles", won: 1 }, { kind: "regard", min: 20, with: null }]);
    expect(parseDreamStage("Run the Gannet every day (Project ferry done; sets flag.project_ferry_done)").clauses)
      .toEqual([{ kind: "project", project: "ferry", done: true }, { kind: "signal", flag: "project_ferry_done" }]);
    expect(parseDreamStage("Find the engine parts (Project ferry; Favor: bring the chandler's crate off the Friday boat)").clauses)
      .toEqual([{ kind: "project", project: "ferry", done: false }, { kind: "favor", ask: "bring the chandler's crate off the Friday boat" }]);
    expect(parseDreamStage("Find an apprentice (an arrival with the 'baker' or 'cook' archetype)").clauses).toEqual([{ kind: "arrival", tags: ["baker", "cook"] }]);
    expect(parseDreamStage("Help her sort the Field Office invoices (Favor; leads to flag.ines_found_no_site on Day 33)").clauses)
      .toEqual([{ kind: "favor", ask: null }, { kind: "signal", flag: "ines_found_no_site" }]);
    expect(parseDreamStage("Open the first letter (Regard ≥ 55; sets flag.claudine_written when she answers it)").clauses)
      .toEqual([{ kind: "regard", min: 55, with: null }, { kind: "signal", flag: "claudine_written" }]);
  });

  it("keeps notes as notes, and marks a stage with nothing to check as a fallback", () => {
    const save = parseDreamStage("Save Maud's seat (Millbrook School reaches 20 pupils; sets flag.school_saved; with Regard ≥ 40 she quits the Tollmen)");
    expect(save.clauses).toEqual([{ kind: "note", text: "Millbrook School reaches 20 pupils" }, { kind: "signal", flag: "school_saved" },
      { kind: "note", text: "with Regard ≥ 40 she quits the Tollmen" }]);
    expect(save.fallback).toBe(false);
    const plain = parseDreamStage("Volunteer three shifts at the library desk.");
    expect(plain).toMatchObject({ words: "Volunteer three shifts at the library desk", clauses: [], fallback: true });
    expect(parseDreamStage("Offer her a post that isn't Vane's (the Lantern's second desk or the Town Clerk's office)").fallback).toBe(true);
  });

  it("strips the parenthetical for the words, and reads hidden dreams", () => {
    expect(stageWords("Hear the hour (sets flag.clock_running)")).toBe("Hear the hour");
    expect(stageWords("Plant it before the next Saturday market.")).toBe("Plant it before the next Saturday market");
    expect(isHiddenDream("(hidden) To close the till one Saturday.")).toBe(true);
    expect(isHiddenDream("To hear the clocktower strike the hour once more.")).toBe(false);
    expect(dreamWords("(hidden) To close the till one Saturday.")).toBe("To close the till one Saturday.");
  });
});

describe("a stage's Favor (§9.9)", () => {
  const world: FavorWorld = {
    day: 7, items: new Set(["bread"]), places: new Set(["market_row.general_store"]), reachablePlace: () => true, met: () => false,
    residents: new Map([["barney", { home: "market_row.general_store", reachable: true }], ["aline_barros", { home: "market_row.general_store", reachable: true }]])
  };

  it("has an id the server can rebuild, one per stage per five-day window", () => {
    expect(dreamFavorId("barney", 1, 7)).toBe("dream_barney_1_1");
    expect(dreamFavorId("barney", 1, 10)).toBe(dreamFavorId("barney", 1, 7));
    expect(dreamFavorId("barney", 1, 11)).toBe("dream_barney_1_2");
    expect(dreamFavorStage("barney", "dream_barney_1_2")).toBe(1);
    expect(dreamFavorStage("aline_barros", dreamFavorId("aline_barros", 2, 3))).toBe(2);
    expect(dreamFavorStage("barney", "dream_aline_barros_2_0")).toBeNull();
    expect(dreamFavorStage("barney", "quiet_chore_barney_1")).toBeNull();
  });

  it("is the engine's half-hour chore at the resident's place, tagged with its stage, in the resident's voice", () => {
    const request = dreamFavorRequest({ id: "barney" }, 1);
    expect(request).toMatchObject({ template: "help_chore", target: "barney" });
    expect(request.text).not.toMatch(/\bhim\b|\bher\b/);
    const f = dreamFavor({ id: "barney" }, 1, 7, world)!;
    expect(f).toMatchObject({ id: "dream_barney_1_1", resident_id: "barney", status: "proposed", task: { kind: "chore", place: "market_row.general_store", minutes: 30 } });
    expect(f.reward).toMatchObject({ regard: 10, dream: dreamRewardTag("barney", 1) });
    expect(dreamFavor({ id: "nobody" }, 0, 7, world)).toBeNull();
  });
});

it("an old save without the Quests reads with none known", () => {
  const shape = SaveGame.shape.quests;
  expect(shape.parse(undefined)).toEqual(emptyQuests());
});
