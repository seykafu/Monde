// AP progression rules: promotions grant +1 AP, and rank-and-file
// fielded deep into the campaign gain +1 AP through the difficulty
// layer — the two halves of "actions per turn scale with the war".

import { describe, it, expect } from "vitest";
import { applyDifficultyToEnemy } from "../Difficulty";
import { ENEMIES } from "./fixtures/enemies";

describe("late-campaign enemy AP", () => {
  it("rank-and-file gain +1 AP once fielded 8+ levels above reference", () => {
    // Royal Guard: reference L6, base 2 AP.
    const early = applyDifficultyToEnemy(ENEMIES.royalGuard("t1", 1, 10), "b07_monastery");
    expect(early.stats.ap, "L10 guard (4 above ref) stays at base AP").toBe(2);
    const late = applyDifficultyToEnemy(ENEMIES.royalGuard("t2", 2, 16), "b21_archbold_advances");
    expect(late.stats.ap, "L16 guard (10 above ref) gains the veteran AP").toBe(3);
  });

  it("bosses keep their authored AP (already 3 by design)", () => {
    const boss = applyDifficultyToEnemy(ENEMIES.imperialGeneral(18), "b20_dawn_war");
    expect(boss.stats.ap).toBe(3);
  });

  it("the Ravage line troops fight at 3 AP", () => {
    const trooper = applyDifficultyToEnemy(ENEMIES.ravageTrooper("t3", 3, 19), "b25_fleet_arrival");
    const lancer = applyDifficultyToEnemy(ENEMIES.ravageLancer("t4", 4, 19), "b25_fleet_arrival");
    const marksman = applyDifficultyToEnemy(ENEMIES.ravageMarksman("t5", 5, 19), "b25_fleet_arrival");
    expect(trooper.stats.ap).toBe(3);
    expect(lancer.stats.ap).toBe(3);
    expect(marksman.stats.ap, "marksmen stay at 2 — ranged tempo control").toBe(2);
  });
});
