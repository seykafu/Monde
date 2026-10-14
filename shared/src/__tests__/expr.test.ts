import { describe, expect, it } from "vitest";
import { evaluate, gameContext } from "../expr";

const ctx = gameContext({
  flags: new Set(["option_known", "vanes_coin"]),
  values: { day: 41, census: 205, regard: { pell: 35 }, pillar: { spirit: 60 }, player: { background: "homecomer" } },
});

describe("expr", () => {
  it.each([
    ["!flag.option_known", false],
    ["flag.option_known && !flag.option_public", true],
    ["!flag.clinic_open && day < 40", false],
    ["day >= 41 && census < 210", true],
    ["regard.pell >= 30 || flag.nope", true],
    ["player.background == 'homecomer'", true],
    ["pillar.spirit > 60", false],
    ["(flag.vanes_coin || flag.x) && !(day == 1)", true],
    ["", true],
    ["regard.unknown >= 0", false],
  ])("%s → %s", (src, want) => expect(evaluate(src, ctx)).toBe(want));

  it("rejects garbage instead of evaluating it", () => {
    expect(() => evaluate("flag.a; process.exit()", ctx)).toThrow();
    expect(() => evaluate("day <", ctx)).toThrow();
  });
});
