import { describe, expect, it } from "vitest";
import { namePlaceIds, parseHomes, placeLabel } from "../index";

const homes = parseHomes({ version: 1, homes: {
  "old_quarter.augusta_house": { street: "High Street", number: 17, beds: 2, ground_floor: true, bench: false, host: { building: "augusta_house" } },
  "old_quarter.margo_flat": { street: "High Street", number: 9, name: "the flat over the library", beds: 1, ground_floor: false, bench: false, host: { building: "library" } },
} });

describe("place names (playtest 2026-10-20: \"headed for market_row.market_street\")", () => {
  it("names places as residents say them", () => {
    expect(placeLabel("market_row.market_street")).toBe("Market Street");
    expect(placeLabel("market_row.bakery")).toBe("Fournier & Fille");
    expect(placeLabel("old_quarter.vacant_house_47")).toBe("No. 47");
    expect(placeLabel("wharf.home_12")).toBe("a house nearby");
    expect(placeLabel("offmap.city")).toBe("the mainland");
    expect(placeLabel("old_quarter.augusta_house", homes)).toBe("No. 17 High Street");
    expect(placeLabel("old_quarter.margo_flat", homes)).toBe("the flat over the library");
  });
  it("swaps every place id in a text and leaves everything else alone", () => {
    const named = namePlaceIds("I'm headed for market_row.market_street, then wharf.ferry_slip. 3.5 coins, e.g. tea.", (id) => placeLabel(id));
    expect(named).toBe("I'm headed for Market Street, then Ferry Slip. 3.5 coins, e.g. tea.");
  });
});
