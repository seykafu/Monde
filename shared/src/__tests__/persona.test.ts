// The Persona Card's JSON Schema (MVP F-05's snapshot), with M-03's optional census fields: a change to the card's
// shape shows up here as a snapshot diff.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PersonaCard } from "../index";

describe("the Persona Card schema (§9.3)", () => {
  it("matches its JSON Schema snapshot", async () => {
    await expect(`${JSON.stringify(z.toJSONSchema(PersonaCard), null, 2)}\n`).toMatchFileSnapshot("./__snapshots__/persona-card.schema.json");
  });

  it("keeps the census fields optional: a hand-written card needs none of them", () => {
    const schema = z.toJSONSchema(PersonaCard) as { required: string[]; properties: Record<string, unknown> };
    for (const key of ["generated_by", "household", "archetype", "employment", "years_in_monde"]) {
      expect(schema.properties).toHaveProperty(key);
      expect(schema.required).not.toContain(key);
    }
  });
});
