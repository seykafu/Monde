import { isFerryDay } from '../town/migration';
import { canFindAnswer, type WorldRiddleFacts } from '../riddles/worldRules';
import { Inventory } from '@monde/shared';
import { regardFor } from './friendship';
import type Phaser from 'phaser';
import type { Clock } from '../sim/clock';
import type { ZoneDef } from '../world/zoneFormat';
import { available, riddle, type MarkSite } from '../riddles/engine';
import { findMark, markContext, marks, refreshHints, submitMark } from './riddles';
import { openPeople } from './PeopleScene';
/** Structural adapter until the board agent's typed accessor lands; no renderer ownership here. */
export function markSites(zone: ZoneDef): MarkSite[] {
  const loaded = zone as unknown as { marks?: readonly MarkSite[]; town?: { props: readonly { mark?: string; at: readonly [number, number] }[] } };
  if (loaded.marks) return [...loaded.marks];
  const placed = (loaded.town?.props ?? []).flatMap(p => p.mark ? [{ id: p.mark, zone: zone.id, at: p.at }] : []);
  if (placed.length) return placed;
  // GDD-GAP: temporary board integration: OQ-1 is on the cottage knocker (§14.1).
  // All other sites wait for authored mark props rather than inventing world coordinates.
  const cottage = zone.places.find(p => p.id === 'lamplighter_cottage');
  return cottage ? [{ id: 'OQ-1', zone: zone.id, at: cottage.door }] : [];
}
export function markInteraction(scene: Phaser.Scene, clock: Clock, zone: ZoneDef, position: { x: number; y: number }, weather: Pick<WorldRiddleFacts, 'weather' | 'wind'> = {}): (() => void) | undefined {
  refreshHints(scene.registry, clock);
  const state = marks(scene.registry), context = markContext(scene.registry, clock);
  // Tide, borrowed tools and the stair counter are provided by their object adapters when present.
  const extra = (scene.registry.get('monde.riddle.worldFacts') ?? {}) as Partial<WorldRiddleFacts>;
  const facts: WorldRiddleFacts = { ...extra, ...weather, ferryDay: isFerryDay(clock.day, { project_ferry_done: context.flags.has('project_ferry_done') }), flags: context.flags, minute: clock.minute,
    items: new Set([...(extra.items ?? []), ...Inventory.parse(scene.registry.get('monde.inventory') ?? {}).slots.flatMap(s => s ? [s.item] : [])]),
    regard: Object.fromEntries(['roz', 'odile', 'nell'].map(id => [id, regardFor(scene.registry, id)])) };
  const site = markSites(zone).find(s => {
    const prev = riddle(s.id)?.previous;
    const canFindPrevious = prev && state.entries[prev]?.status === 'found' && available(state, prev, context) && canFindAnswer(prev, facts);
    return (!state.entries[s.id] && available(state, s.id, context) || canFindPrevious) && Math.hypot(s.at[0] + 0.5 - position.x, s.at[1] + 0.5 - position.y) <= 1.5; });
  return site ? () => {
    const prev = riddle(site.id)?.previous;
    if (prev && canFindAnswer(prev, facts)) submitMark(scene.registry, clock, prev, '', 'found');
    findMark(scene.registry, clock, site.id); openPeople(scene, clock, 'Marks'); } : undefined;
}
