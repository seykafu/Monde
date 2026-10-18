/**
 * Quest-aware conversations (Kasey's playtest, 2026-10-18): key characters help the Fellow find the main story.
 *
 * The client reports the player's objective (the HUD's Next hint) and this resident's open threads with every turn
 * (shared TalkQuest). This module decides what of it the resident hears, as the `<quest>` element of block 4 (never
 * blocks 1-3, which must stay byte-stable for caching), and which quest topic card the opener or a lull may use.
 *
 * The objective is only for residents it involves, or when the Fellow asks:
 *   involved  a key character in the scene's cast or leading the Project that opens, or the place is their home
 *             or workplace: the line is there every turn, framed as background ("if they seem unsure what to do…");
 *   asked     anyone, on a turn where the Fellow's own words ask what to do or where to go (asksWhatToDo);
 *   intent    anyone, when the Fellow picked the "What should I be doing?" / "About the clocktower…" reply
 *             (intent about_quest), with a focus directive to help with directions (promptBuilder FOCUS_DIRECTIVES).
 * Everyone else never hears it: an always-on clocktower fact made residents drag the clock into unrelated answers
 * (blind A/B eval, 2026-10-16; townState.ts). A resident's own threads (their Favor, their Project) come with it,
 * and bring the element on their own: they are the resident's business. A Mark thread only rides along.
 *
 * Only the hint's words reach the model (where, when, the reason): never the cast list, a scene's lines, a secret or a
 * riddle's title. Pure: no I/O; promptBuilder.ts escapes and frames the lines.
 */
import { questInvolvement, type PersonaCard, type QuestObjective, type TalkQuest } from "@monde/shared";

type QuestCard = Pick<PersonaCard, "id" | "kind" | "home" | "workplace" | "generated_by" | "curated">;

// ---------------------------------------------------------------------------------------------------------------
// Did the Fellow ask what to do?
// ---------------------------------------------------------------------------------------------------------------

/**
 * Direction-asking, in the Fellow's own words. Each pattern is narrow on purpose: advice about something ("What
 * should I do about Rook?"), an offer of help ("Need any help?", "Anything I can do for you?") and a question about
 * the resident's own day ("Where do you go on Sundays?") are ordinary replies, not requests for the next beat.
 */
const ASKS: readonly RegExp[] = [
  // "What should I do?", "What should I be doing now?", "what do I do next", "What am I supposed to be doing?"
  /\bwhat (?:should|shall|do|can|could|must|ought) i (?:be )?(?:do|doing)\b(?!\s+(?:about|for (?:you|him|her|them)|with (?:him|her|them|it|this|that))\b)/,
  /\bwhat am i (?:supposed|meant|expected) to (?:be )?(?:do|doing)\b(?!\s+(?:about|for (?:you|him|her|them)|with (?:him|her|them|it|this|that))\b)/,
  // "Where should I go?", "where do I go next", "Where am I supposed to be?"
  /\bwhere (?:should|shall|do|can|could|must|ought) i (?:go|be|head|start)\b/,
  /\bwhere am i (?:supposed|meant|expected) to (?:go|be)\b/,
  /\bwhere (?:to|now)\b[?!.\s]*$/,
  /\bwhere (?:to )?next\b/,
  // "What's next?", "what now?", "what comes next" (not "what's next to the bakery")
  /\bwhat(?:'s| is| comes| happens)? next\b(?!\s+(?:to|door)\b)/,
  /\bwhat now\b/,
  // "Any work?", "Got any jobs for me?", "anything that needs doing?"
  /\bany (?:work|jobs?|tasks?|errands?)\b/,
  /\b(?:anything|something) (?:i (?:can|could|should) do|for me to do|to do|that needs doing)\b(?!\s+for you\b)/,
  // "Can you help me?", "Help me out", "I need help"; not "help me understand…"
  /\bhelp me\b(?!\s+(?:understand|with your|carry|lift))/,
  /\bi need (?:some )?(?:help|direction|directions)\b/,
  // "I'm lost", "I'm stuck"
  /\bi(?:'m| am) (?:a bit |quite |so )?(?:lost|stuck)\b/,
  // "Who should I see?", "who should I talk to next"
  /\bwho (?:should|shall|do|can) i (?:see|talk to|speak to|meet|find|ask|look for)\b/,
  // "What's happening today?", "What's on this afternoon?", "anything going on tonight?"
  /\bwhat(?:'s| is) (?:happening|going on|on)\b(?:\s+(?:in town|around here))?\s+(?:today|tonight|this (?:morning|afternoon|evening))\b/,
  /\b(?:anything|something) (?:happening|going on)\b(?:\s+(?:in town|around here))?\s+(?:today|tonight|this (?:morning|afternoon|evening))\b/,
  /\bam i (?:expected|wanted|needed) (?:somewhere|anywhere)\b/,
];

/** True when the Fellow's words ask what to do or where to go. Cheap regexes; null and "" are false. */
export function asksWhatToDo(text: string | null | undefined): boolean {
  if (!text) return false;
  const said = text.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
  return said !== "" && ASKS.some((pattern) => pattern.test(said));
}

// ---------------------------------------------------------------------------------------------------------------
// The lines
// ---------------------------------------------------------------------------------------------------------------

export interface QuestAsk {
  /** The Fellow asked what to do in their own words this turn (asksWhatToDo). */
  asked: boolean;
  /** The Fellow picked an about_quest reply (focus "quest"). */
  intent: boolean;
}

const sentence = (text: string): string => {
  const t = text.replace(/\s+/g, " ").trim();
  return /[.!?…"”)]$/.test(t) ? t : `${t}.`;
};

/** What the Fellow's Journal says they could do next, as one line for this resident. */
function objectiveLine(objective: QuestObjective, place: ReturnType<typeof questInvolvement>, ask: QuestAsk): string {
  const at = `The Fellow is expected ${objective.when} at ${objective.where}. Their Journal says: "${sentence(objective.reason)}"`;
  const yours = place === "workplace" ? " That's your workplace." : place === "home" ? " That's your home." : "";
  const use = ask.asked || ask.intent
    ? " They're asking what to do: point them there in your own words."
    : " If they seem unsure what to do, point them there in your own words.";
  return `${at}${yours}${use}`;
}

/**
 * The `<quest>` lines for this turn (unescaped; promptBuilder.ts escapes and frames them), or [] when the resident
 * hears nothing: no objective that involves them, no thread of their own, and the Fellow didn't ask.
 */
export function questLines(quest: TalkQuest | null | undefined, card: QuestCard, ask: QuestAsk): string[] {
  // No report at all (a scripted scene's handoff, or an older client): nothing to say, even when asked.
  if (!quest || card.kind === "animal") return [];
  const { objective, threads } = quest;
  const place = questInvolvement(objective, card);
  const asking = ask.asked || ask.intent;
  const own = threads.some((t) => t.kind === "favor" || t.kind === "project");
  if (!place && !asking && !own) return [];
  const lines: string[] = [];
  if (objective && (place || asking)) lines.push(objectiveLine(objective, place, ask));
  else if (!objective && asking) {
    lines.push("Nothing in particular is expected of the Fellow for the rest of today. Suggest something ordinary from your own day or the town; don't invent an event.");
  }
  for (const thread of threads) {
    if (thread.kind === "project") lines.push(`Your Project, ${thread.name}. What it needs next: ${sentence(thread.next)}`);
    else if (thread.kind === "favor") lines.push(`The Favor you asked of them, which they took on (until Day ${thread.until}): "${sentence(thread.text)}"`);
    else lines.push("They have an unsolved Mark, one of the town's riddle plaques. You can help with a Mark only when they ask you about it; never guess at an answer.");
  }
  return lines;
}

/**
 * One quest topic card for the opener or a lull (retrieval.ts topicCards), or null: the beat the resident is in,
 * else their Project's next step, else the Favor they're waiting on.
 */
export function questTopic(quest: TalkQuest | null | undefined, card: QuestCard): string | null {
  if (!quest || card.kind === "animal") return null;
  const objective = quest.objective;
  if (objective && questInvolvement(objective, card)) {
    return `where the Fellow is expected: ${objective.where}, ${objective.when} ("${sentence(objective.reason)}")`;
  }
  const project = quest.threads.find((t) => t.kind === "project");
  if (project?.kind === "project") return `your Project, ${project.name}: ${sentence(project.next)}`;
  const favor = quest.threads.find((t) => t.kind === "favor");
  if (favor?.kind === "favor") return `the Favor the Fellow took on for you: "${sentence(favor.text)}"`;
  return null;
}
