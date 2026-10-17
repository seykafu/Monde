// A-05: the portrait library's 120 identities (GDD §16.2, Appendix A.3.5): 40 masters and two colour variants each.
// Every row parses with the real schemas (PortraitEntry, CardHumanLook) and passes the content linter's look checks;
// a variant is its master with only the hair and clothing colours changed.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import data from "../../../content/portraits/library.json";
import {
  AGE_BANDS, BAND_AGES, PORTRAIT_LIBRARY, PortraitEntry, ROUTINE_PLACES, bandOf, cardLookProblems, templateHousehold, validateHousehold,
  type CardHumanLook, type HouseholdDraw,
} from "../index";

/** The real entry schema plus the variant fields, strict so a misspelt key fails. */
const Row = PortraitEntry.extend({
  variant_of: z.string().regex(/^lib_[fma]\d{2}_\d{3}$/).optional(),
  recolour: z.array(z.string().min(3)).min(2).optional(),
}).strict();
type Row = z.infer<typeof Row>;

const rows: Row[] = z.array(Row).parse((data as { portraits: unknown }).portraits);
const byId = new Map(rows.map(r => [r.id, r]));
const masters = rows.filter(r => !r.variant_of);
const variants = rows.filter(r => r.variant_of);
const num = (id: string): number => Number(id.slice(-3));

/** The look with its hair and clothing colours blanked: what a variant must share with its master. */
function shape(look: CardHumanLook): unknown {
  const { hair, outfit, accessory, headwear, ...rest } = look;
  return {
    ...rest,
    hair: { style: hair.style },
    outfit: { cut: outfit.cut, bottom_style: outfit.bottom_style, trim: outfit.trim === undefined ? "none" : "set" },
    accessory: { kind: accessory.kind, colour: accessory.colour === undefined ? "none" : "set" },
    headwear: headwear && { kind: headwear.kind, colour: headwear.colour === undefined ? "none" : "set" },
  };
}

describe("the portrait library rows (A-05)", () => {
  it("has 120 identities: 40 masters (001–040) then two variants each (041–120), ids unique", () => {
    expect(rows).toHaveLength(120);
    expect(PORTRAIT_LIBRARY).toHaveLength(120);
    expect(new Set(rows.map(r => r.id)).size).toBe(120);
    expect(rows.map(r => num(r.id))).toEqual(rows.map((_, i) => i + 1));
    expect(masters.map(r => num(r.id))).toEqual(masters.map((_, i) => i + 1));
    expect(masters).toHaveLength(40);
    expect(variants).toHaveLength(80);
  });

  it("never renames or reorders the original sixteen", () => {
    expect(rows.slice(0, 16).map(r => r.id)).toEqual([
      "lib_f05_001", "lib_m09_002", "lib_a15_003", "lib_f24_004", "lib_m26_005", "lib_f31_006", "lib_m33_007", "lib_a28_008",
      "lib_f42_009", "lib_m47_010", "lib_f51_011", "lib_m38_012", "lib_f68_013", "lib_m72_014", "lib_f76_015", "lib_m66_016",
    ]);
  });

  it("gives every row a look the rig can draw, an id that says its presentation and age, and the band of that age", () => {
    for (const r of rows) {
      expect(cardLookProblems({ kind: "arrival", look: r.look }), r.id).toEqual([]);
      expect(r.id.slice(4, 5), r.id).toBe(r.presentation);
      expect(Number(r.id.slice(5, 7)), r.id).toBe(r.age);
      expect(bandOf(r.age), r.id).toBe(r.band);
      expect(r.look.build, r.id).toBe({ slight: "narrow", average: "medium", broad: "broad" }[r.build]);
    }
  });

  it("makes each variant its master recoloured: same person, look, tags and face; new hair and clothes colours", () => {
    for (const [k, m] of masters.entries()) {
      const mine = variants.filter(v => v.variant_of === m.id);
      // Master nnn's variants are 039 + 2·nnn and 040 + 2·nnn.
      expect(mine.map(v => num(v.id)), m.id).toEqual([41 + 2 * k, 42 + 2 * k]);
      const hairs = new Set([m.look.hair.colour]);
      for (const v of mine) {
        expect(v.id.slice(0, 8), v.id).toBe(m.id.slice(0, 8));
        for (const key of ["band", "age", "presentation", "skin", "skin_word", "attire", "build"] as const)
          expect(v[key], `${v.id}.${key}`).toEqual(m[key]);
        expect(shape(v.look), v.id).toEqual(shape(m.look));
        hairs.add(v.look.hair.colour);
        expect(v.hair_word, v.id).not.toBe(m.hair_word);
        expect(v.caption, v.id).not.toBe(m.caption);
        expect(v.recolour?.[0], v.id).toMatch(/^hair: /);
        expect(m.recolour, m.id).toBeUndefined();
      }
      expect(hairs.size, `${m.id}: three different hair colours`).toBe(3);
    }
    for (const v of variants) expect(byId.get(v.variant_of!)?.variant_of, v.id).toBeUndefined();
  });

  it("writes captions the arrival validator accepts as a template appearance (A.3.7 V05, V06)", () => {
    const pronoun = { f: "she/her", m: "he/him", a: "they/them" } as const;
    const vctx = { places: new Set(ROUTINE_PLACES.map(p => p.id)), residents: new Map<string, { name: string }>() };
    for (const r of rows) {
      const draw: HouseholdDraw = {
        id: `t_${r.id}`, archetype: "retired_couple", day: 8, slot: 0, youth: false, beds: 1, prob: 0.1,
        members: [{
          slot: "m1", role: r.band === "child" || r.band === "teen" ? "child" : "adult", age_min: BAND_AGES[r.band][0],
          age_max: BAND_AGES[r.band][1], age: r.age, band: r.band, presentation: r.presentation, pronoun_default: pronoun[r.presentation],
          portrait: r.id,
        }],
      };
      const v = validateHousehold(templateHousehold(draw, vctx, 3), draw, vctx);
      expect(v.ok ? [] : v.errors.filter(e => /appearance/.test(e)), r.id).toEqual([]);
    }
  });

  it("has M-03's band mix of masters (Day-1 residents plus a fifth held back for arrivals), mixed presentations in each", () => {
    const mix = { child: 4, teen: 2, young_adult: 8, adult: 13, elder: 13 } as const;
    for (const band of AGE_BANDS) {
      const mine = masters.filter(r => r.band === band);
      expect(mine.length, band).toBe(mix[band]);
      const pres = new Set(mine.map(r => r.presentation));
      // Two teen masters can't hold all three presentations; every bigger band has both f and m.
      expect(mine.length >= 4 ? pres.has("f") && pres.has("m") : pres.size === mine.length, band).toBe(true);
    }
    // Adults and elders, the bulk of the town, span all six skin tones.
    for (const band of ["adult", "elder"] as const) expect(new Set(masters.filter(r => r.band === band).map(r => r.skin)).size, band).toBe(6);
  });
});
