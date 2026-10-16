import { describe, expect, it } from "vitest";
import { fitText } from "../clamps";
describe("fitText", () => {
  it("leaves text within the cap alone", () => {
    expect(fitText("Rye's two coins.", 220)).toBe("Rye's two coins.");
  });
  it("cuts at the last full sentence that keeps at least half the cap", () => {
    const text = "Country loaf first. Rye after, for Hollis. Then the rolls, and the sweet dough if Bastien's been sniffing round the back. Sixty loaves now, not two hundred. My wrists don't agree with the old numbers.";
    expect(fitText(text, 180)).toBe("Country loaf first. Rye after, for Hollis. Then the rolls, and the sweet dough if Bastien's been sniffing round the back. Sixty loaves now, not two hundred.");
  });
  it("otherwise cuts at a whole word with an ellipsis, never mid-word", () => {
    const out = fitText("One very long sentence without any stops that keeps going and going past the cap for sure", 40);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith("…")).toBe(true);
    expect("One very long sentence without any stops that keeps going".startsWith(out.slice(0, -1))).toBe(true);
    expect(out).not.toMatch(/\s…$/);
  });
});
