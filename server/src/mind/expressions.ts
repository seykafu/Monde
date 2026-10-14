/**
 * Mood → portrait (GDD §9.4): the model picks an expression per line; if the card doesn't have it, the engine
 * maps one from the resident's current emotion.
 */
import type { Emotion, PersonaCard } from "@monde/shared";

export const EMOTION_EXPRESSION: Readonly<Record<Emotion, string>> = {
  content: "neutral",
  cheerful: "warm",
  excited: "warm",
  tender: "warm",
  wistful: "sad",
  sad: "sad",
  anxious: "worried",
  irritated: "angry",
  angry: "angry",
  embarrassed: "surprised",
};

/** The emotion's expression if the card has it, else "neutral", else the card's first expression. */
export function expressionFor(card: Pick<PersonaCard, "portrait_expressions">, emotion: Emotion): string {
  const available = card.portrait_expressions;
  const mapped = EMOTION_EXPRESSION[emotion];
  if (available.includes(mapped)) return mapped;
  return available.includes("neutral") ? "neutral" : available[0]!;
}

/** Keep a valid expression; map anything else from the emotion. */
export function checkedExpression(card: Pick<PersonaCard, "portrait_expressions">, expr: string, emotion: Emotion): string {
  return card.portrait_expressions.includes(expr) ? expr : expressionFor(card, emotion);
}
