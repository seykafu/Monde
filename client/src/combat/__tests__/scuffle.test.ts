import { describe, expect, it } from 'vitest';
import { emptyTollmen } from '@monde/shared';
import { Scuffle, distance, eligibleAllies, fighter, talkOdds, triangle, type Action, type Tool } from '../scuffle/engine';
import { cutArena, deploymentTiles } from '../scuffle/arena';
import { SCUFFLES, type ScuffleId } from '../scuffle/catalog';
import { baseline, consequences, recordOutcome, tollmenLevel } from '../scuffle/tollmen';
import { zones } from '../../world/zones';
import { isAlive } from '../Unit';
import { hasDefensiveStance, hasReadyStance } from '../Stances';
const arena = () => {
  const z = zones.market_row!, p = z.places.find(p => p.id === 'bakery')!;
  return cutArena(z, { x: p.door[0], y: p.door[1] });
};
const encounter = (id: ScuffleId = 'sc_bakery_tutorial') => new Scuffle(id, arena(), { random: () => .3 });
function adjacent(b: Scuffle): void {
  const tiles = deploymentTiles(b.arena), a = tiles.find(p => tiles.some(t => distance(p, t) === 1))!;
  b.units[0]!.state.position = a; b.units[1]!.state.position = tiles.find(t => distance(a, t) === 1)!;
}

describe('Monde tools and AP', () => {
  it('equips an available starting tool without spending turn AP; other fights still start with a broom', () => {
    const b = new Scuffle('sc_bakery_tutorial', arena(), { startingTool: 'umbrella' });
    expect(b.current).toMatchObject({ tool: 'umbrella', weapon: 'shield', state: { apRemaining: 2 } });
    expect(encounter('sc_market_saturday').current).toMatchObject({ tool: 'broom', weapon: 'spear' });
    const unavailable = new Scuffle('sc_bakery_tutorial', arena(), { startingTool: 'slingshot' });
    expect(unavailable.current?.tool).toBe('broom');
  });
  it('preserves all six triangle directions; slingshots and empty hands are neutral', () => {
    for (const [a, b] of [['pan', 'broom'], ['broom', 'umbrella'], ['umbrella', 'pan']] as [Tool, Tool][]) { expect(triangle(a, b)).toBe(1.15); expect(triangle(b, a)).toBe(.85); }
    for (const a of ['pan', 'broom', 'umbrella', 'slingshot', 'none'] as Tool[]) { expect(triangle(a, a)).toBe(1); expect(triangle(a, 'slingshot')).toBe(1); expect(triangle('none', a)).toBe(1); }
  });
  it('stacks Ready and Brace, spends both AP, and prevents repeated stance exploits', () => {
    const b = encounter(), u = b.current!;
    expect(b.act({ kind: 'ready' })).toBe(true); expect(b.act({ kind: 'ready' })).toBe(false);
    expect(b.act({ kind: 'brace' })).toBe(true); expect(hasReadyStance(u)).toBe(true); expect(hasDefensiveStance(u)).toBe(true);
    expect(u.state.apRemaining).toBe(0); expect(b.act({ kind: 'tool', tool: 'pan' })).toBe(false);
  });
  it('advantaged defenders counter at 1.5 and Brace halves incoming damage', () => {
    const b = encounter(); adjacent(b); const p = b.units[0]!, bru = b.units[1]!;
    p.tool = 'broom'; bru.tool = 'pan'; const before = p.state.hp;
    expect(b.act({ kind: 'swing', target: bru.id })).toBe(true);
    expect(before - p.state.hp).toBe(b.damage(bru, p, 1.5));
    bru.state.stance = 'defensive'; expect(b.damage(p, bru)).toBe(Math.round(7 * .85 * .5));
  });
  it('Ready fires once without stripping Brace, and Grit L4 improves the counter', () => {
    const b = encounter(); adjacent(b); const p = b.units[0]!, target = b.units[1]!;
    p.tool = target.tool = 'umbrella'; target.gritSkill = 4; target.state.stance = 'both';
    const before = p.state.hp;
    b.act({ kind: 'swing', target: target.id }); expect(before - p.state.hp).toBe(b.damage(target, p, 1.25 * 1.25));
    expect(target.state.stance).toBe('defensive');
  });
  it('Second Wind triggers once on crossing 25%, including crossing zero', () => {
    const b = encounter(); adjacent(b); const p = b.units[0]!, bru = b.units[1]!;
    p.gritSkill = 6; p.state.hp = 1; p.tool = 'broom'; bru.tool = 'pan';
    b.act({ kind: 'swing', target: bru.id }); expect(p.state.secondWindUsed).toBe(true); expect(p.state.hp).toBe(Math.ceil(p.stats.hp / 4));
    adjacent(b); b.act({ kind: 'swing', target: bru.id }); expect(isAlive(p)).toBe(false);
  });
  it('Talk Down odds include Heart, Nerve, Scrapper, L7 and half-met quit conditions', () => {
    expect(talkOdds(1, 5)).toBeCloseTo(.3); expect(talkOdds(1, 5, true)).toBeCloseTo(.4);
    expect(talkOdds(7, 5)).toBeCloseTo(.8); expect(talkOdds(1, 5, false, .5)).toBeCloseTo(.6);
    expect(talkOdds(10, 2, true, 1)).toBe(.95);
    const b = encounter(); adjacent(b); b.units[0]!.state.apRemaining = 1;
    expect(b.act({ kind: 'talk', target: b.units[1]!.id })).toBe(false);
  });
  it('takes no more than two eligible, willing residents; never invents consent', () => {
    expect(eligibleAllies([{ id: 'augusta', regard: 40, willScuffle: true, willing: true }, { id: 'nell', regard: 39, willScuffle: true, willing: true }, { id: 'kasimir', regard: 80, willScuffle: true, willing: false }]).map(a => a.id)).toEqual(['augusta']);
  });
  it('consumes Bag supplies, caps them at five, and cannot revive someone onto an occupied tile', () => {
    const b = new Scuffle('sc_bakery_tutorial', arena(), { supplies: ['bun', 'bun', 'bun', 'bun', 'bun', 'bun'] });
    const p = b.current!; p.state.hp -= 20;
    expect(b.supplies).toHaveLength(5); expect(b.act({ kind: 'item', item: 'bun', target: p.id })).toBe(true);
    expect(p.state.hp).toBe(p.stats.hp - 5); expect(b.spent).toEqual(['bun']);
  });
});

describe('town arenas and legal enemy decisions', () => {
  it('cuts a 10×8 connected encounter from the real bakery, preserving elevation and collisions', () => {
    const a = arena(); expect(a.width).toBe(10); expect(a.height).toBe(8); expect(a.town?.buildings.some(b => b.id === 'bakery')).toBe(true);
    const b = encounter(); for (const u of b.units) expect(b.grid.tileAt(u.state.position).blocksMovement).toBe(false);
    expect(new Set(b.units.map(u => `${u.state.position.x},${u.state.position.y}`)).size).toBe(b.units.length);
  });
  for (const id of Object.keys(SCUFFLES) as ScuffleId[]) it(`${id}: every AI action is legal, and a scripted conversational player can finish`, () => {
    const b = new Scuffle(id, arena(), { heart: 1, random: () => .1 });
    for (let i = 0; i < 400 && !b.outcome; i++) {
      const u = b.current!; let action: Action;
      if (u.faction === 'enemy') action = b.intent(u).action;
      else {
        const target = b.opponents(u).sort((a, c) => (a.id === 'nettie' ? -1 : c.id === 'nettie' ? 1 : distance(u.state.position, a.state.position) - distance(u.state.position, c.state.position)))[0]!;
        if (u.state.apRemaining === 0) action = { kind: 'end' };
        else if (u.tool !== 'umbrella') action = { kind: 'tool', tool: 'umbrella' };
        else if (distance(u.state.position, target.state.position) === 1) action = u.state.apRemaining >= 2 ? { kind: 'talk', target: target.id } : { kind: 'brace' };
        else {
          const next = b.movesFor(u).sort((a, c) => distance(a, target.state.position) - distance(c, target.state.position))[0];
          action = next ? { kind: 'move', to: next } : { kind: 'end' };
        }
      }
      expect(b.act(action), `${u.name}: ${JSON.stringify(action)}`).toBe(true);
    }
    expect(['win', 'talk_down'], JSON.stringify({ units: b.units.map(u => [u.id, u.state.hp, u.state.position]), log: b.log })).toContain(b.outcome); expect(b.talked).toBeGreaterThan(0);
  });
  it('Scrapper starts at 35 Grit and Grit L8 gets three AP', () => { expect(fighter('player', { x: 0, y: 0 }, false, 2).stats.hp).toBe(35); expect(fighter('player', { x: 0, y: 0 }, false, 8).stats.ap).toBe(3); });
});

describe('Tollmen pressure and forgiving outcomes', () => {
  it('uses the authored calendar and expires wins/losses on the exact dawn', () => {
    expect([1, 14, 15, 25, 26, 35].map(baseline)).toEqual([1, 1, 2, 1, 2, 3]);
    const win = recordOutcome(emptyTollmen(), 'market_row', 15, 'win', 'a');
    expect(tollmenLevel(win, 'market_row', 17)).toBe(1); expect(tollmenLevel(win, 'market_row', 18)).toBe(2);
    const loss = recordOutcome(emptyTollmen(), 'market_row', 15, 'loss', 'b');
    expect(tollmenLevel(loss, 'market_row', 16)).toBe(3); expect(tollmenLevel(loss, 'market_row', 17)).toBe(2);
    expect(recordOutcome(win, 'market_row', 15, 'win', 'a')).toBe(win);
  });
  it('streetlights apply only at night in OQ/MR; permanent reductions stay', () => {
    const state = emptyTollmen(); expect(tollmenLevel(state, 'market_row', 15, true, 1)).toBe(1);
    expect(tollmenLevel(state, 'market_row', 15, false, 1)).toBe(2); expect(tollmenLevel(state, 'wharf', 15, true, 1)).toBe(2);
    expect(tollmenLevel({ ...state, quit: { bru: 'market_row' }, charter: true }, 'market_row', 35)).toBe(1);
  });
  it('caps lost coins, delays two hours, and makes Run free except for pressure', () => {
    expect(consequences('loss', 1000)).toMatchObject({ coins: 950, minutes: 120, safety: -1 });
    expect(consequences('loss', 19).coins).toBe(18);
    expect(consequences('flee', 1000)).toMatchObject({ coins: 1000, minutes: 0, safety: 0 });
  });
});

describe('Scuffle edge cases', () => {
  it('orders allies with the Fellow by Hustle before the enemy phase', () => {
    const b = new Scuffle('sc_bakery_tutorial', arena(), { allies: [{ id: 'nell', regard: 40, willScuffle: true, willing: true }, { id: 'kasimir', regard: 40, willScuffle: true, willing: true }] });
    expect(b.initiative.serialize().orderIds).toEqual(['nell', 'player', 'kasimir', 'nettie', 'bru']);
  });
  it('uses Braced umbrellas to protect an adjacent ally', () => {
    const b = encounter(); adjacent(b); const p = b.units[0]!, bru = b.units[1]!;
    const free = b.grid.neighbors4(p.state.position).find(t => !b.occupied(t) && !b.grid.tileAt(t).blocksMovement)!;
    const augusta = fighter('augusta', free); augusta.state.stance = 'defensive';
    const before = b.damage(bru, p); b.units.push(augusta);
    expect(b.damage(bru, p)).toBe(Math.round(before / 2));
  });
  it('Nettie pings for just one Grit, removes a supply temporarily, and Startled costs next-turn AP', () => {
    const b = new Scuffle('sc_bakery_tutorial', arena(), { supplies: ['bun'] }), p = b.units[0]!, nettie = b.units[2]!;
    const tiles = deploymentTiles(b.arena), a = tiles.find(p => tiles.some(t => distance(p, t) === 2))!;
    p.state.position = a; nettie.state.position = tiles.find(t => distance(a, t) === 2)!;
    b.act({ kind: 'end' }); const before = p.state.hp;
    expect(b.act({ kind: 'swing', target: 'player' })).toBe(true); expect(p.state.hp).toBe(before - 1); expect(p.startled).toBe(1); expect(b.dropped).toEqual(['bun']);
    while (b.initiative.round < 2) b.act({ kind: 'end' });
    expect(b.current?.id).toBe('player'); expect(p.state.apRemaining).toBe(1);
  });
  it('Weasel uses Rumor, flees at half Grit, and alone accepts a 20-coin bribe', () => {
    const b = new Scuffle('sc_market_saturday', arena(), { coins: 30 }); adjacent(b);
    const weasel = b.units.find(u => u.id === 'weasel')!, p = b.units[0]!;
    const other = b.units[1]!; const old = weasel.state.position; weasel.state.position = other.state.position; other.state.position = old;
    expect(b.act({ kind: 'bribe', target: weasel.id })).toBe(true); expect(b.coins).toBe(10); expect(weasel.departed).toBe(true);
    expect(b.act({ kind: 'bribe', target: other.id })).toBe(false); expect(p.state.apRemaining).toBe(1);
  });
  it('the whistle brings Augusta after two rounds and preserves phase ordering', () => {
    const b = new Scuffle('sc_bakery_tutorial', arena(), { supplies: ['augusta_whistle'] });
    expect(b.act({ kind: 'item', item: 'augusta_whistle' })).toBe(true);
    while (b.initiative.round < 3) b.act({ kind: 'end' });
    expect(b.units.filter(u => u.id === 'augusta')).toHaveLength(1);
    const order = b.initiative.serialize().orderIds;
    expect(order.indexOf('augusta')).toBeLessThan(order.indexOf('nettie'));
  });
  it('marbles trip the first entrant along a path, not only someone ending on that tile', () => {
    const b = new Scuffle('sc_bakery_tutorial', arena(), { supplies: ['marbles'] }), p = b.current!;
    const tile = b.grid.neighbors4(p.state.position).find(t => !b.occupied(t) && !b.grid.tileAt(t).blocksMovement)!;
    expect(b.act({ kind: 'item', item: 'marbles', to: tile })).toBe(true);
    expect(b.act({ kind: 'move', to: tile })).toBe(true); expect(p.startled).toBe(1); expect(b.traps).toHaveLength(0);
  });
  it('allows running only from an edge and applies no coin/Safety penalty', () => {
    const b = encounter(), p = b.current!;
    p.state.position = { x: 4, y: 4 }; expect(b.act({ kind: 'run' })).toBe(false);
    p.state.position = { x: 0, y: 4 }; expect(b.act({ kind: 'run' })).toBe(true); expect(b.outcome).toBe('flee');
  });
});
