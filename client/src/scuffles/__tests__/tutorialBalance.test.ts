import { expect, it } from 'vitest';
import { prepare } from '../runtime';
import { defaultFellow, setFellow } from '../../fellow/state';
import { emptyInventory } from '../../economy/inventory';
import { Scuffle, distance, type Action } from '../../combat/scuffle/engine';
import { hasDefensiveStance } from '../../combat/Stances';
import { Rng } from '../../util/rng';

function prepared() {
  const data = new Map<string, unknown>();
  const r = { get: (k: string) => data.get(k), set: (k: string, v: unknown) => data.set(k, v), remove: (k: string) => data.delete(k) };
  setFellow(r, defaultFellow());
  r.set('monde.inventory', emptyInventory());
  return prepare(r, 'sc_bakery_tutorial', { day: 3, minute: 600 }, { key: 's03', story: true }).battle;
}
const template = prepared();
// No difficulty setting is exposed or consumed by prepare/Scuffle. Difficulty.ts
// belongs to the unused Ravage battle hydration path. Default background is
// Tinkerer (Grit/Heart 1); S01–S03 grant no guaranteed combat supplies or allies.
// Seeds 0–199 before the fix: sensible 190, strong 200, reckless/uncoached 0 wins.
// The strong heuristic anticipates Bru's move + swing and braces each threatened
// turn, relying on the umbrella's passive counters rather than trading blows.
// Uncoached simply approaches and swings with the supplied tool; reckless
// deliberately chooses the disadvantaged broom and ignores all defensive tips.
type Policy = 'sensible' | 'strong' | 'reckless' | 'uncoached';
function play(seed: number, policy: Policy) {
  const rng = new Rng(seed);
  const b = new Scuffle(template.id, template.arena, { ...template.setup, random: () => rng.next() });
  const followsTips = policy === 'sensible' || policy === 'strong';
  let moved = false;
  for (let step = 0; step < 600 && !b.outcome; step++) {
    const p = b.current!;
    let action: Action;
    if (p.faction === 'enemy') action = b.intent().action;
    else if (p.state.apRemaining === 0) { action = { kind: 'end' }; moved = false; }
    else {
      const foes = b.opponents(p).sort((a, c) => distance(p.state.position, a.state.position) - distance(p.state.position, c.state.position));
      const target = foes[0]!;
      const adjacent = foes.find(t => distance(p.state.position, t.state.position) === 1);
      if (policy === 'reckless' && p.tool !== 'broom') action = { kind: 'tool', tool: 'broom' };
      else if (followsTips && p.tool !== 'umbrella') action = { kind: 'tool', tool: 'umbrella' };
      // Follow the tool / Move / Brace / next-turn Talk Down tips once feasible.
      else if (followsTips && b.talked === 0 && moved === false && adjacent && p.state.apRemaining >= 2) action = { kind: 'talk', target: adjacent.id };
      else if (followsTips && !hasDefensiveStance(p) && (moved || policy === 'strong' && foes.some(t => t.id === 'bru' && distance(p.state.position, t.state.position) <= 4))) action = { kind: 'brace' };
      else if (b.inReach(p, target)) action = { kind: 'swing', target: target.id };
      else {
        const path = b.grid.pathTo(p.state.position, target.state.position, pos => b.occupied(pos) && distance(pos, target.state.position) !== 0);
        const dest = path?.slice(0, p.stats.movement).filter(pos => !b.occupied(pos)).at(-1);
        action = dest ? { kind: 'move', to: dest } : { kind: 'end' };
      }
    }
    expect(b.act(action), JSON.stringify(action)).toBe(true);
    if (p.id === 'player' && action.kind === 'move') moved = true;
    if (p.id === 'player' && action.kind === 'end') moved = false;
  }
  expect(b.outcome, JSON.stringify(b.units.map(u => [u.id, u.state.hp, u.state.position]))).not.toBeNull();
  return b.outcome === 'win' || b.outcome === 'talk_down';
}
it('keeps the solo S03 tutorial at least 85% winnable without protecting reckless play', () => {
  expect(template.units[0]!.stats).toMatchObject({ hp: 30, ap: 2 });
  expect(template.setup).toMatchObject({ grit: 1, heart: 1, supplies: [], tools: ['broom', 'pan', 'umbrella'] });
  expect(template.units[0]).toMatchObject({ tool: 'umbrella', weapon: 'shield', state: { apRemaining: 2 } });
  const results = { sensible: 0, strong: 0, reckless: 0, uncoached: 0 };
  for (const policy of ['sensible', 'strong', 'reckless', 'uncoached'] as const) {
    for (let seed = 0; seed < 200; seed++) results[policy] += Number(play(seed, policy));
  }
  expect(results.sensible).toBeGreaterThanOrEqual(170);
  expect(results.uncoached).toBeGreaterThanOrEqual(170);
  expect(results.strong).toBeGreaterThanOrEqual(results.sensible);
  expect(results.reckless).toBeLessThan(100);
  console.log('S03 wins / 200 seeds, only/default difficulty:', results);
});
