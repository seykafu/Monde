import { z } from 'zod';
import type { GiftReaction } from './friendship';
import type { Skills, SkillId } from './player';

export const BAG_SLOTS = 24;
export const Item = z.object({ id: z.string().regex(/^[a-z][a-z0-9_]*$/), name: z.string().min(1), description: z.string().min(1), tags: z.array(z.string().min(1)).min(1), stack: z.number().int().positive(), stamina: z.number().int().nonnegative(), price: z.number().int().nonnegative() });
export type Item = z.infer<typeof Item>;
export const ItemCatalog = z.array(Item).refine(items => new Set(items.map(i => i.id)).size === items.length, 'duplicate item id');
export const Stack = z.object({ item: z.string().min(1), count: z.number().int().positive() });
export type Stack = z.infer<typeof Stack>;
export const Inventory = z.object({ slots: z.array(Stack.nullable()).length(BAG_SLOTS).default(() => Array.from({ length: BAG_SLOTS }, () => null)) }).strict();
export type Inventory = z.infer<typeof Inventory>;
export const Wallet = z.object({ balance: z.number().int().nonnegative().default(0) }).strict();
export const Economy = z.object({ stamina: z.number().min(0).max(110).default(100), maxStamina: z.number().min(100).max(110).default(100), day: z.number().int().positive().default(1), gifts: z.record(z.string(), z.number().int().positive()).default({}), work: z.record(z.string(), z.number().int().nonnegative()).default({}) });
export type Economy = z.infer<typeof Economy>;
export const emptyEconomy = (): Economy => Economy.parse({});

/** GDD-GAP: whole normalized tag phrases match inside preferences; dislikes win, two distinct liked tags = love, one = like. No model judgment. */
export function matchGift(item: Pick<Item, 'tags'>, card: { likes: readonly string[]; dislikes: readonly string[] }): GiftReaction {
  const normalize = (s: string) => ` ${s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
  const hits = (preferences: readonly string[]) => new Set(item.tags.filter(tag => preferences.some(p => normalize(p).includes(normalize(tag))))).size;
  if (hits(card.dislikes)) return 'dislike';
  const liked = hits(card.likes);
  return liked >= 2 ? 'love' : liked ? 'like' : 'neutral';
}
/** Missing birthdays confer no bonus; birthdays repeat on the 100-day calendar (§3.2). */
export const isBirthday = (day: number, birthday?: number): boolean => birthday !== undefined && (day - 1) % 100 + 1 === birthday;
export const canGift = (state: Economy, resident: string, day: number): boolean => (state.gifts[resident] ?? 0) < day;

export interface CommunityTask { id: string; name: string; place: string; opens: number; stamina: number; minutes: number; pay: number; pillar: 'charm' | 'spirit' | 'prosperity'; effect: number; skill: SkillId; xp: number }
/** GDD-GAP: MVP names no six; select the six early paid Pillar jobs. XP is 10 per completed job; assignments except Library Wits are provisional. Litter uses harbor_steps. */
export const COMMUNITY_TASKS: readonly CommunityTask[] = [
  { id: 'sweep', name: 'Sweep Market Row', place: 'market_row.market_street', opens: 1, stamina: 10, minutes: 60, pay: 15, pillar: 'charm', effect: 0.5, skill: 'handiwork', xp: 10 },
  { id: 'litter', name: 'Pick up litter', place: 'wharf.harbor_steps', opens: 3, stamina: 8, minutes: 45, pay: 10, pillar: 'charm', effect: 0.4, skill: 'handiwork', xp: 10 },
  { id: 'mail', name: 'Mail Round', place: 'wharf.ticket_booth', opens: 2, stamina: 10, minutes: 45, pay: 20, pillar: 'spirit', effect: 0.3, skill: 'heart', xp: 10 },
  { id: 'library', name: 'Library Returns', place: 'old_quarter.library', opens: 2, stamina: 8, minutes: 40, pay: 12, pillar: 'charm', effect: 0.2, skill: 'wits', xp: 10 },
  { id: 'nets', name: 'Mend nets', place: 'wharf.fish_market', opens: 8, stamina: 12, minutes: 60, pay: 25, pillar: 'prosperity', effect: 0.3, skill: 'handiwork', xp: 10 },
  { id: 'weeding', name: 'Weed the garden', place: 'commons.community_garden', opens: 8, stamina: 12, minutes: 60, pay: 15, pillar: 'charm', effect: 0.4, skill: 'handiwork', xp: 10 },
];
/** GDD-GAP: each next level costs 100 × current level XP; XP is progress within the level. */
export function gainXp(skills: Skills, skill: SkillId, amount: number): Skills {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Invalid XP');
  let { level, xp } = skills[skill]; xp += amount;
  while (level < 10 && xp >= level * 100) { xp -= level * 100; level++; }
  return { ...skills, [skill]: { level, xp: level === 10 ? 0 : xp } };
}
export function skillPerks(s: Skills) {
  return { repairTimeMultiplier: s.handiwork.level >= 3 ? 0.5 : 1, homeMaterialMultiplier: s.handiwork.level >= 5 ? 0.8 : 1,
    restoreHomeInOneDay: s.handiwork.level >= 8, immediateFirstHint: s.wits.level >= 3, markSparkleTiles: s.wits.level >= 5 ? 8 : null,
    freeSecondHintPerChain: s.wits.level >= 7, regardGainMultiplier: s.heart.level >= 3 ? 1.15 : 1, dialogueChoices: s.heart.level >= 5 ? 4 : 3,
    talkDownBonus: s.heart.level >= 7 ? 0.2 : 0, residentsSeekPlayer: s.heart.level >= 9, gritBonus: s.grit.level >= 2 ? 5 : 0,
    readyCounterMultiplier: s.grit.level >= 4 ? 1.25 : 1, secondWindAtFraction: s.grit.level >= 6 ? 0.25 : null, apBonus: s.grit.level >= 8 ? 1 : 0 };
}
