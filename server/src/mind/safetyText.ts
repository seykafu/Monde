/** Keep rejected input in the private turn record, never in future resident prompts or summaries. */
export function safePlayerText(turn: { playerInput: string | null; promptUser?: string | null }): string | null {
  return turn.promptUser?.includes('[The resident redirected the conversation.]') ? '[The resident redirected the conversation.]' : turn.playerInput;
}
