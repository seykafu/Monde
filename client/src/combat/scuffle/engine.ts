import { planEnemyTurn } from '../AI';
import { routEnemies } from '../Victory';
import { Rng } from '../../util/rng';
import { createUnit, beginUnitTurn, endUnitTurn, isAlive } from '../Unit';
import { Initiative } from '../Initiative';
import { enterStance } from '../Actions';
import { weaponModifier, defenderStanceModifier } from '../Damage';
import { hasReadyStance, hasDefensiveStance, spendReady } from '../Stances';
import type { Unit, TilePos, WeaponKind } from '../types';
import type { ZoneDef } from '../../world/zoneFormat';
import { arenaGrid, deploymentTiles } from './arena';
import { SCUFFLES, type ScuffleId } from './catalog';

export type Tool = 'pan' | 'broom' | 'umbrella' | 'slingshot' | 'none';
export type Outcome = 'win' | 'loss' | 'flee' | 'talk_down' | 'paid';
export type Supply = 'bread_roll' | 'bun' | 'smelling_salts' | 'augusta_whistle' | 'marbles';
export const SUPPLIES: readonly Supply[] = ['bread_roll', 'bun', 'smelling_salts', 'augusta_whistle', 'marbles'];
const weapons: Record<Tool, WeaponKind> = { pan: 'sword', broom: 'spear', umbrella: 'shield', slingshot: 'bow', none: 'lens' };
export const triangle = (a: Tool, b: Tool): number => a === 'none' || b === 'none' || a === 'slingshot' || b === 'slingshot' ? 1 : weaponModifier(weapons[a], weapons[b]);
export const distance = (a: TilePos, b: TilePos): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export const same = (a: TilePos, b: TilePos): boolean => a.x === b.x && a.y === b.y;
export const reach = (tool: Tool): [number, number] => tool === 'slingshot' ? [2, 4] : [1, tool === 'broom' ? 2 : 1];
export interface Fighter extends Unit { tool: Tool; nerve: number; startled: number; quit: number; departed: boolean; rumorUntil: number; gritSkill: number }
export interface AllyOffer { id: 'augusta' | 'kasimir' | 'nell'; regard: number; willScuffle: boolean; willing: boolean }
export const eligibleAllies = (offers: readonly AllyOffer[]): AllyOffer[] => offers.filter(a => a.regard >= 40 && a.willScuffle && a.willing).slice(0, 2);
export interface Setup { enemies?: readonly string[]; grit?: number; heart?: number; scrapper?: boolean; allies?: AllyOffer[]; supplies?: Supply[]; coins?: number; quit?: Record<string, number>; tools?: Tool[]; random?: () => number }
// GDD-GAP: §7.2 gives ranges, not complete stat lines. These are the MVP's provisional lines.
const lines: Record<string, [Tool, number, number, number, number]> = {
  player: ['broom', 30, 7, 6, 5], augusta: ['umbrella', 35, 6, 5, 8], kasimir: ['pan', 40, 8, 3, 5], nell: ['broom', 30, 7, 7, 6],
  bru: ['pan', 40, 6, 3, 4], nettie: ['slingshot', 20, 4, 8, 3], dex: ['broom', 25, 5, 5, 3], dom: ['umbrella', 25, 5, 4, 3], weasel: ['none', 20, 4, 6, 2]
};
export function fighter(id: string, position: TilePos, enemy = false, gritSkill = 1): Fighter {
  const [tool, hp, power, speed, nerve] = lines[id] ?? ['none', 20, 4, 5, 2];
  return { ...createUnit({ id, name: id.startsWith('raccoon') ? 'Bin raccoon' : id === 'player' ? 'Fellow' : id[0]!.toUpperCase() + id.slice(1), shortName: id.slice(0, 2),
    faction: enemy ? 'enemy' : 'player', classKind: 'swordsman', weapon: weapons[tool], level: 1, artSeed: 1,
    stats: { hp: hp + (id === 'player' && gritSkill >= 2 ? 5 : 0), power, speed, armor: 0, movement: 3, ap: id === 'player' && gritSkill >= 8 ? 3 : 2 }
  }, position), tool, nerve, startled: 0, quit: 0, departed: false, rumorUntil: 0, gritSkill };
}
// GDD-GAP: Heart vs Nerve uses 50% + 5 percentage points per level difference, +30pp when half a quit condition is met, clamped 5–95%.
export function talkOdds(heart: number, nerve: number, scrapper = false, quit = 0): number {
  return Math.max(.05, Math.min(.95, .5 + .05 * (heart - nerve) + (heart >= 7 ? .2 : 0) + (scrapper ? .1 : 0) + (quit >= .5 ? .3 : 0)));
}
export type Action = { kind: 'move'; to: TilePos } | { kind: 'swing' | 'talk' | 'bribe' | 'rumor'; target: string } |
  { kind: 'ready' | 'brace' | 'end' | 'run' } | { kind: 'tool'; tool: Tool } |
  { kind: 'item'; item: Supply; target?: string; to?: TilePos };

/** Ravage Unit/Initiative/Grid/Stances with Monde's AP actions, tools and forgiving outcomes. */
export class Scuffle {
  readonly grid;
  readonly units: Fighter[];
  readonly initiative = new Initiative();
  readonly supplies: Supply[];
  readonly spent: Supply[] = [];
  readonly dropped: Supply[] = [];
  readonly traps: TilePos[] = [];
  readonly tools: Tool[];
  outcome: Outcome | null = null;
  coins: number;
  log: string[] = [];
  talked = 0;
  swings = 0;
  moves = 0;
  whistleRound: number | null = null;
  private readonly random: () => number;
  private readonly planningRng = new Rng(0);
  constructor(readonly id: ScuffleId, readonly arena: ZoneDef, readonly setup: Setup = {}) {
    this.grid = arenaGrid(arena); const tiles = deploymentTiles(arena);
    const allies = eligibleAllies(setup.allies ?? []), enemies = setup.enemies ?? SCUFFLES[id].enemies;
    if (tiles.length < 1 + allies.length + enemies.length) throw new Error('There is not enough connected ground for this Scuffle.');
    this.units = [fighter('player', tiles.shift()!, false, setup.grit), ...allies.map(a => fighter(a.id, tiles.shift()!)), ...enemies.map(id => fighter(id, tiles.pop()!, true))];
    this.units.forEach(u => { u.quit = setup.quit?.[u.id] ?? 0; });
    this.supplies = (setup.supplies ?? []).slice(0, 5); this.coins = setup.coins ?? 0;
    this.tools = setup.tools ?? ['broom', 'pan', 'umbrella'];
    this.random = setup.random ?? Math.random;
    this.initiative.reseed(this.units); this.start();
  }
  get current(): Fighter | null { return this.initiative.current() as Fighter | null; }
  living(): Fighter[] { return this.units.filter(isAlive); }
  opponents(u: Fighter): Fighter[] { return this.living().filter(t => t.faction !== u.faction); }
  occupied(p: TilePos): boolean { return this.living().some(u => same(u.state.position, p)); }
  movesFor(u: Fighter): TilePos[] { return this.grid.reachableTiles(u.state.position, u.stats.movement, p => this.occupied(p)); }
  inReach(u: Fighter, t: Fighter): boolean { const d = distance(u.state.position, t.state.position), [min, max] = reach(u.tool); return d >= min && d <= max; }
  private start(): void {
    const u = this.current; if (!u) return;
    beginUnitTurn(u); u.state.apRemaining = Math.max(0, u.state.apRemaining - u.startled); u.startled = 0;
  }
  private leave(u: Fighter, words: string): void { u.state.alive = false; u.departed = true; this.log.push(`${u.name} ${words}`); }
  private check(): void {
    for (const u of this.living()) {
      if (u.id === 'nettie' && this.opponents(u).filter(t => distance(t.state.position, u.state.position) === 1).length >= 2) this.leave(u, 'packs away her slingshot and leaves.');
      if (u.id === 'weasel' && u.state.hp <= u.stats.hp / 2) this.leave(u, 'remembers another appointment.');
    }
    const victory = routEnemies.evaluate({ state: { grid: this.grid, units: this.units, rng: this.planningRng }, round: this.initiative.round });
    if (victory === 'player') this.outcome = this.swings === 0 && this.talked > 0 ? 'talk_down' : 'win';
    else if (victory === 'enemy') this.outcome = 'loss';
  }
  private hit(target: Fighter, amount: number): void {
    target.state.hp = Math.max(0, target.state.hp - amount);
    if (target.id === 'player' && target.gritSkill >= 6 && !target.state.secondWindUsed && target.state.hp <= target.stats.hp * .25) {
      // GDD-GAP: the L6 trigger is specified, recovery isn't: restore 25% max Grit, including a hit crossing zero.
      target.state.hp += Math.ceil(target.stats.hp * .25); target.state.secondWindUsed = true; this.log.push('Fellow catches a Second Wind!');
    }
    if (target.state.hp === 0) { target.state.alive = false; this.log.push(`${target.name}: ${target.id.startsWith('raccoon') ? 'Shooed!' : 'Winded!'}`); }
  }
  damage(u: Fighter, t: Fighter, multiplier = 1): number {
    if (u.tool === 'slingshot') return 1;
    const twin = ['dex', 'dom'].includes(u.id) && this.living().some(a => a.id === (u.id === 'dex' ? 'dom' : 'dex') && distance(a.state.position, t.state.position) === 1) ? 3 : 0;
    const guard = this.living().some(a => a !== t && a.faction === t.faction && a.tool === 'umbrella' && hasDefensiveStance(a) && distance(a.state.position, t.state.position) === 1) ? .5 : 1;
    return Math.max(1, Math.round(((u.stats.power + (u.tool === 'pan' ? 2 : 0)) * triangle(u.tool, t.tool) + twin) * defenderStanceModifier(t) * guard * multiplier));
  }
  private swing(u: Fighter, t: Fighter, counter = false, multiplier = 1): void {
    const ready = hasReadyStance(t), passive = triangle(t.tool, u.tool) > 1;
    // GDD-GAP: critical swings use Ravage's 1.5 multiplier; Nerve sets the specified probability.
    this.hit(t, this.damage(u, t, multiplier * (this.random() < Math.max(0, u.nerve - (u.rumorUntil >= this.initiative.round ? 2 : 0)) * .02 ? 1.5 : 1)));
    this.log.push(u.tool === 'slingshot' ? `${u.name}: Ping! At the floor. Startled!` : `${u.name}: ${u.tool === 'pan' ? 'Clang!' : 'Whoosh!'}`);
    if (u.tool === 'slingshot') t.startled = Math.max(1, t.startled);
    if ((u.id === 'nettie' || u.id.startsWith('raccoon')) && t.faction !== 'enemy') { const item = this.supplies.pop(); if (item) this.dropped.push(item); }
    if (u.tool === 'pan' && this.random() < .25) t.startled = Math.max(1, t.startled);
    // Counter resolves at the impact position, before Sweep moves the defender out of reach.
    if (!counter && isAlive(t) && (ready || passive) && this.inReach(t, u)) {
      this.swing(t, u, true, passive ? 1.5 * (ready && t.gritSkill >= 4 ? 1.25 : 1) : 1.25 * (t.gritSkill >= 4 ? 1.25 : 1));
      if (ready) spendReady(t);
    }
    if (u.tool === 'broom' && isAlive(t)) {
      const a = u.state.position, b = t.state.position;
      const p = { x: b.x + (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? Math.sign(b.x - a.x) : 0), y: b.y + (Math.abs(b.x - a.x) < Math.abs(b.y - a.y) ? Math.sign(b.y - a.y) : 0) };
      if (this.grid.inBounds(p) && !this.occupied(p)) {
        if (this.grid.tileAt(p).terrain === 'water') { t.state.hp = 0; t.state.alive = false; this.log.push(`${t.name}: Splash! ${t.id.startsWith('raccoon') ? 'Shooed' : 'Winded'}, on the bank.`); }
        else if (!this.grid.tileAt(p).blocksMovement) t.state.position = p;
      }
    }
  }
  act(action: Action): boolean {
    const u = this.current; if (!u || this.outcome) return false;
    if (action.kind === 'end') { endUnitTurn(u); this.initiative.advancePastCurrent(this.units); this.reinforce(); this.start(); this.check(); return true; }
    if (u.state.apRemaining < 1) return false;
    const target = 'target' in action ? this.units.find(t => t.id === action.target) : undefined;
    switch (action.kind) {
      case 'move': {
        if (!this.movesFor(u).some(p => same(p, action.to))) return false;
        const path = this.grid.pathTo(u.state.position, action.to, p => this.occupied(p));
        if (!path) return false;
        for (const p of path) { u.state.position = p; const trap = this.traps.findIndex(t => same(t, p)); if (trap >= 0) { this.traps.splice(trap, 1); u.startled = 1; this.log.push(`${u.name} sits down suddenly. Marbles!`); break; } }
        this.moves++; break;
      }
      case 'swing': if (!target || !isAlive(target) || target.faction === u.faction || !this.inReach(u, target)) return false;
        this.swing(u, target); if (u.faction !== 'enemy') this.swings++; break;
      case 'talk': if (!target || !isAlive(target) || target.faction === u.faction || u.faction === 'enemy' || u.state.apRemaining < 2 || distance(u.state.position, target.state.position) !== 1) return false;
        u.state.apRemaining--; this.talked++;
        if (this.random() < talkOdds(this.setup.heart ?? 1, target.nerve - (target.rumorUntil >= this.initiative.round ? 2 : 0), this.setup.scrapper, target.quit)) this.leave(target, target.id.startsWith('raccoon') ? 'takes the hint. Shooed!' : 'decides tea sounds better.');
        else this.log.push(`${target.name} hesitates, but stays. Try again next turn.`); break;
      case 'rumor':
        if (u.id !== 'weasel' || !target || !isAlive(target) || target.faction === u.faction || distance(u.state.position, target.state.position) > 2) return false;
        target.rumorUntil = this.initiative.round + 1; this.log.push(`${u.name} spreads a wobbling rumour. ${target.name}: −2 Nerve for two rounds.`); break;
      case 'bribe': // GDD-GAP: Weasel's in-Scuffle bribe costs 20 coins, distinct from his 300-coin quit debt.
        if (!target || !isAlive(target) || u.faction === 'enemy' || target.id !== 'weasel' || distance(u.state.position, target.state.position) !== 1 || this.coins < 20) return false;
        this.coins -= 20; this.leave(target, 'finds somewhere else to be.'); break;
      case 'ready': if (!enterStance(u, 'ready')) return false; break;
      case 'brace': if (!enterStance(u, 'defensive')) return false; break;
      case 'run': if (u.faction === 'enemy' || ![0, this.grid.width - 1].includes(u.state.position.x) && ![0, this.grid.height - 1].includes(u.state.position.y)) return false;
        this.outcome = 'flee'; break;
      case 'tool': // GDD-GAP: switching a borrowed/Bag tool costs 1 AP.
        if (u.id !== 'player' || !this.tools.includes(action.tool) || action.tool === u.tool) return false;
        u.tool = action.tool; u.weapon = weapons[action.tool]; break;
      case 'item': {
        const idx = this.supplies.indexOf(action.item); if (u.faction === 'enemy' || idx < 0) return false;
        if (action.item === 'augusta_whistle') { if (this.units.some(t => t.id === 'augusta') || this.whistleRound !== null || this.units.filter(t => t.faction !== 'enemy').length >= 3) return false; this.whistleRound = this.initiative.round + 2; }
        else if (action.item === 'marbles') { if (!action.to || !this.grid.inBounds(action.to) || this.grid.tileAt(action.to).blocksMovement || this.occupied(action.to) || distance(u.state.position, action.to) > 1) return false; this.traps.push(action.to); }
        else { if (!target || target.departed || target.faction !== u.faction || distance(u.state.position, target.state.position) > 1) return false;
          if (action.item === 'smelling_salts') { if (isAlive(target) || this.occupied(target.state.position)) return false; target.state.hp = 5; target.state.alive = true; }
          else { if (!isAlive(target) || target.state.hp === target.stats.hp) return false; target.state.hp = Math.min(target.stats.hp, target.state.hp + (action.item === 'bun' ? 15 : 8)); }
        }
        this.supplies.splice(idx, 1); this.spent.push(action.item); break;
      }
    }
    u.state.apRemaining--; this.check();
    if (!this.outcome && !isAlive(u)) { endUnitTurn(u); this.initiative.advancePastCurrent(this.units); this.start(); }
    return true;
  }
  private reinforce(): void {
    if (this.whistleRound === null || this.initiative.round < this.whistleRound) return;
    const p = deploymentTiles(this.arena).find(t => !this.occupied(t)); if (!p) return;
    this.units.push(fighter('augusta', p)); this.whistleRound = null;
    // Arrival is checked at the new round boundary, before anyone acts. Sort her into the player phase.
    this.initiative.reseed(this.units);
    this.log.push('Augusta: I heard that. All of Monde heard that.');
  }
  /** Readable intent and the executed action use the same legal candidate search. */
  intent(u: Fighter = this.current!): { text: string; action: Action } {
    if (!u || u.state.apRemaining <= 0) return { text: 'Catch breath', action: { kind: 'end' } };
    const foes = this.opponents(u).sort((a, b) => distance(u.state.position, a.state.position) - distance(u.state.position, b.state.position));
    const nettie = this.living().find(t => t.id === 'nettie');
    if (u.id === 'bru' && nettie) foes.sort((a, b) => distance(a.state.position, nettie.state.position) - distance(b.state.position, nettie.state.position));
    const rumorTarget = foes.find(t => distance(u.state.position, t.state.position) <= 2 && t.rumorUntil < this.initiative.round);
    if (u.id === 'weasel' && rumorTarget) return { text: `Rattle ${rumorTarget.name} with a rumour`, action: { kind: 'rumor', target: rumorTarget.id } };
    const inRange = foes.find(t => this.inReach(u, t));
    if (inRange && u.id !== 'weasel') return { text: `${u.tool === 'slingshot' ? 'Ping the floor beside' : 'Swing toward'} ${inRange.name}`, action: { kind: 'swing', target: inRange.id } };
    // Ravage's move-then-attack scoring supplies the brawlers' approach; Monde revalidates it against occupied tiles.
    if (u.faction === 'enemy' && (u.id === 'dex' || u.id === 'dom')) {
      const planned = planEnemyTurn({ grid: this.grid, units: this.units, rng: this.planningRng }, u)[0];
      if (planned?.kind === 'move' && planned.movePos && this.movesFor(u).some(p => same(p, planned.movePos!))) return { text: 'Move into swinging reach', action: { kind: 'move', to: planned.movePos } };
    }
    const movingToward = u.id === 'bru' && nettie ? foes.slice(0, 1) : foes;
    const dest = this.movesFor(u).sort((a, b) => Math.min(...movingToward.map(t => distance(a, t.state.position))) - Math.min(...movingToward.map(t => distance(b, t.state.position))))[0];
    if (dest && foes.some(t => distance(dest, t.state.position) < distance(u.state.position, t.state.position))) return { text: 'Close the distance', action: { kind: 'move', to: dest } };
    if (!hasDefensiveStance(u)) return { text: 'Brace and wait', action: { kind: 'brace' } };
    return { text: 'Wait', action: { kind: 'end' } };
  }
}
