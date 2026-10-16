import { describe, it, expect } from 'vitest';
import { baseSkills, COMMUNITY_TASKS, Economy, Inventory, Wallet, gainXp, skillPerks, matchGift, canGift, giftRegard, isBirthday, migrateSave } from '@monde/shared';
import { addItem, removeItem, moveItem, emptyInventory, changeCoins } from '../inventory';
import { awakeMinute, sleep, mustPassOut, spendStamina, eat, completeWork } from '../rules';
import { items } from '../content';
import { createTownState } from '../../town/pillars';
import { collect } from '../../save/collect';
import { restore } from '../../save/restore';
import { Clock } from '../../sim/clock';
import { dailyWeather } from '../../sim/weather';
import { emptyQuietState } from '../../mind/quietMode';
import { emptyEventLog } from '@monde/shared';
const bun = items.find(i => i.id === 'bun')!;
const fresh = () => Economy.parse({});
describe('G-09 bag and coins', () => {
  it('stacks, splits, removes and merges without mutating input', () => {
    const empty = emptyInventory(); const bag = addItem(empty, bun, 25)!;
    expect(bag.slots.slice(0, 3)).toEqual([{ item: 'bun', count: 20 }, { item: 'bun', count: 5 }, null]);
    expect(empty.slots.every(s => s === null)).toBe(true);
    const less = removeItem(bag, 0, 10)!;
    const merged = moveItem(less, 1, 0, items);
    expect(merged.slots[0]?.count).toBe(15); expect(merged.slots[1]).toBeNull();
    expect(moveItem(merged, 0, 23, items).slots[23]?.count).toBe(15);
    expect(removeItem(bag, 1, 6)).toBeNull();
    expect(removeItem(bag, -1)).toBeNull();
  });
  it('rejects overfull bags and invalid quantities atomically', () => {
    const full = addItem(emptyInventory(), bun, 480)!;
    expect(addItem(full, bun)).toBeNull(); expect(addItem(emptyInventory(), bun, 481)).toBeNull();
    for (const n of [0, -1, 0.5, NaN, Infinity]) expect(addItem(full, bun, n)).toBeNull();
    expect(full.slots[23]?.count).toBe(20);
    expect(changeCoins(10, -11)).toBeNull(); expect(changeCoins(10, -10)).toBe(0); expect(changeCoins(10, 15)).toBe(25);
  });
});
describe('G-09 stamina and skills', () => {
  it('meals restore up to capacity; costs require stamina; midnight drains and 02:00 passes out', () => {
    const tired = spendStamina(fresh(), 90)!; expect(tired.stamina).toBe(10);
    expect(spendStamina(tired, 11)).toBeNull(); expect(eat(tired, 15).stamina).toBe(25);
    expect(eat(tired, 1000).stamina).toBe(100);
    expect(awakeMinute(tired, 1440).stamina).toBe(10); expect(awakeMinute(tired, 1441).stamina).toBe(9);
    expect(mustPassOut(1559)).toBe(false); expect(mustPassOut(1560)).toBe(true);
    expect(sleep(fresh(), 1, 1439)).toMatchObject({ day: 2, stamina: 110, maxStamina: 110, work: {} });
    expect(sleep(fresh(), 1, 1440).stamina).toBe(100); expect(sleep(fresh(), 1, 1560).stamina).toBe(70);
  });
  it('levels at exact thresholds, carries XP, caps at 10 and types each perk', () => {
    const base = baseSkills(); const level3 = gainXp(base, 'heart', 300);
    expect(level3.heart).toEqual({ level: 3, xp: 0 }); expect(base.heart.level).toBe(1);
    expect(skillPerks(level3).regardGainMultiplier).toBe(1.15);
    expect(gainXp(base, 'wits', 101).wits).toEqual({ level: 2, xp: 1 });
    expect(gainXp(base, 'grit', 10000).grit).toEqual({ level: 10, xp: 0 });
    expect(() => gainXp(base, 'heart', -1)).toThrow();
  });
});
describe('six community jobs', () => {
  for (const task of COMMUNITY_TASKS) it(`${task.id}: pay, XP, time, diminishing effects and weekly cap`, () => {
    const args = { state: { ...fresh(), day: task.opens }, town: { ...createTownState(), day: task.opens }, coins: 0, skills: baseSkills(), task, day: task.opens, minute: 600, id: task.id };
    const one = completeWork(args)!;
    expect(one.coins).toBe(task.pay); expect(one.state.stamina).toBe(100 - task.stamina); expect(one.minutes).toBe(task.minutes);
    expect(one.skills[task.skill].xp).toBe(10); expect(one.event.kind).toBe('community_work');
    expect(one.town.pillars[task.pillar] - args.town.pillars[task.pillar]).toBeCloseTo(task.effect);
    const two = completeWork({ ...args, state: one.state, town: one.town })!;
    expect(two.town.pillars[task.pillar] - one.town.pillars[task.pillar]).toBeCloseTo(task.effect / 2);
    const three = completeWork({ ...args, state: two.state, town: two.town })!;
    expect(three.town.pillars[task.pillar]).toBe(two.town.pillars[task.pillar]); expect(three.coins).toBe(task.pay);
    let town = args.town;
    for (let i = 0; i < 20; i++) town = completeWork({ ...args, town, organizer: true })!.town;
    expect(town.pillars[task.pillar] - args.town.pillars[task.pillar]).toBeCloseTo(3);
    expect(completeWork({ ...args, state: { ...args.state, stamina: 0 } })).toBeNull();
    expect(completeWork({ ...args, minute: 1560 })).toBeNull();
    if (task.opens > 1) expect(completeWork({ ...args, day: task.opens - 1 })).toBeNull();
  });
});
describe('gift rules and saves', () => {
  it('matches whole phrases, dislikes override love, birthday doubles and each new day allows one gift', () => {
    const item = { tags: ['tea', 'old books'] };
    expect(matchGift(item, { likes: ['Tea in the morning', 'old books'], dislikes: [] })).toBe('love');
    expect(matchGift(item, { likes: ['tea'], dislikes: [] })).toBe('like');
    expect(matchGift(item, { likes: ['teapot'], dislikes: [] })).toBe('neutral');
    expect(matchGift(item, { likes: ['tea', 'old books'], dislikes: ['old books'] })).toBe('dislike');
    expect(giftRegard('love', { birthday: isBirthday(101, 1) })).toBe(16); expect(isBirthday(1)).toBe(false);
    const s = { ...fresh(), gifts: { odile: 2 } }; expect(canGift(s, 'odile', 2)).toBe(false); expect(canGift(s, 'odile', 1)).toBe(false); expect(canGift(s, 'odile', 3)).toBe(true);
  });
  it('round trips all economy state and reads legacy empty placeholders without a version bump', () => {
    const clock = new Clock();
    const saved = collect({ clock, town: createTownState(), player: { zone: 'old_quarter', x: 1, y: 1, facing: 0 }, weather: { seed: 1, override: null, daily: dailyWeather(1, 1) }, story_flags: {}, quiet: emptyQuietState(), client_events: emptyEventLog(), player_name: 'Fellow', playtime: 0, fellow: { profile: null, look: null }, skills: baseSkills(), inventory: addItem(emptyInventory(), bun, 21)!, coins: { balance: 73 }, economy: { ...fresh(), gifts: { odile: 1 }, work: { sweep: 2 }, stamina: 45 } }, 'manual', 'Economy');
    const loaded = restore(JSON.parse(JSON.stringify(saved)));
    expect(loaded.inventory).toEqual(saved.inventory); expect(loaded.coins).toEqual(saved.coins); expect(loaded.economy).toEqual(saved.economy);
    const { economy: _economy, ...old } = saved;
    const legacy = migrateSave({ ...old, inventory: {}, coins: {} });
    expect(legacy.inventory).toEqual(Inventory.parse({})); expect(legacy.coins).toEqual(Wallet.parse({})); expect(legacy.economy.stamina).toBe(100);
  });
});
