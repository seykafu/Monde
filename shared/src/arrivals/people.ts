// The town's generated residents as saved state and as wire data (GDD §6.4, Appendix A.3.1 step 7). Pure.
//
// The client keeps them in the town engine's state (TownState.people, saved as SavedTown.people); the server keeps
// them as resident rows plus an `arrivals` row per household. Both sides exchange households in this shape: the night
// POST carries the client's offline (template) households for the server to adopt, and the dawn package carries the
// households the server committed for the day.
import { z } from "zod";
import { PersonaCard } from "../persona";

const day = z.number().int().positive();

/** One generated resident and where they came from. */
export const ArrivalResident = z.object({
  card: PersonaCard,
  household: z.string(),
  archetype: z.string(),
  arrived_day: day,
  /** The dream template the card was written from (A.3.6 `dream.template`). */
  dream_template: z.string(),
});
export type ArrivalResident = z.infer<typeof ArrivalResident>;

/** A household as it lands (A.3.4 rule 2: same dawn, same boat, one Dawn Report entry). */
export const ArrivalHousehold = z.object({
  id: z.string(),
  archetype: z.string(),
  /** The day they step off the ferry (08:00, §6.4). */
  day,
  /** `zone.place` of the restored home they take. */
  home: z.string(),
  summary: z.string(),
  generated_by: z.enum(["model", "template"]),
  residents: z.array(ArrivalResident).min(1),
});
export type ArrivalHousehold = z.infer<typeof ArrivalHousehold>;

/** Someone who left on the ferry (§6.4). */
export const DepartedResident = z.object({
  id: z.string(), name: z.string(), household: z.string(), home: z.string(), day,
  /** The Dawn Report's kind line. */
  line: z.string(),
  portrait: z.string(),
});
export type DepartedResident = z.infer<typeof DepartedResident>;

export const TownPeople = z.object({
  /** Households living in town (each with its residents still here). */
  households: z.array(ArrivalHousehold),
  /** Today's households, waiting on the ferry until 08:00. */
  pending: z.array(ArrivalHousehold),
  /** Residents leaving on the ferry of `day` (their Leaving Notice stands; §6.4). */
  leaving: z.array(z.object({ id: z.string(), day })),
  departed: z.array(DepartedResident),
  /** Households the server hasn't got yet (Quiet Mode arrivals): adopted with the next night. */
  unsynced: z.array(z.string()),
  /** Residents whose Leaving Notice was resolved by a Last Chance Favor, and the day. */
  stayed: z.array(z.object({ id: z.string(), day })),
});
export type TownPeople = z.infer<typeof TownPeople>;

export const emptyPeople = (): TownPeople => ({ households: [], pending: [], leaving: [], departed: [], unsynced: [], stayed: [] });

/** Every living generated resident. */
export const livingArrivals = (p: TownPeople | undefined): ArrivalResident[] => (p?.households ?? []).flatMap(h => h.residents);

/**
 * S05's `arrival` alias (§13.3): the first real arrival, the first member of the first household to step off.
 * Pending households count once it's their morning, so the scene at 07:45 meets the person on the boat.
 */
export function firstArrival(p: TownPeople | undefined, day?: number): ArrivalResident | null {
  const landed = [...(p?.households ?? []), ...(p?.pending ?? []).filter(h => day === undefined || h.day <= day)];
  const first = [...landed].sort((a, b) => a.day - b.day || a.id.localeCompare(b.id))[0];
  if (first) return first.residents[0] ?? null;
  return null;
}

/** "Ilse Maertens, 34, cartographer, has taken No. 47 Lamplighter Lane." (§6.6 comings and goings). */
export function arrivalLine(r: ArrivalResident, homeName: string): string {
  const job = r.card.occupation.replace(/\.$/, "");
  const lower = job.charAt(0).toLowerCase() + job.slice(1);
  return `${r.card.name}, ${r.card.age}, ${lower}, has taken ${homeName}.`;
}

/** The newcomers in a household, as the paper prints them: the first by name, the rest as "with …". */
export function householdLine(h: ArrivalHousehold, homeName: string): string {
  const [first, ...rest] = h.residents;
  if (!first) return "";
  const line = arrivalLine(first, homeName);
  if (!rest.length) return line;
  const others = rest.map(r => `${r.card.name.split(" ")[0]} (${r.card.age})`);
  return `${line.slice(0, -1)}, with ${others.length > 1 ? `${others.slice(0, -1).join(", ")} and ${others.at(-1)}` : others[0]}.`;
}
