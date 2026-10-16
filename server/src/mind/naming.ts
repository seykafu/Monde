/**
 * What a resident calls the Fellow (GDD §12.1: the character registers and the anti-pattern "Generic address";
 * the hand-written resident cards' registers; MVP Q-01).
 *
 * The rule depends on who is speaking, the Fellow's Regard with them and whether they have talked before. It
 * reaches the model as one explicit line in the dynamic block (dialogue.md, inside <player>), never in blocks 1-3,
 * and the authored fallbacks use the same term (fallback.ts), so a resident sounds the same either way:
 *   - Pell: "Fellow" (or "dear"); the Fellow's name only in private, once Regard passes 40.
 *   - Hollis, Augusta, Rook, Nettie, Ada, Bru, Ines: "Fellow".
 *   - Odile: "petite" / "petit" (the young), or plain "you"; never the name.
 *   - June: "friend" (the only one who may); Bertrand: "my dear" or "young person"; Rosalind: "pet".
 *   - Vane: first names from the second meeting.
 *   - Everyone else: "Fellow" until they're introduced or have met, then the name or "Fellow".
 */
import { regardTier } from "@monde/shared";

export interface AddressInput {
  residentId: string;
  /** The Fellow's name, as the Fellowship form gave it. */
  playerName: string;
  /** e.g. "she/her", "he/him", "they/them". */
  pronouns: string;
  /** The Fellow's Regard with this resident. */
  regard: number;
  /** They have talked before (a history with the Fellow, or a resumed conversation). */
  met: boolean;
}

export interface Address {
  /** What the resident calls the Fellow in speech, e.g. "Fellow", "petite", "Wren". */
  term: string;
  /** The prompt's line for it, e.g. `Call her "Fellow" ...`. */
  line: string;
}

/** The object pronoun from a "she/her" pair; anything unrecognised is "them". */
function objectPronoun(pronouns: string): string {
  const parts = pronouns.toLowerCase().split("/").map((p) => p.trim());
  if (parts[0] === "she") return "her";
  if (parts[0] === "he") return "him";
  return "them";
}

/** Residents who call the Fellow "Fellow" whatever the Regard (§12.1 registers and the resident cards). */
const ALWAYS_FELLOW: Readonly<Record<string, string>> = {
  hollis: "",
  augusta: "",
  ada: "",
  bru: "",
  rook: ", like a dare",
  nettie: ", like a dare",
  ines: ": you use titles, not names",
};

export function addressFor(input: AddressInput): Address {
  const name = input.playerName.trim() || "Fellow";
  // Before the Fellowship form is signed the Fellow has no name but "Fellow" (player.ts DEFAULT_PLAYER_VIEW).
  const named = name.toLowerCase() !== "fellow";
  const them = objectPronoun(input.pronouns);
  const call = (...parts: string[]) => `Call ${them} ${parts.filter(Boolean).join("")}.`;
  const tier = regardTier(input.regard);
  const id = input.residentId;

  if (id in ALWAYS_FELLOW) {
    const rest = ALWAYS_FELLOW[id]!;
    return { term: "Fellow", line: call(`"Fellow"${rest}`, named && !rest.startsWith(":") ? `, never "${name}"` : "") };
  }
  switch (id) {
    case "pell":
      // §12.1: the player's name "in private once Regard passes 40" (Friend tier); "Fellow" in public.
      return input.regard >= 40 && named
        ? { term: name, line: call(`"${name}" when it's just the two of you, "Fellow" in front of others`) }
        : { term: "Fellow", line: call(`"Fellow" ("dear" now and then)`, named ? `, not "${name}": first names are for friends, in private` : "") };
    case "odile": {
      // GDD-GAP: §12.1 gives "petit" or "petite" with no rule for they/them; "petit" is the unmarked French form.
      const petit = them === "her" ? "petite" : "petit";
      return { term: petit, line: call(`"${petit}", or just "you"`, named ? `; never "${name}"` : "") };
    }
    case "june":
      return { term: "friend", line: call(`"friend"`, input.met && named ? `, and "${name}" now and then` : "") };
    case "bertrand":
      return { term: "my dear", line: call(`"my dear" or "young person"`) };
    case "rosalind":
      return { term: "pet", line: call(`"pet"`) };
    case "vane":
      return input.met && named
        ? { term: name, line: call(`"${name}": first names from the second meeting`) }
        : { term: "Fellow", line: call(`"Fellow"`, named ? " today; first names come from the second meeting" : "") };
    default:
      if (!named) return { term: "Fellow", line: call(`"Fellow"`) };
      if (tier === "Wary") return { term: "Fellow", line: call(`"Fellow", coolly; not "${name}"`) };
      if (tier === "Stranger" && !input.met) {
        return { term: "Fellow", line: call(`"Fellow"; "${name}" only once the Fellow has told you the name`) };
      }
      return { term: name, line: call(`"${name}" or "Fellow"`) };
  }
}
