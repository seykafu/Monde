import { SPRING_RIDDLES } from '@monde/shared';
import type { TalkChoice } from './types';

/** The player's Mark reply uses the inscription's title, while routing stays unchanged. */
export function markReply(id: string): TalkChoice {
  const record = SPRING_RIDDLES.find(r => r.id === id);
  const title = record && record.title !== id ? record.title : 'that Mark';
  return { id: 'mark', text: `About ${title}…`, intent: 'about_riddle' };
}
