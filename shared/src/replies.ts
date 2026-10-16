import type { Intent } from "./outputs";
import type { MoodBand } from "./state";

/**
 * The Fellow's replies (GDD §9.10 "Player input": 2–3 generated replies plus Leave, each with an intent).
 *
 * The model writes its own choices; everything else gets them from here, so a reply always answers the line
 * the resident just said:
 *   - Quiet Mode lines may carry authored `replies` (content/lines/lines.yaml); lines without them, and the
 *     server's authored fallback turns, take `derivedReplies`: one warm, one curious and one wry reply from a
 *     pool chosen by what the line is (a question, news, the weather, a greeting, a low mood…).
 *   - `normalizeChoices` is the guarantee on every turn, live or not: 2–3 distinct replies, at most one of
 *     them a goodbye, padded from the derived pool when a turn came up short.
 * The bare "Leave" is not a reply: the dialogue panel always offers its own Leave button.
 *
 * Pure: no Phaser, no DOM, no randomness (variants are picked by a hash of the line).
 */

/** What a Quiet Mode reply asks for next: more talk, or the news (a `ctx` line). */
export type ReplyNext = "talk" | "ctx";

export interface Reply {
  text: string;
  intent: Intent;
  /** Quiet Mode only: the kind of line the resident answers with. Defaults to talk. */
  next?: ReplyNext;
}

/** §9.10.2: generated choices are at most 90 characters. */
export const REPLY_CHARS = 90;
export const MIN_REPLIES = 2;
export const MAX_REPLIES = 3;

/** What a reply responds to: the resident's line, and whatever the line's tags or the turn say about it. */
export interface ReplyCue {
  /** The line as shown (placeholders filled). */
  text: string;
  /** The kind of line: Quiet Mode's B.1 kinds, plus the server fallback's own. */
  kind?: "greet" | "talk" | "ctx" | "react" | "bye" | "riddle" | "stumped" | "animal";
  mood?: MoodBand | null;
  /** A weather tag (sun, cloud, rain, fog, wind, snow). */
  weather?: string | null;
  /** A zone id (old_quarter, wharf…). */
  zone?: string | null;
  /** A town event tag (tollmen_near, project_done…). */
  event?: string | null;
}

export type ReplyCategory =
  | "greet" | "greet_low" | "greet_high" | "how_are_you" | "food" | "either_or" | "question" | "wh_question"
  | "news_good" | "news_bad" | "thanks" | "weather" | "place" | "low" | "high" | "filler" | "statement"
  | "riddle" | "stumped" | "animal" | "bye";

interface Pool { warm: readonly Reply[]; curious: readonly Reply[]; wry: readonly Reply[] }

const k = (text: string, next?: ReplyNext): Reply => ({ text, intent: "kind", ...(next ? { next } : {}) });
const c = (text: string, next?: ReplyNext): Reply => ({ text, intent: "curious", ...(next ? { next } : {}) });
const j = (text: string, next?: ReplyNext): Reply => ({ text, intent: "joke", ...(next ? { next } : {}) });
const f = (text: string, next?: ReplyNext): Reply => ({ text, intent: "firm", ...(next ? { next } : {}) });

/**
 * The derived pools. `{name}` is the resident's first name (dropped with its comma when unknown). Plain words,
 * the Fellow's voice: new in town, friendly, a little dry. Nothing modern, no brands (checked by a server test
 * against the lexical filters).
 */
export const REPLY_POOLS: Readonly<Record<ReplyCategory, Pool>> = {
  greet: {
    warm: [k("Hello, {name}. Good to see you."), k("{name}. Nice to run into you."), k("Hello. I was hoping I'd see a friendly face.")],
    curious: [c("Anything new on the street?", "ctx"), c("How are you keeping, {name}?"), c("What are you up to today?")],
    wry: [j("Don't worry, I'm not lost. Mostly."), j("I'm still learning names. Yours stuck."), j("I keep walking past here. It's a nice street.")],
  },
  greet_low: {
    warm: [k("Sorry it's a heavy one. Want company for a bit?"), k("I can walk with you, if you like."), k("Sit a minute? I'm in no hurry.")],
    curious: [c("What's weighing on you?"), c("Rough day so far? Tell me."), c("Has something happened?")],
    wry: [j("I'll do the talking, then. You just nod."), j("I'll be cheerful enough for both of us."), j("Shall I go and complain to the sky for you?")],
  },
  greet_high: {
    warm: [k("Good to see you smiling, {name}."), k("You've cheered me up already."), k("Hello, {name}. That's a good start to my day.")],
    curious: [c("What's put you in such a good mood?"), c("Go on, what's happened?"), c("Good news somewhere?", "ctx")],
    wry: [j("Whatever you had for breakfast, I want some."), j("Steady on. It's not even market day."), j("Careful. It's catching.")],
  },
  how_are_you: {
    warm: [k("Not bad at all. Still finding my feet."), k("Better for seeing a friendly face."), k("Good, thanks. The town's growing on me.")],
    curious: [c("Getting there. How about you?"), c("Fair to middling. And you, {name}?"), c("Can't complain. How's your day been?")],
    wry: [j("Ask me again once I've found the bakery."), j("Still standing. The cobbles keep trying."), j("Honestly? I've had more lost mornings than found ones.")],
  },
  food: {
    warm: [k("I had a bun on the way. Kind of you to ask."), k("Not yet. I'd like that, thanks.")],
    curious: [c("Not yet. Where's good around here?"), c("Not yet. What do you recommend?")],
    wry: [j("I'm saving room. Don't tell the baker."), j("Does a cup of tea count?")],
  },
  either_or: {
    warm: [k("A bit of both, honestly."), k("The first, I think.")],
    curious: [c("Which would you guess?"), c("What about you?")],
    wry: [j("Neither. I'm just wandering."), j("Depends who's asking.")],
  },
  question: {
    warm: [k("I'd say so, yes."), k("I think so. Mostly.")],
    curious: [c("Why do you ask?"), c("What would you say?")],
    wry: [j("Ask me again after a cup of tea."), j("I'll tell you when I've worked it out.")],
  },
  wh_question: {
    warm: [k("I wish I knew."), k("Good question. Let me think.")],
    curious: [c("Any guesses yourself?"), c("Who would know, do you think?")],
    wry: [j("Don't look at me."), j("I've only been here five minutes.")],
  },
  news_good: {
    warm: [k("That's good to hear."), k("I'm glad. It's about time."), k("Good. The place could do with it.")],
    curious: [c("How did that come about?"), c("Who's behind it?"), c("What else is going on?", "ctx")],
    wry: [j("Things are looking up, then."), j("Monde's full of surprises."), j("I'll believe it when I've seen it twice.")],
  },
  news_bad: {
    warm: [k("Thanks for the warning."), k("Are you all right, {name}?"), k("I'll keep my eyes open.")],
    curious: [c("How long has this been going on?"), c("Has anyone stood up to them?"), c("What do they want, anyway?")],
    wry: [f("They don't scare me. Much."), f("Someone ought to have a word with them."), f("I'll walk where I like, thanks.")],
  },
  thanks: {
    warm: [k("It was nothing. Honestly."), k("Happy to help, {name}.")],
    curious: [c("Anything else I can do?"), c("Is there more that needs doing?")],
    wry: [j("I'll put it on your tab."), j("You can owe me a cup of tea.")],
  },
  weather: {
    warm: [k("Good day for a hot cup of something."), k("I don't mind it, really.")],
    curious: [c("Is it like this most of the year?"), c("Does it often turn like this?")],
    wry: [j("I'm told it builds character."), j("I'll add it to my list of complaints.")],
  },
  place: {
    warm: [k("I'm starting to like it here."), k("It's handsome, in its way.")],
    curious: [c("What was it like before?"), c("How long have you known this bit of town?")],
    wry: [j("I'll get my bearings eventually."), j("I've only been lost here twice.")],
  },
  low: {
    warm: [k("Anything I can do to help?"), k("Sit a minute? I've no hurry."), k("I'm sorry, {name}. That sounds hard.")],
    curious: [c("Do you want to talk about it?"), c("What's been on your mind?"), c("Has it been like this long?")],
    wry: [j("I could tell you a terrible joke. It might help."), j("Shall I go and shout at the weather for you?"), j("Tomorrow's bound to be better. Probably.")],
  },
  high: {
    warm: [k("Glad to hear it."), k("That's lovely. You've earned a good day."), k("Good. Hang on to it.")],
    curious: [c("What's put you in such good spirits?"), c("Go on, what's the secret?"), c("Did something happen?", "ctx")],
    wry: [j("Save some of that for the rest of us."), j("Careful. It's catching."), j("I'll have what you're having.")],
  },
  filler: {
    warm: [k("Fair enough."), k("I'll take that as a yes.")],
    curious: [c("Go on."), c("What are you thinking?")],
    wry: [j("That's all I get?"), j("Very mysterious, {name}.")],
  },
  statement: {
    warm: [k("I see what you mean."), k("That sounds about right."), k("I'll remember that.")],
    curious: [c("How do you mean?"), c("Tell me more."), c("What makes you say that?")],
    wry: [j("If you say so."), j("I'll take your word for it."), j("You'd know better than me.")],
  },
  riddle: {
    warm: [k("Thanks. I'll think on that.")],
    curious: [{ text: "Anything more you can tell me?", intent: "about_riddle" }],
    wry: [j("That's either very helpful or no help at all.")],
  },
  stumped: {
    warm: [k("Fair enough. I'll keep looking.")],
    curious: [c("Who might know, do you think?")],
    wry: [j("If you're stumped, I'm in trouble.")],
  },
  animal: {
    warm: [k("Crouch down and hold out a hand."), k("Scratch behind his good ear.")],
    curious: [c("Ask him where he's been all day."), c("Wonder aloud what he's watching.")],
    wry: [j("Tell him he's the best cat on the street."), j("Ask him politely for the wall seat.")],
  },
  bye: {
    warm: [{ text: "Take care, {name}.", intent: "leave" }],
    curious: [c("Same time tomorrow?")],
    wry: [j("Mind the cobbles on your way.")],
  },
};

/** Weather tags each get their own replies (§5.6 weather kinds). */
export const WEATHER_REPLIES: Readonly<Record<string, Pool>> = {
  sun: {
    warm: [k("Lovely, isn't it? I could stand here all day.")],
    curious: [c("Is it always this bright in spring?")],
    wry: [j("Even the gulls look pleased with themselves.")],
  },
  cloud: {
    warm: [k("Grey suits the harbour, I think.")],
    curious: [c("Will it rain later, do you think?")],
    wry: [j("I'll take grey over wet.")],
  },
  rain: {
    warm: [k("Mind you don't catch a chill.")],
    curious: [c("Does it rain like this all spring?")],
    wry: [j("My boots gave up an hour ago.")],
  },
  fog: {
    warm: [k("I'll keep to the walls. Thanks.")],
    curious: [c("How do the boats manage in this?")],
    wry: [j("I nearly said good morning to a lamp post.")],
  },
  wind: {
    warm: [k("Hold on to your hat, then.")],
    curious: [c("Is it always this blowy by the water?")],
    wry: [j("I've lost one hat already. It's halfway to Carrow.")],
  },
  snow: {
    warm: [k("It's pretty, though. You have to give it that.")],
    curious: [c("Does the ferry still run in this?")],
    wry: [j("Nobody told me to pack a scarf.")],
  },
};

/** Zones (§2.3) each get their own replies. */
export const ZONE_REPLIES: Readonly<Record<string, Pool>> = {
  old_quarter: {
    warm: [k("I like the gas lamps. They make it feel looked after.")],
    curious: [c("Why did the clock stop at 4:17, do you know?")],
    wry: [j("I've been lost here twice today. Once on purpose.")],
  },
  market_row: {
    warm: [k("The smell of bread alone could keep me here.")],
    curious: [c("What used to be in all the empty shops?")],
    wry: [j("I got told off for squeezing the pears.")],
  },
  wharf: {
    warm: [k("I like the sound of the water on the posts.")],
    curious: [c("Were you here when the cannery was running?")],
    wry: [j("Everything here smells of salt. Me included, now.")],
  },
  commons: {
    warm: [k("It's lovely, even overgrown.")],
    curious: [c("What was the bandstand like before it fell?")],
    wry: [j("The ducks keep better hours than I do.")],
  },
  millbrook: {
    warm: [k("The weir's a good sound to fall asleep to.")],
    curious: [c("How many families lived here when the mill ran?")],
    wry: [j("I tried counting the empty houses. I lost count.")],
  },
  station_hill: {
    warm: [k("You can see the whole bay from up here.")],
    curious: [c("When did the last train stop here?")],
    wry: [j("Windy enough to blow the thoughts right out of you.")],
  },
  briar_woods: {
    warm: [k("I'll stick to the path. Thanks for the tip.")],
    curious: [c("Have you been up to the old observatory?")],
    wry: [j("The brambles have had a go at my coat already.")],
  },
};

const BAD_NEWS_EVENTS: ReadonlySet<string> = new Set(["tollmen_near", "scuffle_seen", "scuffle_lost"]);
const THANKS_EVENTS: ReadonlySet<string> = new Set(["gift_love", "gift_like", "gift_neutral", "gift_dislike", "helped"]);
const LOW_EVENTS: ReadonlySet<string> = new Set(["refused_by_player", "declined_by_resident"]);

const FILLER = /^(?:hm+|right|mm-?hm|well\. there it is|can't argue with that|funny old day|oh|ah|yes|no|indeed)\.?$/i;
const HOW_ARE_YOU = /\bhow (?:are|is) (?:you|things|your day)\b|\bhow'?s (?:your|the) day\b|\bgetting on\b|\bshaping up\b/i;
const FOOD = /\b(?:eaten|eat|hungry|lunch|breakfast|supper|a bite)\b/i;
const EITHER_OR = /\bor\b[^?]*\?/i;
/** A question asking who, what, where, when, why or which (not a yes-or-no one). */
const WH = /(?:^|[.!?)]\s+|,\s*)(?:who|what|where|when|why|which|whose|how (?:long|many|much|come|did|do))\b[^.!?]*\?/i;
const WEATHER_WORDS: readonly [string, RegExp][] = [
  ["rain", /\b(?:rain|raining|puddles?|drizzle|wet)\b/i], ["fog", /\bfog(?:gy)?\b/i], ["wind", /\b(?:wind|windy|gale)\b/i],
  ["snow", /\b(?:snow|ice|icy|frost)\b/i], ["sun", /\b(?:sun|sunny|sunshine)\b/i], ["cloud", /\b(?:cloud|clouds|cloudy|overcast)\b/i],
];
const LOW_WORDS = /\b(?:tired|sorry|worse|can't sleep|long day|flagging|poor company|not my best|heavy|alone)\b/i;

/** The weather a line is about: its tag, or a weather word in the text. */
export function weatherOf(cue: Pick<ReplyCue, "text" | "weather">): string | null {
  if (cue.weather && WEATHER_REPLIES[cue.weather]) return cue.weather;
  for (const [tag, pattern] of WEATHER_WORDS) if (pattern.test(cue.text)) return tag;
  return null;
}

/** What kind of line this is, for choosing a reply pool. First match wins; see the order below. */
export function replyCategory(cue: ReplyCue): ReplyCategory {
  const text = cue.text.trim();
  switch (cue.kind) {
    case "animal": return "animal";
    case "riddle": return "riddle";
    case "stumped": return "stumped";
    case "bye": return "bye";
    default: break;
  }
  if (FILLER.test(text)) return "filler";
  if (cue.event) {
    if (BAD_NEWS_EVENTS.has(cue.event)) return "news_bad";
    if (THANKS_EVENTS.has(cue.event)) return "thanks";
    if (LOW_EVENTS.has(cue.event)) return "low";
    return "news_good";
  }
  if (/\bthank/i.test(text)) return "thanks";
  if (text.includes("?")) {
    if (HOW_ARE_YOU.test(text)) return "how_are_you";
    if (FOOD.test(text)) return "food";
    if (EITHER_OR.test(text)) return "either_or";
    if (WH.test(text)) return "wh_question";
    if (cue.kind !== "ctx") return "question";
  }
  const low = cue.mood === "glum" || cue.mood === "low";
  const high = cue.mood === "bright" || cue.mood === "glowing";
  if (cue.kind === "greet") return low ? "greet_low" : high ? "greet_high" : "greet";
  if (cue.kind === "ctx" || cue.weather || cue.zone) {
    if (weatherOf(cue)) return "weather";
    if (cue.zone && ZONE_REPLIES[cue.zone]) return "place";
  }
  if (low || LOW_WORDS.test(text)) return "low";
  if (high || text.includes("!")) return "high";
  if (text.includes("?")) return WH.test(text) ? "wh_question" : "question";
  return "statement";
}

/** FNV-1a: a small, stable string hash for picking variants. */
export function replyHash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function poolFor(cue: ReplyCue, category: ReplyCategory): Pool {
  if (category === "weather") {
    const tag = weatherOf(cue);
    if (tag) return WEATHER_REPLIES[tag]!;
  }
  if (category === "place" && cue.zone && ZONE_REPLIES[cue.zone]) return ZONE_REPLIES[cue.zone]!;
  return REPLY_POOLS[category];
}

/**
 * Three replies to a line, in a fixed tone order (warm, curious, wry), so "1" is always the kind one.
 * The variant in each tone is chosen by a hash of the line and `seed`, so a line gets the same replies every
 * time it is shown in the same place. Weather and zone replies mix their own line with the general pool.
 */
export function derivedReplies(cue: ReplyCue, seed = 0): Reply[] {
  const category = replyCategory(cue);
  const pool = poolFor(cue, category);
  const general = REPLY_POOLS[category];
  const h = replyHash(`${cue.text}|${seed}`);
  const choose = (tone: keyof Pool, shift: number): Reply => {
    const options = pool === general ? pool[tone] : [...pool[tone], ...general[tone]];
    // Prefer the specific (weather/zone) reply most of the time; it is first in the list.
    const index = pool !== general && ((h >>> shift) & 3) !== 0 ? 0 : (h >>> (shift + 2)) % options.length;
    return { ...options[index]! };
  };
  return [choose("warm", 0), choose("curious", 8), choose("wry", 16)];
}

const TITLES = new Set(["captain", "mayor", "doctor", "dr", "mr", "mrs", "ms", "miss", "father", "sister", "reverend"]);
/**
 * What the Fellow calls a resident: the quoted nickname if the card has one ("June"), a title with the surname
 * ("Captain Reyes"), else the first name.
 */
export function callName(fullName: string): string {
  const nick = /"([^"]+)"/.exec(fullName)?.[1];
  if (nick) return nick;
  const words = fullName.trim().split(/\s+/);
  if (words.length > 1 && TITLES.has(words[0]!.toLowerCase().replace(/\.$/, ""))) return `${words[0]} ${words.at(-1)}`;
  return words[0] ?? fullName;
}

/** Fill `{name}` (the resident's first name) and `{player}`; without a name, ", {name}" and "{name}. " drop out. */
export function fillReply(text: string, vars: { name?: string | null; player?: string | null }): string {
  let out = text;
  if (vars.name) out = out.replaceAll("{name}", vars.name);
  else out = out.replace(/,\s*\{name\}/g, "").replace(/\{name\}[.,]?\s*/g, "");
  if (vars.player) out = out.replaceAll("{player}", vars.player);
  else out = out.replace(/,\s*\{player\}/g, "").replace(/\{player\}[.,]?\s*/g, "");
  out = out.trim();
  return out ? out.charAt(0).toUpperCase() + out.slice(1) : out;
}

export interface ChoiceLike { id?: string; text: string; intent: Intent }
export interface NormalizedChoice { id: string; text: string; intent: Intent }

/** The bare "Leave": the panel's own button, never one of the numbered replies. */
export const isBareLeave = (choice: Pick<ChoiceLike, "text">): boolean =>
  /^\(?\s*leave\s*\.?\)?$/i.test(choice.text.trim());

const sameText = (text: string): string => text.toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}']+/gu, " ").trim();

/** A pad's id says what Quiet Mode should answer it with (`news…` asks for the news). Fits the server's 8. */
export const replyId = (reply: Pick<Reply, "next">, n: number): string => `${reply.next === "ctx" ? "news" : "talk"}${n}`;

/**
 * Every turn's replies (§9.10: 2–3 plus Leave): whitespace tidied, empty and bare-"Leave" entries and repeats
 * dropped, at most one goodbye (intent leave), at most three, and at least two, padded with replies derived
 * from the resident's last line (`cue`). Ids are kept when given; pads get `replyId`s.
 */
export function normalizeChoices(
  choices: readonly ChoiceLike[],
  opts: { cue?: ReplyCue | null; name?: string | null; seed?: number; four?: boolean } = {},
): NormalizedChoice[] {
  const out: NormalizedChoice[] = [];
  const seen = new Set<string>();
  const add = (choice: ChoiceLike, id: string): void => {
    const text = choice.text.replace(/\s+/g, " ").trim();
    const key = sameText(text);
    if (!text || !key || isBareLeave({ text }) || seen.has(key) || out.length >= (opts.four ? 4 : MAX_REPLIES)) return;
    if (choice.intent === "leave" && out.some((c) => c.intent === "leave")) return;
    seen.add(key);
    out.push({ id, text, intent: choice.intent });
  };
  choices.forEach((choice, i) => add(choice, choice.id?.trim() || `p${i + 1}`));
  if (out.length < (opts.four ? 4 : MIN_REPLIES)) {
    const cue = opts.cue ?? { text: "" };
    const pads = [...derivedReplies(cue, opts.seed ?? 0), ...derivedReplies({ text: "" }, opts.seed ?? 0)];
    let n = 1;
    for (const pad of pads) {
      if (out.length >= (opts.four ? 4 : MIN_REPLIES)) break;
      add({ text: fillReply(pad.text, { name: opts.name }), intent: pad.intent }, replyId(pad, n++));
    }
  }
  return out;
}
