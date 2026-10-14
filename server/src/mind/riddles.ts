/**
 * Server-side riddle records for the AI hint guard (GDD §14.2). The client names the riddle and the hint level
 * the player has unlocked; everything else, above all the accepted answers, comes from here and never from the
 * request. For now this holds the Old Quarter chain (§14.4, OQ-1 to OQ-5); the other chains move here with G-05.
 */
import type { RiddleTopic } from "./promptBuilder.js";

export interface RiddleRecord {
  id: string;
  inscription: string;
  /** The ladder: nudge, narrowing, near-giveaway. */
  hints: readonly [string, string, string];
  /** Accepted answers (§14.1 normalization applies). Never rendered into a prompt. */
  accepted: readonly string[];
}

const lines = (...text: string[]): string => text.join("\n");

export const RIDDLES: Readonly<Record<string, RiddleRecord>> = {
  "OQ-1": {
    id: "OQ-1",
    inscription: lines(
      "Iron tongue, bronze skirt.",
      "They rang me for every wedding and every grave,",
      "then gave my tower to a younger voice.",
      "Now I keep the chapel gate and say nothing at all.",
      "Come and listen to me not ringing.",
    ),
    hints: [
      "Something that used to make a noise and doesn't anymore.",
      "It has a tongue and a skirt but no face, and it lives by a gate.",
      "Look at St. Brigid's chapel gate.",
    ],
    accepted: ["bell", "old bell", "chapel bell", "church bell", "st brigids bell", "brigids bell"],
  },
  "OQ-2": {
    id: "OQ-2",
    inscription: lines(
      "I fish all day in a pool that has forgotten water,",
      "and I have never caught a thing.",
      "The bell and I were poured from the same pot.",
      "I keep one foot dry, out of habit.",
      "Look under it.",
    ),
    hints: [
      "The pool that has forgotten water is easy to find in a town this dry.",
      "A bronze bird that stands on one leg.",
      "Fountain Square: look under the heron's lifted foot.",
    ],
    accepted: ["heron", "bronze heron", "fountain", "fountain heron", "bird"],
  },
  "OQ-3": {
    id: "OQ-3",
    inscription: lines(
      "Every house in this quarter wears its birth year over the door.",
      "Find the one that wears this sum:",
      "the year Monde was founded,",
      "and every hand my tower holds,",
      "and every face it shows.",
    ),
    hints: [
      "Monde's founding year is on the welcome sign at the ferry slip.",
      "Walk around the clocktower. Count its faces, and remember each face has two hands.",
      "1838 + 8 + 4.",
    ],
    accepted: ["1850", "library", "the library"],
  },
  "OQ-4": {
    id: "OQ-4",
    inscription: lines(
      "Search where my apprentice's line still keeps its hours.",
      "His window holds a hundred faces, and no two of them agree.",
      "Over his door hangs a gilded watch as wide as a cartwheel.",
      "Put your crowbar away and ask him the time.",
    ),
    hints: [
      "Read the first letter of each line.",
      "A window full of clocks that all disagree.",
      "Bertrand's shop, the one with the giant watch over the door. Ask him the time.",
    ],
    accepted: ["shop", "clock shop", "watch shop", "bertrand", "achterberg", "horlogerie", "watch sign"],
  },
  "OQ-5": {
    id: "OQ-5",
    inscription: lines(
      "My heart is at the top of the stair, and it is missing a piece.",
      "From noon to midnight I strike, and strike again.",
      "Count every stroke I give after noon, up to and including midnight's,",
      "and stop upon that step.",
      "The stone there is loose for you alone.",
    ),
    hints: [
      "The clock strikes once at one o'clock, twice at two…",
      "Add up the strokes from one o'clock to twelve.",
      "1 + 2 + … + 12 = 78. Count the stairs.",
    ],
    accepted: ["78", "seventy eight", "step 78"],
  },
};

export function riddleRecord(id: string): RiddleRecord | null {
  return Object.hasOwn(RIDDLES, id) ? RIDDLES[id]! : null;
}

/** The prompt builder's view: inscription, ladder and unlocked level. `accepted` lets it drop leaking hints. */
export function riddleTopic(record: RiddleRecord, allowed: number): RiddleTopic {
  return { id: record.id, inscription: record.inscription, hints: record.hints, allowed, accepted: record.accepted };
}
