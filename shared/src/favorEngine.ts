import { z } from 'zod';
import { FavorRequest, MVP_FAVOR_TEMPLATES } from './favor';

export const LeavingFavorNotice = z.object({ resident: z.string(), deadline: z.number().int().positive(), factors: z.object({ town: z.number().min(0).max(60), friends: z.number().min(0).max(20), purpose: z.number().min(0).max(10), roots: z.number().min(0).max(10) }) });
export type LeavingFavorNotice = z.infer<typeof LeavingFavorNotice>;

export const FavorTask = z.object({
  kind: z.enum(['handover', 'delivery', 'find', 'introduce', 'chore']),
  place: z.string(), item: z.string().nullable(), recipient: z.string(), minutes: z.number().int().nonnegative(),
  stayFactor: z.enum(['town', 'friends', 'purpose', 'roots']).nullable(),
});
export const FavorReward = z.object({ regard: z.number().int().min(5).max(15), coins: z.number().int().nonnegative(), items: z.array(z.object({ item: z.string(), count: z.number().int().positive() })), dream: z.string().nullable() });
export const Favor = z.object({
  id: z.string(), resident_id: z.string(), template: FavorRequest.shape.template, target: z.string(), text: z.string(),
  created_day: z.number().int(), expires_day: z.number().int(),
  status: z.enum(['proposed', 'accepted', 'completed', 'expired', 'declined']),
  notice: LeavingFavorNotice.optional(),
  task: FavorTask, reward: FavorReward, found: z.boolean().default(false),
});
export type Favor = z.infer<typeof Favor>;
export interface FavorWorld {
  day: number;
  items: ReadonlySet<string>;
  residents: ReadonlyMap<string, { home: string; reachable: boolean }>;
  places: ReadonlySet<string>;
  met: (a: string, b: string) => boolean;
  leaving?: ReadonlyMap<string, { deadline: number; factors: Record<'town' | 'friends' | 'purpose' | 'roots', number> }>;
}
/** The model never supplies rewards or task parameters. Unknown targets are rejected, never silently reworded. */
export function instantiateFavor(request: FavorRequest, id: string, owner: string, world: FavorWorld): Favor | null {
  const resident = world.residents.get(owner);
  if (!resident?.reachable || !world.places.has(resident.home) || !MVP_FAVOR_TEMPLATES.includes(request.template)) return null;
  const task: Favor['task'] = { kind: 'handover', place: resident.home, item: null, recipient: owner, minutes: 0, stayFactor: null };
  let expires = world.day + 5;
  switch (request.template) {
    case 'fetch': case 'find':
      if (!world.items.has(request.target)) return null;
      task.kind = request.template === 'find' ? 'find' : 'handover'; task.item = request.target; break;
    case 'deliver': case 'introduce': {
      const target = world.residents.get(request.target);
      if (request.target === owner || !target?.reachable || !world.places.has(target.home)) return null;
      if (request.template === 'introduce' && world.met(owner, request.target)) return null;
      task.kind = request.template === 'deliver' ? 'delivery' : 'introduce';
      task.recipient = request.target; task.place = target.home;
      if (task.kind === 'delivery') { task.item = [...world.items].sort()[0] ?? null; if (!task.item) return null; }
      break;
    }
    case 'help_chore':
      if (request.target !== owner && request.target !== resident.home) return null;
      task.kind = 'chore'; task.minutes = 30; break;
    case 'last_chance': {
      const notice = world.leaving?.get(owner); if (!notice || notice.deadline < world.day) return null;
      expires = notice.deadline;
      task.stayFactor = (Object.entries(notice.factors).sort((a,b) => a[1] - b[1])[0]![0]) as NonNullable<Favor['task']['stayFactor']>;
      // GDD-GAP: jobs, roof repairs and roots have no authored Last Chance tasks yet; use a 30-minute home chore.
      task.kind = 'chore'; task.minutes = 30;
      if (task.stayFactor === 'friends') {
        const other = [...world.residents].sort(([a],[b]) => a.localeCompare(b)).find(([key, r]) => key !== owner && r.reachable && world.places.has(r.home) && !world.met(owner, key));
        if (!other) return null; task.kind = 'introduce'; task.recipient = other[0]; task.minutes = 0;
      }
      break;
    }
    default: return null;
  }
  // GDD-GAP: per-template rewards aren't specified. Use +10 Regard, 10 coins for chores, a posy for finds, no unverified dream advancement.
  return { ...request, id, resident_id: owner, created_day: world.day, expires_day: expires, status: 'proposed', task,
    ...(request.template === 'last_chance' ? { notice: { resident:owner,...world.leaving!.get(owner)! } } : {}),
    reward: { regard: 10, coins: task.kind === 'chore' ? 10 : 0, items: request.template === 'find' && world.items.has('flowers') ? [{ item:'flowers',count:1 }] : [], dream: null }, found: false };
}
export const expireFavor = (f: Favor, day: number): Favor => day > f.expires_day && ['proposed', 'accepted'].includes(f.status) ? { ...f, status: 'expired' } : f;
export function acceptFavor(f: Favor, day: number, open: readonly Favor[]): Favor | null {
  if (f.status !== 'proposed' || day > f.expires_day || open.filter(x => x.status === 'accepted').length >= 6 || open.some(x => x.id !== f.id && x.resident_id === f.resident_id && x.status === 'accepted')) return null;
  return { ...f, status: 'accepted' };
}
export const FavorProof = z.object({ kind: FavorTask.shape.kind, place: z.string(), resident: z.string(), item: z.string().nullable(), nearby: z.array(z.string()), minutes: z.number().int().nonnegative(), found: z.boolean() });
export type FavorProof = z.infer<typeof FavorProof>;
export function canCompleteFavor(f: Favor, day: number, p: FavorProof): boolean {
  if (f.status !== 'accepted' || day < f.created_day || day > f.expires_day || p.kind !== f.task.kind) return false;
  switch (f.task.kind) {
    case 'handover': return p.resident === f.resident_id && p.item === f.task.item;
    case 'find': return p.resident === f.resident_id && p.item === f.task.item && f.found;
    case 'delivery': return p.resident === f.task.recipient && p.item === f.task.item;
    case 'introduce': return p.resident === f.resident_id && p.nearby.includes(f.task.recipient);
    case 'chore': return p.place === f.task.place && p.minutes >= f.task.minutes;
  }
}

