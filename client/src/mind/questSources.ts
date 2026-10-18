// The running game's side of quest-aware conversations (mind/questTalk.ts): the objective the HUD's Next hint shows
// (the story's hint, else a Project opening today, as ZoneScene.refreshHint picks them), who it involves, and this
// resident's threads from the Journal's Favors, the Projects' next steps and the Marks log.
//
// No Phaser at runtime: the registry is anything with get/set (fellow/state RegistryLike), so this runs under vitest.
import { Inventory, type Favor, type PersonaCard, type SavedRiddles, type TalkQuest } from '@monde/shared';
import { PROJECTS } from '../projects/catalog';
import * as E from '../projects/engine';
import { isPlural } from '../projects/press';
import { capitalize, materialCount, projectName, projectsOf, residentName, siteFor, sitePlaceName, worldOf } from '../projects/runtime';
import { formatClock } from '../sim/clock';
import type { RegistryLike } from '../fellow/state';
import { HINT_KEY, type StoryHint } from '../story/hint';
import { ALL_SCENES } from '../story/session';
import { zones } from '../world/zones';
import { questContext, questObjective, questThreads } from './questTalk';

const CAST = new Map(ALL_SCENES.flatMap(s => (s.header ? [[s.id, s.header.cast] as const] : [])));

/**
 * A Project opening today, as the HUD's Next hint shows it when the story has nothing (projects/attach.ts hint): the
 * soonest ceremony still open, with its leads.
 */
export function projectOpening(registry: RegistryLike, now: { day: number; minute: number }, district: string): { hint: StoryHint; leads: readonly string[] } | null {
  let best: { hint: StoryHint; leads: readonly string[] } | null = null;
  for (const { def, progress } of E.begun(PROJECTS, projectsOf(registry))) {
    const c = progress.ceremony, site = siteFor(def, progress);
    if (!c || !site || c.day !== now.day || now.minute >= c.minute + E.CEREMONY_WINDOW || progress.opened !== null) continue;
    if (best && best.hint.start <= c.minute) continue;
    const [zoneId = ''] = site.place.split('.');
    const placeName = sitePlaceName(site.place), zoneName = zones[zoneId]?.name ?? zoneId;
    const open = now.minute >= c.minute, end = c.minute + E.CEREMONY_WINDOW;
    const where = zoneId === district ? placeName : `${placeName}, ${zoneName}`;
    const when = open ? `before ${formatClock(end)}` : `${formatClock(c.minute)}–${formatClock(end)}`;
    const named = projectName(def, progress);
    const reason = `${capitalize(named)} ${isPlural(named) ? 'open' : 'opens'}.`;
    best = {
      hint: { sceneId: `project:${def.id}`, place: site.place, placeName, zoneName, via: null, start: c.minute, end, open, summoned: false, reason, where, when, text: `${where}, ${when} — ${reason.replace(/\.$/, '')}` },
      leads: def.leads
    };
  }
  return best;
}

/** Every Project begun and not yet open, with its leads and the Ledger's next step (projects/ledgerPage.ts). */
export function projectSteps(registry: RegistryLike, now: { day: number; minute: number }): { name: string; leads: readonly string[]; next: string }[] {
  const world = worldOf(registry, now);
  const town = registry.get('monde.town') as { fund?: number } | undefined;
  const bag = Inventory.parse(registry.get('monde.inventory') ?? {});
  const carried = (item: string) => bag.slots.reduce((n, s) => n + (s?.item === item ? s.count : 0), 0);
  return E.begun(PROJECTS, projectsOf(registry)).filter(b => b.progress.opened === null).map(({ def, progress }) => ({
    name: projectName(def, progress),
    leads: def.leads,
    next: E.nextStep(def, progress, world, { fund: town?.fund ?? 0, carried, count: materialCount, placeName: sitePlaceName, residentName })
  }));
}

export interface QuestArgs {
  registry: RegistryLike;
  card: PersonaCard;
  day: number;
  minute: number;
  /** The player's district (the Next hint names places relative to it). */
  district: string;
  /** The Journal's Favors (friendship/favors favorBook). */
  favors: readonly Favor[];
  /** The Marks log (scenes/riddles marks). */
  marks: SavedRiddles;
}

/** The quest report for a live turn with this resident (shared TalkQuest), or null for the cat. */
export function talkQuest(a: QuestArgs): TalkQuest | null {
  const now = { day: a.day, minute: a.minute };
  const story = a.registry.get(HINT_KEY) as StoryHint | null | undefined;
  const opening = story ? null : projectOpening(a.registry, now, a.district);
  const hint = story ?? opening?.hint ?? null;
  const people = story ? CAST.get(story.sceneId) ?? [] : opening?.leads ?? [];
  const selected = a.marks.selected;
  const threads = questThreads(a.card.id, {
    day: a.day,
    favors: a.favors,
    projects: projectSteps(a.registry, now),
    openMark: !!selected && a.marks.entries[selected]?.status === 'found'
  });
  return questContext(a.card, questObjective(hint, people), threads);
}
