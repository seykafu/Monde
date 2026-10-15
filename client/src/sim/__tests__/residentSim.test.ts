import { describe, expect, it } from 'vitest';
import { displayName, ResidentSim } from '../residentSim';
import { TypedEmitter, type TownEvents } from '../events';
import { loadCards, loadWorld } from './content';

const world = loadWorld();
const cards = loadCards();

describe('resident sim', () => {
  it('ticks everyone from the executor and agrees with per-resident samples', () => {
    const sim = new ResidentSim(cards, world);
    const states = sim.tick(1, 600);
    expect(states).toHaveLength(cards.length);
    expect(sim.tick(1, 600)).toBe(states); // memoised per minute
    for (const s of states) expect(sim.sample(s.id, 1, 600)).toEqual(s);
    const c = sim.counts('old_quarter', states);
    expect(c.here + c.offboard + c.elsewhere).toBe(cards.length);
    expect(c.unresolved).toBe(0);
  });

  it('puts residents about to step onto a board in its roster early', () => {
    const sim = new ResidentSim(cards, world);
    // Find someone who enters Market Row during the morning, and check the roster a minute before.
    for (let m = 400; m < 800; m++) {
      const before = sim.tick(1, m), after = sim.tick(1, m + 1);
      const arriving = after.find((s, i) => s.zone === 'market_row' && before[i]!.zone !== 'market_row');
      if (!arriving) continue;
      expect(sim.boardRoster('market_row', 1, m, 2).has(arriving.id)).toBe(true);
      return;
    }
    throw new Error('nobody entered Market Row all morning');
  });

  it('adds jittered synthetic residents for crowd tests', () => {
    const sim = new ResidentSim(cards, world, 6);
    expect(sim.profiles).toHaveLength(cards.length + 6);
    expect(sim.plansFor(3)).toHaveLength(cards.length + 6);
    expect(new Set(sim.profiles.map(p => p.id)).size).toBe(cards.length + 6);
  });

  it('shows nicknames where cards have them', () => {
    expect(displayName('Juniper "June" Castellanos')).toBe('June');
    expect(displayName('Odile Fournier')).toBe('Odile Fournier');
  });

  it('emits typed talk requests', () => {
    const bus = new TypedEmitter<TownEvents>();
    const seen: string[] = [];
    const off = bus.on('talk-requested', e => seen.push(e.residentId));
    bus.emit('talk-requested', { residentId: 'margo', zone: 'old_quarter', day: 1, minute: 780 });
    off();
    bus.emit('talk-requested', { residentId: 'pell', zone: 'old_quarter', day: 1, minute: 781 });
    expect(seen).toEqual(['margo']);
  });
});
