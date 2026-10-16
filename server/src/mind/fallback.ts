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
 * lines have their own; riddle hints and narrated lines take replies derived from the line
 * (shared/src/replies.ts). The client adds Leave.
 *
 * `{player}` in a line is how this resident addresses the Fellow (naming.ts: "Fellow", "petite", the name…), so
 * an authored line follows the same naming rules as a generated one. A riddle-topic turn is the resident's
 * authored lead-in (riddleLeads.ts) and then the authored hint, on one line.
 *
 * Only the opener greets. Mid-conversation the fallback answers the moment the Fellow made (fallbackMoment): a
 * question gets an honest stall that asks for it again and offers to repeat it, a feeling gets a little care, a
 * goodbye gets seen off, anything else a short acknowledgement; and its replies carry the conversation on (ask
 * again, change the subject, go) rather than restart it. A resident who has talked with the Fellow before never
 * opens with "we haven't met".
 */
import {
  LIMITS, REPLY_CHARS, callName, derivedReplies, fillReply, moodBand, normalizeChoices, regardTier, replyHash, type DialogueTurnOutput,
  type Intent, type MoodBand, type PersonaCard, type RegardTier, type Reply, type ReplyCue, type ResidentState,
} from "@monde/shared";
import { containsAnswer, turnFocus } from "./promptBuilder.js";
import type { RiddleRecord } from "./riddles.js";
import { expressionFor } from "./expressions.js";
import { addressFor } from "./naming.js";
import { riddleLeadIn } from "./riddleLeads.js";

/** The authored beat the client plays when nothing has streamed by 2.5 s (§9.10 flow step 4). */
export const THINKING_BEAT = "Hm.";

type MoodGroup = "low" | "even" | "high";
const MOOD_GROUP: Record<MoodBand, MoodGroup> = { glum: "low", low: "low", even: "even", bright: "high", glowing: "high" };

/** `{player}` is what the resident calls the Fellow (naming.ts). */
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

/** Stranger-tier openers for someone the resident has talked with before (a history, or a resumed session). */
export const MET_LINES: Readonly<Record<MoodGroup, string>> = {
  low: "Oh, it's you. Not much company today, I'm afraid.",
  even: "Oh, it's you again. Go on, then.",
  high: "You again. Good timing.",
};

/**
 * What the Fellow's last move was, for a mid-conversation fallback. `open` is the opener (they walked up, first
 * time); `resume` is walking back up to a conversation that's still open.
 */
export type FallbackMoment = "open" | "resume" | "question" | "feeling" | "thanks" | "bye" | "intro" | "statement";

/**
 * Lines for each mid-conversation moment, house style (§12.1), in no resident's particular voice. `{player}` is what
 * the resident calls the Fellow (naming.ts), except in `intro`, where it's the name the Fellow just gave.
 */
export const MOMENT_LINES: Readonly<Record<Exclude<FallbackMoment, "open">, readonly string[]>> = {
  resume: ["Back again. Where were we?", "There you are. Where were we?"],
  question: [
    "Hm. Lost my thread. Ask me that again?",
    "Sorry, I was miles away. Say that again?",
    "Give me a minute with that one.",
    "Ask me again in a bit. My head's elsewhere.",
  ],
  feeling: [
    "That's a hard one. Sit a minute, if you like.",
    "Hm. That takes a while to wear off. Stay a bit.",
    "I'm sorry, {player}. It does get easier. Slowly.",
  ],
  thanks: ["Don't mention it.", "Any time, {player}."],
  intro: ["{player}, is it? I'll remember that.", "{player}. Good. Now I've a name for you."],
  bye: ["Mind how you go, {player}.", "Go on, then. Mind the cobbles.", "Off you go. Come back when you like."],
  statement: ["Hm. Is that right?", "Mm. Go on.", "Well. There it is.", "Fair enough."],
};

/** The Fellow said how they feel (a low feeling: these get care, not a shrug). */
const FEELING = /\b(?:homesick|lonely|sad|miss(?:ing)? (?:home|my|them|her|him)|tired|worried|scared|afraid|nervous|awful|don't know anyone|on my own|hard day|bad day|(?:feel|feeling|felt) (?:low|down|lost|rough|odd))\b/i;

export function fallbackMoment(input: Pick<FallbackInput, "playerText" | "intent" | "turnIndex">): FallbackMoment {
  const text = input.playerText?.trim();
  if (!text) return input.turnIndex > 0 ? "resume" : "open";
  if (turnFocus(text, input.intent) === "bye") return "bye";
  if (text.includes("?")) return "question";
  if (FEELING.test(text)) return "feeling";
  if (/\bthank/i.test(text)) return "thanks";
  if (/\b(?:[Ii]'m|[Ii] am|[Mm]y name's|[Mm]y name is|[Cc]all me)\s+[A-Z]/.test(text.replace(/[’]/g, "'"))) return "intro";
  return "statement";
}

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

/** Stranger-tier replies to MET_LINES, in the same order: warm, curious, wry. */
export const MET_REPLIES: Readonly<Record<MoodGroup, readonly Reply[]>> = {
  low: [bye("Another time, then. Look after yourself."), c("Is everything all right?"), j("I'm not much company either. We'd suit.")],
  even: [k("Just saying hello."), c("How's the day treating you?"), j("I'll try to be more interesting this time.")],
  high: [k("Good to see you too."), c("Good timing for what?"), j("I do try.")],
};

/**
 * Replies to a mid-conversation fallback: carry on (ask again, say more), change the subject, or go. A question
 * is offered back word for word when it fits a reply (`{question}`).
 */
export const MOMENT_REPLIES: Readonly<Record<Exclude<FallbackMoment, "open">, readonly Reply[]>> = {
  resume: [k("You were telling me something."), c("Where did we leave it?"), bye("Only passing. I'll let you get on.")],
  question: [c("{question}"), c("Never mind. What's keeping you busy today?"), bye("I'll let you get on.")],
  feeling: [k("Thanks. I'd like that."), c("Does it get easier, do you think?"), bye("I'll be all right. I'll let you get on.")],
  thanks: [k("I mean it, though."), c("Anything I can do for you?"), bye("I'll let you get on.")],
  intro: [k("Good to meet you properly."), c("And what do people call you?"), bye("I'll let you get on.")],
  bye: [bye("Take care, {name}."), c("Same time tomorrow?"), j("I'll try not to get lost on the way.")],
  statement: [k("Anyway. How's your day been?"), c("What do you make of it?"), bye("I'll let you get on.")],
};

export const LEAVE_CHOICE: DialogueTurnOutput["choices"][number] = { id: "a", text: "Leave", intent: "leave" };

export interface FallbackInput {
  card: PersonaCard;
  state: Pick<ResidentState, "regard" | "mood">;
  playerName: string;
  /** 0-based exchange number: only the opener (0, the Fellow walking up) greets. */
  turnIndex: number;
  /** On a riddle-topic turn, the authored hint text replaces the line (§14.2). */
  riddle?: { record: RiddleRecord; allowed: number } | null;
  /** What the Fellow said this turn (their words or the reply they picked); null when they walked up. */
  playerText?: string | null;
  /** The intent of the reply they picked, when they picked one. */
  intent?: Intent | null;
  /** The resident's lines so far in this conversation: a fallback doesn't repeat one. */
  said?: readonly string[];
  /** They've talked before (a history with the Fellow, or a resumed session). */
  met?: boolean;
  /** The Fellow's pronouns ("she/her"), for how the resident addresses them (naming.ts). */
  playerPronouns?: string;
}

const firstName = (card: PersonaCard): string => card.name.replace(/"[^"]*"/g, " ").trim().split(/\s+/)[0] ?? card.id;

/** The best hint the player may hear that doesn't contain an accepted answer, or null. */
export function authoredHint(record: RiddleRecord, allowed: number): string | null {
  const level = Math.max(0, Math.min(record.hints.length, Math.floor(allowed)));
  for (let i = level - 1; i >= 0; i--) {
    const hint = record.hints[i]!;
    if (hint && !containsAnswer(hint, record.accepted)) return hint;
  }
  return null;
}

/** What this resident calls the Fellow right now (naming.ts). */
export function addressTerm(input: FallbackInput): string {
  return addressFor({
    residentId: input.card.id, playerName: input.playerName, pronouns: input.playerPronouns ?? "they/them",
    regard: input.state.regard, met: input.met ?? false,
  }).term;
}

/** Fill `{player}` with `term`, capitalized where it opens a sentence ("My dear. Good."). */
export function fillAddress(line: string, term: string): string {
  return line.replace(/\{player\}/g, (_match, offset: number) => {
    const before = line.slice(0, offset);
    return before.trim() === "" || /[.!?]\s+$/.test(before) ? term.charAt(0).toUpperCase() + term.slice(1) : term;
  });
}

/** The first line of `pool` (from a stable start) that the resident hasn't said in this conversation. */
function freshLine(pool: readonly string[], input: FallbackInput, term: string): string {
  const said = new Set((input.said ?? []).map((line) => line.trim()));
  const start = replyHash(`${input.playerText ?? ""}|${input.turnIndex}`) % pool.length;
  for (let i = 0; i < pool.length; i++) {
    const line = fillAddress(pool[(start + i) % pool.length]!, term);
    if (!said.has(line)) return line;
  }
  return fillAddress(pool[start]!, term);
}

/**
 * A riddle-topic turn: the resident's authored lead-in, then the best safe hint (§14.2), on one line. Asked again
 * after that hint was given in this conversation, the lead-in says so. Nothing safe to hint: stumped.
 */
function riddleLine(input: FallbackInput, riddle: NonNullable<FallbackInput["riddle"]>): string {
  const hint = authoredHint(riddle.record, riddle.allowed);
  if (!hint) return STUMPED_LINE;
  const said = input.said ?? [];
  const lead = riddleLeadIn({
    residentId: input.card.id, riddleId: riddle.record.id, turnIndex: input.turnIndex,
    again: said.some((line) => line.includes(hint)), said,
  });
  const line = `${lead} ${hint}`;
  return line.length <= LIMITS.dialogue.lineChars ? line : hint;
}

export function fallbackLine(input: FallbackInput): string {
  const group = MOOD_GROUP[moodBand(input.state.mood.valence)];
  const moment = fallbackMoment(input);
  if (input.card.voice.mode === "narrated_action") {
    return (moment === "open" ? ANIMAL_LINES[group] : ANIMAL_FILLER).replaceAll("{name}", firstName(input.card));
  }
  if (input.riddle) return riddleLine(input, input.riddle);
  // The intro moment echoes the name the Fellow just gave; everything else uses the resident's own address.
  const term = moment === "intro" ? input.playerName : addressTerm(input);
  if (moment !== "open") return freshLine(MOMENT_LINES[moment], input, term);
  const tier = regardTier(input.state.regard);
  const line = input.met && tier === "Stranger" ? MET_LINES[group] : FALLBACK_LINES[tier][group];
  return fillAddress(line, term);
}

const CHOICE_IDS = ["a", "b", "c"] as const;

/** The Fellow's question as a reply they can pick to ask it again: the whole line, or its last question if shorter. */
function askAgain(text: string): string | null {
  const whole = text.replace(/\s+/g, " ").trim();
  if (whole.length <= REPLY_CHARS) return whole;
  const questions = whole.match(/[^.!?]*\?/g) ?? [];
  const last = questions.at(-1)?.trim();
  return last && last.length <= REPLY_CHARS ? last : null;
}

/** 2–3 replies to the line `fallbackLine` shows for this input (ids a, b, c; the client adds Leave). */
export function fallbackChoices(input: FallbackInput, text = fallbackLine(input)): DialogueTurnOutput["choices"] {
  const name = callName(input.card.name);
  const moment = fallbackMoment(input);
  const group = MOOD_GROUP[moodBand(input.state.mood.valence)];
  let cue: ReplyCue;
  let replies: readonly Reply[];
  if (input.card.voice.mode === "narrated_action") {
    cue = { text, kind: "animal" };
    replies = derivedReplies(cue, input.turnIndex);
  } else if (input.riddle) {
    cue = { text, kind: text === STUMPED_LINE ? "stumped" : "riddle" };
    replies = derivedReplies(cue, input.turnIndex);
  } else if (moment !== "open") {
    cue = { text, kind: moment === "bye" ? "bye" : "talk" };
    const again = moment === "question" ? askAgain(input.playerText ?? "") : null;
    const intent: Intent = input.intent && input.intent !== "leave" ? input.intent : "curious";
    replies = MOMENT_REPLIES[moment].flatMap((r) => (r.text !== "{question}" ? [r] : again ? [{ text: again, intent }] : []));
  } else {
    cue = { text, kind: "greet", mood: moodBand(input.state.mood.valence) };
    const tier = regardTier(input.state.regard);
    replies = input.met && tier === "Stranger" ? MET_REPLIES[group] : FALLBACK_REPLIES[tier][group];
  }
  const filled = replies.map((r) => ({ text: fillReply(r.text, { name, player: input.playerName }), intent: r.intent }));
  return normalizeChoices(filled, { cue, name, seed: input.turnIndex }).map((choice, i) => ({ ...choice, id: CHOICE_IDS[i]! }));
}

/** A complete, effect-free turn in the dialogue contract's shape. A goodbye wraps the conversation up. */
export function fallbackTurn(input: FallbackInput): DialogueTurnOutput {
  const text = fallbackLine(input);
  const bye = !input.riddle && input.card.voice.mode !== "narrated_action" && fallbackMoment(input) === "bye";
  return {
    lines: [{ text, expr: expressionFor(input.card, input.state.mood.emotion) }],
    choices: fallbackChoices(input, text),
    effects: {
      regard_delta: 0, mood: { valence: 0, stress: 0 }, memory: null, favor: null, reveal_secret: null, topic: "",
    },
    wrap_up: bye,
  };
}
