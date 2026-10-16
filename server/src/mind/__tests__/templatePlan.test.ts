import { beforeAll, describe, expect, it } from "vitest";
import { PlanOutput, type PersonaCard } from "@monde/shared";
import { loadContent } from "../../content/loadContent.js";
import { weekdayOf } from "../context.js";
import { hhmmToMinutes, isWeekend, minutesToHhmm, overnight, planVerb, routineBlocks, templatePlan, withoutMinutes } from "../templatePlan.js";
// The client's routine executor builds the same template days (MVP W-05). The two must agree block for block.
import { dayPlan } from "../../../../client/src/sim/plans.js";
import { weekdayOf as clientWeekdayOf } from "../../../../client/src/sim/clock.js";

let cards: PersonaCard[];
const card = (id: string): PersonaCard => cards.find((c) => c.id === id)!;
beforeAll(async () => { cards = await loadContent(); });

const brief = (plan: PlanOutput) => plan.blocks.map((b) => `${b.start}-${b.end} ${b.action}@${b.place}`);

describe("template plans", () => {
  it("Day 1 is a Tuesday; Saturday and Sunday use the weekend routine", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(weekdayOf)).toEqual(["Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Mon", "Tue"]);
    expect([1, 2, 3, 4, 5, 6, 7].map(isWeekend)).toEqual([false, false, false, false, true, true, false]);
  });

  it("turns Odile's weekday routine into contiguous blocks, from her 04:00 ovens to 26:00", () => {
    expect(brief({ blocks: withoutMinutes(routineBlocks(card("odile"), 1)) } as PlanOutput)).toEqual([
      "04:00-09:00 work@market_row.bakery",
      "09:00-13:00 clean@market_row.bakery",
      "13:00-14:00 eat@market_row.bakery_flat",
      "14:00-16:00 nap@market_row.bakery_flat",
      "16:00-18:00 shop@market_row.general_store",
      "18:00-21:00 socialize@market_row.gull_and_anchor",
      "21:00-26:00 sleep@market_row.bakery_flat",
    ]);
    // The template adds Tuesday's late-afternoon stop at the market (shared/src/gathering.ts).
    const plan = templatePlan(card("odile"), 1);
    expect(PlanOutput.parse(plan)).toEqual(plan);
    expect(brief(plan)).toEqual([
      "04:00-09:00 work@market_row.bakery",
      "09:00-13:00 clean@market_row.bakery",
      "13:00-14:00 eat@market_row.bakery_flat",
      "14:00-16:00 nap@market_row.bakery_flat",
      "16:00-16:45 shop@market_row.general_store",
      "16:45-17:20 socialize@market_row.market_street",
      "17:20-18:00 shop@market_row.general_store",
      "18:00-21:00 socialize@market_row.gull_and_anchor",
      "21:00-26:00 sleep@market_row.bakery_flat",
    ]);
    plan.blocks.slice(1).forEach((b, i) => expect(b.start).toBe(plan.blocks[i]!.end));
    expect(plan).toMatchObject({ whim: null, barks: [], seek_player: null, intentions: [] });
    expect(plan.blocks.every((b) => b.note === "" && Array.isArray(b.with))).toBe(true);
  });

  it("uses the weekend routine on a Saturday (Day 5)", () => {
    expect(brief(templatePlan(card("odile"), 5))).toEqual([
      "04:00-09:30 work@market_row.bakery",
      "09:30-12:00 attend@old_quarter.st_brigids",
      "12:00-13:00 eat@market_row.bakery_flat",
      "13:00-15:00 nap@market_row.bakery_flat",
      "15:00-18:00 visit@millbrook.mercer_house",
      "18:00-21:00 socialize@market_row.gull_and_anchor",
      "21:00-26:00 sleep@market_row.bakery_flat",
    ]);
    const bare = (day: number) => withoutMinutes(routineBlocks(card("odile"), day));
    expect(bare(6)).toEqual(bare(5));
    expect(bare(7)).toEqual(bare(1));
    // Sunday's lunch is on the market bench instead of upstairs (that weekday's stop).
    expect(brief(templatePlan(card("odile"), 6))[2]).toBe("12:00-13:00 eat@market_row.market_street");
  });

  it("keeps hours past midnight as 24:00-26:00", () => {
    const sable = templatePlan(card("sable"), 2).blocks;
    expect(sable.at(-1)).toMatchObject({ start: "25:00", end: "26:00", action: "sleep" });
    expect(hhmmToMinutes("25:30")).toBe(1530);
    expect(minutesToHhmm(1530)).toBe("25:30");
    expect(() => hhmmToMinutes("26:30")).toThrow();
  });

  it("knows where the resident spent the night: yesterday's last block", () => {
    expect(overnight(card("odile"), 1)).toEqual({ action: "sleep", place: "market_row.bakery_flat" });
    expect(routineBlocks(card("odile"), 1)[0]).toMatchObject({ startMin: 240, endMin: 540 });
  });

  it("maps Bastien's follow and beg onto plan verbs", () => {
    expect(planVerb("follow")).toBe("wander");
    expect(planVerb("beg")).toBe("sit");
    expect(planVerb("garden")).toBe("garden");
  });

  it("stops a district's residents at its gathering place together, never animals or anyone out of town", () => {
    // Tuesday 16:45: Odile and Nell both step out to Market Street (the pump, by the zone's social spots).
    const at = (id: string, day: number, start: string) => templatePlan(card(id), day).blocks.find((b) => b.start === start);
    expect(at("odile", 1, "16:45")).toMatchObject({ action: "socialize", place: "market_row.market_street", end: "17:20", with: [] });
    expect(at("nell", 1, "16:45")).toMatchObject({ action: "socialize", place: "market_row.market_street", end: "17:20" });
    // A stop doesn't interrupt a service, a nap or company: Odile's Saturday is her routine as written.
    expect(brief(templatePlan(card("odile"), 5))).toEqual(brief({ blocks: withoutMinutes(routineBlocks(card("odile"), 5)) } as PlanOutput));
    for (let day = 1; day <= 7; day++) {
      expect(templatePlan(card("bastien"), day)).toEqual({ ...templatePlan(card("bastien"), day), blocks: withoutMinutes(routineBlocks(card("bastien"), day)) });
      expect(brief(templatePlan(card("felix"), day))).toEqual(brief({ blocks: withoutMinutes(routineBlocks(card("felix"), day)) } as PlanOutput));
      // Habits by weekday: the same day of the week gives the same stops.
      for (const c of cards) expect(templatePlan(c, day + 7), c.id).toEqual(templatePlan(c, day));
    }
  });

  it("matches the client's routine executor for every resident on every weekday", () => {
    for (const c of cards) {
      for (let day = 1; day <= 7; day++) {
        expect(clientWeekdayOf(day)).toBe(weekdayOf(day));
        const client = dayPlan(c, clientWeekdayOf(day)).blocks.map(({ start, end, action, place, with: w, note }) => ({ start, end, action, place, with: w, note }));
        expect(templatePlan(c, day).blocks, `${c.id} day ${day}`).toEqual(client);
      }
    }
  });
});
