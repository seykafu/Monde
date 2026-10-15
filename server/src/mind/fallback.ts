/**
 * Authored fallback turns (GDD §9.1 principle 3: every AI call has a deadline and an authored fallback).
 *
 * This is the minimal M-05 set: one line per Regard tier × mood group, plus the always-valid fillers of
 * Appendix B.2.5 and the "Hm." thinking beat. The full Appendix B library and its picker (time, weather, zone,
 * events, no-repeat windows) are M-11. Mood bands (B.1) are grouped low (glum, low) · even · high (bright,
 * glowing) so fifteen lines cover all twenty-five band × tier cells. Lines follow the voice rules (§12.1):
 * contractions, full stops, no backstory, nothing a particular resident couldn't say.
 *
 * Every authored turn offers 2–3 replies to the line it shows (§9.10 "Player input"): the fifteen tier × mood
 * lines have their own; fillers, riddle hints and narrated lines take replies derived from the line
 * (shared/src/replies.ts). The client adds Leave.
 */
import {
  callName, derivedReplies, fillReply, moodBand, normalizeChoices, regardTier, type DialogueTurnOutput, type MoodBand,
  type PersonaCard, type RegardTier, type Reply, type ReplyCue, type ResidentState,
} from "@monde/shared";
import { containsAnswer } from "./promptBuilder.js";
import type { RiddleRecord } from "./riddles.js";
import { expressionFor } from "./expressions.js";

/** The authored beat the client plays when nothing has streamed by 2.5 s (§9.10 flow step 4). */
export const THINKING_BEAT = "Hm.";

type MoodGroup = "low" | "even" | "high";
const MOOD_GROUP: Record<MoodBand, MoodGroup> = { glum: "low", low: "low", even: "even", bright: "high", glowing: "high" };

/** `{player}` is the player's name. */
export const FALLBACK_LINES: Readonly<Record<RegardTier, Readonly<Record<MoodGroup, string>>>> = {
  Wary: {
    low: "Oh. It's you. I haven't the energy for this.",
    even: "I'll be polite. That's the most I'm offering.",
    high: "Hm. I'm in a good mood, so don't spoil it.",
  },
  Stranger: {
    low: "Not much company today, I'm afraid. Another time.",
    even: "We haven't properly met, have we? Not really.",
    high: "You're the Fellow, aren't you? Thought so.",
  },
  Neighbor: {
    low: "Oh, {player}. Not my best day. I'll be fine by Thursday.",
    even: "Hello again, {player}. How are you getting on?",
    high: "{player}. Good. Walk with me a minute?",
  },
  Friend: {
    low: "{player}. I'm glad it's you. Sit, if you've time.",
    even: "I saved you a seat. The real one was taken.",
    high: "There you are. I was hoping you'd come by.",
  },
  Confidant: {
    low: "Stay a while, {player}. I can't pretend with you.",
    even: "{player}. How are you, really? Take your time.",
    high: "Come here, you. It's been a good day, and it's better now.",
  },
};

/** Appendix B.2.5, always valid mid-conversation. */
export const FILLER_LINES: readonly string[] = ["Hm.", "Right.", "Well. There it is.", "Mm-hm.", "Funny old day."];

/** Narrated-action residents (Bastien) never speak (§9.3 voice modes). `{name}` is their first name. */
const ANIMAL_LINES: Readonly<Record<MoodGroup, string>> = {
  low: "({name} sleeps with one ear turned your way.)",
  even: "({name} sits down and gives you a slow blink.)",
  high: "({name} wanders over and sits on your boot.)",
};
const ANIMAL_FILLER = "({name} yawns.)";

/** On a riddle turn with nothing safe to hint, the resident is stumped (§14.2). */
export const STUMPED_LINE = "Couldn't tell you. I'm stumped.";

const k = (text: string): Reply => ({ text, intent: "kind" });
const c = (text: string): Reply => ({ text, intent: "curious" });
const j = (text: string): Reply => ({ text, intent: "joke" });
const bye = (text: string): Reply => ({ text, intent: "leave" });

/** The Fellow's replies to each FALLBACK_LINES line, in the same order: warm, curious, wry. */
export const FALLBACK_REPLIES: Readonly<Record<RegardTier, Readonly<Record<MoodGroup, readonly Reply[]>>>> = {
  Wary: {
    low: [bye("Another time, then. I'll leave you be."), c("Bad day? Anything I can do?"), j("I'll be quick. Promise.")],
    even: [k("Polite will do for now."), c("What did I do to earn that?"), { text: "Fair. I'll earn the rest.", intent: "firm" }],
    high: [k("I wouldn't dream of it."), c("What's put you in a good mood?"), j("I'll tiptoe, then.")],
  },
  Stranger: {
    low: [bye("Another time, then. Look after yourself."), c("Is everything all right?"), j("I'm not much company either. We'd suit.")],
    even: [k("We haven't. I'm the new Fellow."), c("What should I call you?"), j("Let's fix that, then. Hello.")],
    high: [k("That's me. Pleased to meet you."), c("Is it that obvious?"), j("Was it the lost look that gave me away?")],
  },
  Neighbor: {
    low: [k("Anything I can do before Thursday?"), c("What's happened?"), j("I'll check on you Thursday, then.")],
    even: [k("Not bad. The town's growing on me."), c("Getting there. And you?"), j("I've stopped getting lost. Mostly.")],
    high: [k("Gladly. Lead the way."), c("Where are we off to?"), j("Only if you set a slow pace.")],
  },
  Friend: {
    low: [k("I've time. What's wrong?"), c("Has something happened?"), j("I always have time for a sit.")],
    even: [k("Thanks. I'll take what I can get."), c("Who's got the real one?"), j("I'll stand. I'm told it's good for me.")],
    high: [k("I was hoping you'd be here."), c("Oh? What's on your mind?"), j("I'm hard to keep away.")],
  },
  Confidant: {
    low: [k("Then don't. I'm listening."), c("What's going on?"), j("Good. I'm a terrible audience for pretending.")],
    even: [k("Honestly? Better for seeing you."), c("Tired, but all right. And you?"), j("I've lost a hat and found a friend. Even, I'd say.")],
    high: [k("Mine too, now."), c("Tell me about it."), j("Careful. I'll start expecting this.")],
  },
};

export const LEAVE_CHOICE: DialogueTurnOutput["choices"][number] = { id: "a", text: "Leave", intent: "leave" };

export interface FallbackInput {
  card: PersonaCard;
  state: Pick<ResidentState, "regard" | "mood">;
  playerName: string;
  /** 0-based exchange number: the opener uses the tier × mood line, later turns alternate with fillers. */
  turnIndex: number;
  /** On a riddle-topic turn, the authored hint text replaces the line (§14.2). */
  riddle?: { record: RiddleRecord; allowed: number } | null;
}

const firstName = (card: PersonaCard): string => card.name.replace(/"[^"]*"/g, " ").trim().split(/\s+/)[0] ?? card.id;

/** The best hint the player may hear that doesn't contain an accepted answer, or null. */
export function authoredHint(record: RiddleRecord, allowed: number): string | null {
  const level = Math.max(0, Math.min(record.hints.length, Math.floor(allowed)));
  for (let i = level - 1; i >= 0; i--) {
    const hint = record.hints[i]!;
    if (!containsAnswer(hint, record.accepted)) return hint;
  }
  return null;
}

export function fallbackLine(input: FallbackInput): string {
  const group = MOOD_GROUP[moodBand(input.state.mood.valence)];
  const filler = input.turnIndex % 2 === 1;
  if (input.card.voice.mode === "narrated_action") {
    return (filler ? ANIMAL_FILLER : ANIMAL_LINES[group]).replaceAll("{name}", firstName(input.card));
  }
  if (input.riddle) return authoredHint(input.riddle.record, input.riddle.allowed) ?? STUMPED_LINE;
  const line = filler
    ? FILLER_LINES[Math.floor(input.turnIndex / 2) % FILLER_LINES.length]!
    : FALLBACK_LINES[regardTier(input.state.regard)][group];
  return line.replaceAll("{player}", input.playerName);
}

const CHOICE_IDS = ["a", "b", "c"] as const;

/** 2–3 replies to the line `fallbackLine` shows for this input (ids a, b, c; the client adds Leave). */
export function fallbackChoices(input: FallbackInput, text = fallbackLine(input)): DialogueTurnOutput["choices"] {
  const name = callName(input.card.name);
  let cue: ReplyCue;
  let replies: readonly Reply[];
  if (input.card.voice.mode === "narrated_action") {
    cue = { text, kind: "animal" };
    replies = derivedReplies(cue, input.turnIndex);
  } else if (input.riddle) {
    cue = { text, kind: text === STUMPED_LINE ? "stumped" : "riddle" };
    replies = derivedReplies(cue, input.turnIndex);
  } else if (input.turnIndex % 2 === 1) {
    cue = { text, kind: "talk" };
    replies = derivedReplies(cue, input.turnIndex);
  } else {
    cue = { text, kind: "greet", mood: moodBand(input.state.mood.valence) };
    replies = FALLBACK_REPLIES[regardTier(input.state.regard)][MOOD_GROUP[moodBand(input.state.mood.valence)]];
  }
  const filled = replies.map((r) => ({ text: fillReply(r.text, { name, player: input.playerName }), intent: r.intent }));
  return normalizeChoices(filled, { cue, name, seed: input.turnIndex }).map((choice, i) => ({ ...choice, id: CHOICE_IDS[i]! }));
}

/** A complete, effect-free turn in the dialogue contract's shape. */
export function fallbackTurn(input: FallbackInput): DialogueTurnOutput {
  const text = fallbackLine(input);
  return {
    lines: [{ text, expr: expressionFor(input.card, input.state.mood.emotion) }],
    choices: fallbackChoices(input, text),
    effects: {
      regard_delta: 0, mood: { valence: 0, stress: 0 }, memory: null, favor: null, reveal_secret: null, topic: "",
    },
    wrap_up: false,
  };
}
