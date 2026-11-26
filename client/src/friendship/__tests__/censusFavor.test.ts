import type Phaser from 'phaser';
import { expect, it, vi } from 'vitest';
import { emptyFriendship } from '@monde/shared';
import { createTownState } from '../../town/pillars';
vi.mock('phaser', () => import('../../qa/__tests__/phaserStub'));
const { leavingFavors, localLastChances, favorBook } = await import('../favors');

it('offers Malachy a Last Chance for roots using his census tenure and living ties', () => {
  const town = createTownState();
  town.migration.notices.malachy_wakefield = 6;
  const entries = new Map<string, unknown>([['monde.town', town], ['monde.friendship', emptyFriendship()]]);
  const registry = entries as unknown as Phaser.Data.DataManager;
  const notice = leavingFavors(registry, 6)[0]!;
  expect(notice).toMatchObject({ resident: 'malachy_wakefield', deadline: 8, factors: { purpose: 10, friends: 5 } });
  expect(notice.factors.roots).toBeCloseTo(2.05);
  localLastChances(registry, 6);
  expect(favorBook(registry)[0]?.task.stayFactor).toBe('roots');
});

it.each(['sleep', 'dev hour jump'])('prints a Day-9 dawn notice in the Day-10 paper after a %s', async mode => {
  const { BotRegistry } = await import('../../qa/springBot');
  const { Clock } = await import('../../sim/clock');
  const { attachTown, getTown } = await import('../../scenes/TownLedgerScene');
  const { attachMigration } = await import('../../scenes/migration');
  const { attachDawnSync, getFriendship } = await import('../../scenes/friendship');
  const { getEventLog } = await import('../../scenes/events');
  const { sendable } = await import('../../mind/events');
  const { hudThreadsNow } = await import('../../quests/runtime');
  const registry = new BotRegistry() as unknown as Phaser.Data.DataManager;
  const clock = new Clock({ day: 8, minute: 22 * 60 });
  registry.set('monde.clock', clock);
  attachTown(registry, clock);
  attachMigration(registry, clock);
  attachDawnSync(registry, clock, { weatherSeed: () => 1, town: () => getTown(registry) });
  if (mode === 'sleep') clock.startNextDay();
  else for (let n = 0; n < 5; n++) clock.advanceMinutes(60); // ZoneScene's ] handler
  const id = 'leaving_notice_fenna_renard_9';
  const headline = "Fenna Renard is weighing Friday's ferry.";
  const log = getEventLog(registry);
  expect(sendable(log, 8).some(e => e.id === id)).toBe(false);
  expect(sendable(log, 9).find(e => e.id === id)).toMatchObject({ day: 9, minute: 360, summary: headline });
  expect(getFriendship(registry).papers.find(p => p.day === 9)?.event_ids).not.toContain(id);
  const hud = hudThreadsNow(registry, {});
  expect(hud.tasks.find(t => t.kind === 'offer' && t.people.includes('fenna_renard'))?.title).toBe(headline.slice(0, -1));
  expect(hud.objectives.meanwhile).toMatchObject({ title: 'Talk to Fenna', reason: "Fenna is weighing Friday's ferry." });
  clock.startNextDay();
  expect(getFriendship(registry).papers.find(p => p.day === 10)).toMatchObject({ headline, stories: [expect.objectContaining({ event_id: id }), expect.anything()] });
  clock.startNextDay();
  clock.advanceMinutes(209);
  const departures = () => getEventLog(registry).outbox.filter(e => e.kind === 'town_event' && e.type === 'departure');
  expect(departures()).toHaveLength(0);
  clock.advanceMinutes(1);
  expect(departures()).toMatchObject([{ day: 11, minute: 570, summary: 'Fenna Renard left on the Gannet.' }]);
});
