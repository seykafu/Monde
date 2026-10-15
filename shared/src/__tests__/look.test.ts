import { describe, expect, it } from "vitest";
import {
  CLOTH_COLOURS, CardLook, CharacterLookData, EYE_COLOURS, HAIR_COLOURS, PersonaCard, SKIN_TONES, cardLookProblems, swatchColour
} from "../index";

const human = {
  kind: "human", skin: 8, hair: { style: "cropped", colour: 3 }, eyes: 0, build: "narrow", height: "short",
  outfit: { cut: "jumper", top: 4, bottom: 15, bottom_style: "shorts", shoes: 2 }, accessory: { kind: "none" },
  face: { cowlick: true }
};
const cat = { kind: "cat", fur: "#d98a3d", markings: "#a8592a", bib: "#f4ecdc", eyes: "#9bbf4a" };

describe("the palettes", () => {
  it("keep §11.1's and §16.5's sizes (cards and the Fellowship form index them)", () => {
    expect([SKIN_TONES.length, HAIR_COLOURS.length, EYE_COLOURS.length, CLOTH_COLOURS.length]).toEqual([10, 12, 8, 16]);
  });
});

describe("a card's look", () => {
  it("parses a human and a cat look", () => {
    expect(CardLook.parse(human)).toEqual(human);
    expect(CardLook.parse(cat)).toEqual(cat);
    const capped = { ...human, glasses: "on_head", headwear: { kind: "peaked_cap", colour: "#2f3d5c" }, outfit: { ...human.outfit, trim: 9 } };
    expect(CardLook.parse(capped)).toEqual(capped);
  });

  it("takes a palette index or a quoted #rrggbb for every colour, and names the palette when an index is out of range", () => {
    const bad = CardLook.safeParse({ ...human, skin: 10 });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toMatch(/SKIN_TONES index 10 is out of range \(0–9\)/);
    expect(CardLook.safeParse({ ...human, eyes: 8 }).success).toBe(false);
    expect(CardLook.safeParse({ ...human, outfit: { ...human.outfit, top: 16 } }).success).toBe(false);
    expect(CardLook.safeParse({ ...human, hair: { style: "bob", colour: "c9cdd4" } }).success).toBe(false);
    expect(CardLook.safeParse({ ...human, hair: { style: "bob", colour: "#c9cdd4" } }).success).toBe(true);
    expect(CardLook.safeParse({ ...human, skin: 1.5 }).success).toBe(false);
  });

  it("is strict: unknown keys, styles and caps are errors", () => {
    expect(CardLook.safeParse({ ...human, hat: "cap" }).success).toBe(false);
    expect(CardLook.safeParse({ ...human, face: { beard: true } }).success).toBe(false);
    expect(CardLook.safeParse({ ...human, headwear: { kind: "bowler" } }).success).toBe(false);
    expect(CardLook.safeParse({ ...human, glasses: "monocle" }).success).toBe(false);
    expect(CardLook.safeParse({ ...cat, collar: 3, stripes: true }).success).toBe(false);
  });

  it("resolves swatches to colours", () => {
    expect(swatchColour(8, SKIN_TONES)).toBe(0x6e4430);
    expect(swatchColour("#C9CDD4", HAIR_COLOURS)).toBe(0xc9cdd4);
    expect(swatchColour(0, CLOTH_COLOURS)).toBe(CLOTH_COLOURS[0]);
  });

  it("is optional on a persona card", () => {
    const shape = PersonaCard.shape.look;
    expect(shape.safeParse(undefined).success).toBe(true);
    expect(shape.safeParse(human).success).toBe(true);
  });
});

describe("the content linter's cross-checks", () => {
  const look = (extra: object) => CardLook.parse({ ...human, ...extra });

  it("passes a good look and a card without one", () => {
    expect(cardLookProblems({ kind: "canon", look: CardLook.parse(human) })).toEqual([]);
    expect(cardLookProblems({ kind: "animal", look: CardLook.parse(cat) })).toEqual([]);
    expect(cardLookProblems({ kind: "resident" })).toEqual([]);
  });

  it("wants a cat look on an animal and a human look on a person", () => {
    expect(cardLookProblems({ kind: "animal", look: CardLook.parse(human) })[0]).toMatch(/animal card needs a cat look/);
    expect(cardLookProblems({ kind: "resident", look: CardLook.parse(cat) })[0]).toMatch(/resident card needs a human look/);
  });

  it("wants a worn glasses style exactly when the accessory is glasses", () => {
    expect(cardLookProblems({ kind: "canon", look: look({ glasses: "halfmoon", accessory: { kind: "glasses" } }) })).toEqual([]);
    expect(cardLookProblems({ kind: "canon", look: look({ glasses: "on_head", accessory: { kind: "scarf" } }) })).toEqual([]);
    expect(cardLookProblems({ kind: "canon", look: look({ glasses: "round" }) })[0]).toMatch(/accessory.kind must be glasses/);
    expect(cardLookProblems({ kind: "canon", look: look({ accessory: { kind: "glasses" } }) })[0]).toMatch(/needs a worn style/);
    expect(cardLookProblems({ kind: "canon", look: look({ glasses: "on_head", accessory: { kind: "glasses" } }) })[0]).toMatch(/needs a worn style/);
  });

  it("checks palette ranges on data that skipped the schema", () => {
    const raw = { ...human, skin: 12, outfit: { ...human.outfit, trim: 99 } } as unknown as CardLook;
    expect(cardLookProblems({ kind: "canon", look: raw })).toEqual([
      "look.skin: 12 is not a SKIN_TONES index (0–9) or \"#rrggbb\"",
      "look.outfit.trim: 99 is not a CLOTH_COLOURS index (0–15) or \"#rrggbb\""
    ]);
  });
});

describe("the look as save data, with caps", () => {
  it("still reads a look without headwear (older saves) and takes an optional cap", () => {
    const plain = { kind: "human", skin: 1, hair: 2, hairStyle: "bob", eyes: 3, top: 4, bottom: 5, bottomStyle: "skirt", shoes: 6, accessory: "none", accessoryColour: 7 };
    expect(CharacterLookData.parse(plain)).toEqual(plain);
    const capped = { ...plain, headwear: "knit_cap", headwearColour: 0x7a4b3a };
    expect(CharacterLookData.parse(capped)).toEqual(capped);
    expect(CharacterLookData.safeParse({ ...plain, headwear: "top_hat" }).success).toBe(false);
  });
});
