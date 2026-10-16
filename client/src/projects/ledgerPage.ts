// The Town Ledger's Projects page (GDD §6.3, §18 Journal → Town Ledger; MVP G-03). Drawn into the Ledger's sheet
// (scenes/TownLedgerScene.ts) through the small drawing API it passes in, so it shares the Ledger's paper, ink and brass.
// Every Spring Project gets a card: its stage, cost and who signed, materials in (and carried), the hours bar (the
// player's, the neighbours' and tomorrow's pledges), its lead and puzzle, and the one next thing to do.
import type Phaser from 'phaser';
import { Inventory } from '@monde/shared';
import { puzzles } from '../puzzles/catalog';
import type { RegistryLike } from '../fellow/state';
import type { TownState } from '../town/pillars';
import { PROJECTS } from './catalog';
import * as E from './engine';
import { capitalize, materialCount, materialNoun, projectName, projectsOf, residentName, siteFor, sitePlaceName, worldOf } from './runtime';
import type { ProjectDef } from './schema';

export interface PageApi {
  g: Phaser.GameObjects.Graphics;
  text(x: number, y: number, s: string, size: number, opts?: { color?: string; family?: 'ui' | 'heading' | 'body'; italic?: boolean; bold?: boolean; align?: 'left' | 'right' | 'center'; wrap?: number }): Phaser.GameObjects.Text;
}

export interface PageBox { x: number; y: number; w: number; h: number }

const INK = 0x2b2219, BRASS = 0xa67c2e, TRACK = 0xe6d9b8, PAPER_DARK = 0xe9dcbc;
const INK_CSS = '#2b2219', MUTED = '#6f6150', BRASS_CSS = '#8a6a24', DONE_CSS = '#2f6b3a';
/** Stage pills: the ledger's palette, Okabe–Ito where they mean something. */
const STAGE_LOOK: Readonly<Record<E.Stage, { label: string; fill: number; ink: string }>> = {
  locked: { label: 'Not yet', fill: 0xd8ccae, ink: MUTED },
  open: { label: 'Needs funds', fill: 0xf0c987, ink: INK_CSS },
  funded: { label: 'Funded', fill: 0xc7dcb0, ink: INK_CSS },
  gathering: { label: 'Gathering', fill: 0xc7dcb0, ink: INK_CSS },
  building: { label: 'Building', fill: 0xa8cde0, ink: INK_CSS },
  puzzle: { label: 'Puzzle', fill: 0xe3b9d2, ink: INK_CSS },
  ready: { label: 'Ready to open', fill: 0xf3d36b, ink: INK_CSS },
  opened: { label: 'Open', fill: 0x8fc79a, ink: INK_CSS }
};

const carried = (bag: ReturnType<typeof Inventory.parse>, item: string): number => bag.slots.reduce((n, s) => n + (s?.item === item ? s.count : 0), 0);

/** The cards to show: each Project once, the house under way (or the next one to choose) for homes. */
function rows(state: E.ProjectsState): { def: ProjectDef; id: string | null }[] {
  return PROJECTS.flatMap(def => {
    if (def.id !== E.HOMES) return [{ def, id: state.projects[def.id] ? def.id : null }];
    return [{ def, id: E.activeHomes(state) }];
  });
}

export function drawProjectsPage(api: PageApi, registry: RegistryLike, now: { day: number; minute: number }, box: PageBox): void {
  const { g, text } = api;
  const state = projectsOf(registry), world = worldOf(registry, now);
  const town = registry.get('monde.town') as TownState | undefined;
  const bag = Inventory.parse(registry.get('monde.inventory') ?? {});
  const fund = town?.fund ?? 0;
  const list = rows(state);
  const cols = 2, gap = 12, cw = (box.w - gap) / cols, rowsN = Math.ceil(list.length / cols);
  const ch = Math.min(118, (box.h - gap * (rowsN - 1)) / rowsN);
  const homesDone = Object.values(state.projects).filter(p => p.def === E.HOMES && p.opened !== null).length;
  list.forEach(({ def, id }, i) => {
    const x = box.x + (i % cols) * (cw + gap), y = box.y + Math.floor(i / cols) * (ch + gap);
    const p = id ? state.projects[id] : undefined;
    const stage = E.stageOf(def, p, world);
    const look = STAGE_LOOK[stage];
    const dim = stage === 'locked';
    g.fillStyle(dim ? PAPER_DARK : 0xf7efdc, 1).fillRoundedRect(x, y, cw, ch, 8);
    g.lineStyle(1, BRASS, dim ? 0.35 : 0.7).strokeRoundedRect(x, y, cw, ch, 8);
    const name = def.id === E.HOMES ? (p?.target ? `Homes: ${projectName(def, p)}` : 'Homes') : capitalize(def.name);
    text(x + 12, y + 5, name, 19, { family: 'heading', color: dim ? MUTED : INK_CSS });
    // The stage pill.
    const pill = text(x + cw - 14, y + 9, look.label.toUpperCase(), 11, { family: 'ui', bold: true, color: look.ink, align: 'right' });
    g.fillStyle(look.fill, 1).fillRoundedRect(pill.x - pill.width - 8, y + 6, pill.width + 16, 19, 9);
    // Where, who leads, and the puzzle.
    const site = siteFor(def, p);
    const leads = def.leads.map(residentName).join(' & ');
    const where = site ? sitePlaceName(site.place) : 'a vacant house';
    const extra = def.id === E.HOMES ? ` · ${homesDone} restored` : def.stretch ? ' · stretch' : '';
    text(x + 12, y + 30, `${where} · Lead: ${leads}${extra}`, 12, { family: 'ui', color: MUTED });
    if (def.puzzle) {
      const solved = world.puzzleSolved(def.puzzle);
      text(x + cw - 12, y + 30, `${solved ? '✓' : '○'} ${def.puzzle} ${puzzles[def.puzzle]?.title ?? ''}`.trim(), 12, { family: 'ui', color: solved ? DONE_CSS : MUTED, align: 'right' });
    }
    // Fund and materials.
    const fundText = def.fund === 0 ? '✓ no Fund cost'
      : p?.funded != null ? `✓ ${def.fund} coins, Pell signed` : `○ ${def.fund} coins`;
    const mats = E.needs(def, world).map(m => {
      const have = p?.materials[m.item] ?? 0, c = carried(bag, m.item);
      return `${have >= m.count ? '✓' : '○'} ${materialNoun(m.item)} ${have}/${m.count}${have < m.count && c ? ` (+${c} carried)` : ''}`;
    }).join('  ·  ');
    text(x + 12, y + 47, `${fundText}${mats ? `  ·  ${mats}` : ''}`, 12, { family: 'ui', color: INK_CSS });
    // The hours bar.
    const by = y + 68, bw = cw - 24 - 130;
    if (def.vh > 0) {
      const vh = p?.vh ?? 0, pledged = p ? E.pledgedVh(state, id!) : 0;
      g.fillStyle(TRACK, 1).fillRect(x + 12, by, bw, 9);
      g.fillStyle(0x56b4e9, 0.45).fillRect(x + 12, by, (bw * Math.min(def.vh, pledged)) / def.vh, 9);
      g.fillStyle(0x0072b2, 1).fillRect(x + 12, by, (bw * Math.min(def.vh, vh)) / def.vh, 9);
      g.lineStyle(1, INK, 0.5).strokeRect(x + 12, by, bw, 9);
      const coming = Math.max(0, Math.min(def.vh, pledged) - vh);
      text(x + 20 + bw, by - 3, `${vh}/${def.vh} hours${coming ? ` · +${coming} due` : ''}`, 12, { family: 'ui', color: INK_CSS });
    } else text(x + 12, by - 3, 'No hours needed', 12, { family: 'ui', color: MUTED });
    // The next step.
    const next = E.nextStep(def, p, world, {
      fund, carried: item => carried(bag, item), count: materialCount, placeName: sitePlaceName, residentName
    });
    const homesHint = def.id === E.HOMES && !p && world.day >= (def.opens.day ?? 1) ? `Choose a vacant house on the board and press E at its door.` : next;
    text(x + 12, y + 82, homesHint, 12, { italic: true, color: stage === 'opened' ? DONE_CSS : BRASS_CSS, wrap: cw - 24 });
  });
}

/** One line for the Ledger's Town page: how the Projects stand. */
export function projectsSummary(registry: RegistryLike, now: { day: number; minute: number }): string {
  const state = projectsOf(registry), world = worldOf(registry, now);
  const counts = new Map<E.Stage, number>();
  for (const { def, progress } of E.begun(PROJECTS, state)) counts.set(E.stageOf(def, progress, world), (counts.get(E.stageOf(def, progress, world)) ?? 0) + 1);
  const open = counts.get('opened') ?? 0, under = [...counts.entries()].filter(([s]) => s !== 'opened').reduce((n, [, c]) => n + c, 0);
  return `Projects: ${open} open · ${under} under way · Tab for the Projects page`;
}
