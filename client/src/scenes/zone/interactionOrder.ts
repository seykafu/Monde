// E chooses the scuffle, Mark, unlocked door, place action, conversation, then a message or place name.
// Q always talks to the nearby resident, whatever E does.

interface Action { label: string; run(): void }
type Candidate = Action | null | undefined;

interface InteractionChoice { label: string; run: (() => void) | undefined }

export function chooseInteraction(options: {
  scuffle: Candidate; mark: Candidate; door: Candidate; placeAction: Candidate;
  talk: Candidate; message: Candidate; ask: boolean;
}): InteractionChoice {
  const { scuffle, mark, door, placeAction, talk, message, ask } = options;
  const primary = scuffle ?? mark ?? door ?? placeAction ?? talk ?? message;
  let label = primary?.label ?? '';
  if (talk && talk !== primary) label += `  ·  Q: ${talk.label}`;
  if (talk && ask) label += '  ·  H: Ask about the Projects';
  return { label, run: primary?.run };
}
