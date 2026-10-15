/**
 * Mood → portrait (GDD §9.4): the model picks an expression per line; if the card doesn't have it, the engine
 * maps one from the resident's current emotion.
 */
import { PORTRAIT_SET, toPortraitExpression, type Emotion, type PersonaCard } from "@monde/shared";

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

/** Enough of a card to choose its portraits; kind defaults to a person. */
type PortraitCard = Pick<PersonaCard, "portrait_expressions"> & { kind?: PersonaCard["kind"] };

/** The expressions offered to the model: the six portraits (GDD §16.2), or the card's own list for animals. */
export function promptExpressions(card: PortraitCard): readonly string[] {
  return card.kind === "animal" ? card.portrait_expressions : PORTRAIT_SET;
}

/** The emotion's portrait for this card (always one of the six for people). */
export function expressionFor(card: PortraitCard, emotion: Emotion): string {
  if (card.kind === "animal") {
    const mapped = EMOTION_EXPRESSION[emotion];
    return card.portrait_expressions.includes(mapped) ? mapped : (card.portrait_expressions[0] ?? "neutral");
  }
  return EMOTION_EXPRESSION[emotion];
}

/** Normalize a model-chosen expression onto the six portraits; unmappable ones come from the emotion. */
export function checkedExpression(card: PortraitCard, expr: string, emotion: Emotion): string {
  if (card.kind === "animal") return card.portrait_expressions.includes(expr) ? expr : expressionFor(card, emotion);
  return toPortraitExpression(expr) ?? expressionFor(card, emotion);
}
