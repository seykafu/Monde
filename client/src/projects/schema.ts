// content/projects.yaml as types (GDD §6.3, MVP G-03), and its parser. Pure: no Phaser, no DOM, no Vite imports,
// so tools/lint-content.ts reads the file through this too. The parser checks shape and throws naming the Project
// and field; cross-checks against items, places, residents, puzzles and scenes are the linter's (they need the rest
// of content/).
import type { Pillar } from '@monde/shared';

export type Rect = readonly [number, number, number, number];
export type SignoffBy = 'pell' | 'scene' | 'none';

export interface MaterialNeed { item: string; count: number }
export interface MaterialDonor { resident: string; item: string; count: number; line: string }
export interface CeremonyLine { speaker: string; expr?: string; text: string; reveal?: boolean }
export interface CeremonyMemory { resident: string; text: string; importance: number }

export interface ProjectDef {
  id: string;
  /** In a sentence: "the fountain", "the Market Hall". */
  name: string;
  zone: string;
  /** §6.3 step 1. `cue`: only that scene's {project: id} opens it (on or after `day`). */
  opens: { day?: number; flag?: string; cue?: string };
  signoff: { by: SignoffBy; line?: string };
  fund: number;
  materials: readonly MaterialNeed[];
  vh: number;
  puzzle?: string;
  bonusPuzzle?: string;
  leads: readonly string[];
  /** `house` for `homes`: the house being restored (and `door`, the pavement in front of it). */
  site: { place: string; work: { place: string; area: Rect | 'door' } };
  shift?: readonly [string, string];
  donors: readonly MaterialDonor[];
  /** Residents a scene signs on for every day until the hours are in. */
  standing: readonly { scene: string; resident: string }[];
  complete: { pillars: Partial<Record<Pillar, number>>; flags: readonly string[]; homes: number; effects: readonly string[] };
  ceremony: { at?: string; scene?: string; summary: string; lines: readonly CeremonyLine[]; memories: readonly CeremonyMemory[] };
  repeatable: boolean;
  stretch: boolean;
}

export interface ProjectsContent {
  projects: readonly ProjectDef[];
  shopStock: Readonly<Record<string, { count: number; restock: number }>>;
  shift: readonly [string, string];
  pell: { short: string; signed: string; wait: string };
  asks: {
    yes: Readonly<Record<string, string>>; no: Readonly<Record<string, string>>; busy: string;
    donateYes: Readonly<Record<string, string>>; donateNo: Readonly<Record<string, string>>; donated: string;
  };
}

const PILLAR_KEYS = ['prosperity', 'safety', 'spirit', 'charm'] as const;
const ID = /^[a-z][a-z0-9_]*$/;
const PLACE = /^[a-z_]+\.[a-z0-9_]+$/;
const TIME = /^\d{1,2}:\d{2}$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

class Reader {
  constructor(private readonly where: string) {}
  fail(field: string, why: string): never { throw new Error(`projects.yaml ${this.where}: ${field} ${why}`); }
  obj(v: unknown, field: string): Obj { if (!isObj(v)) this.fail(field, 'must be a mapping'); return v as Obj; }
  str(v: unknown, field: string, re?: RegExp): string {
    if (typeof v !== 'string' || !v.trim()) this.fail(field, 'must be a non-empty string');
    if (re && !re.test(v as string)) this.fail(field, `"${String(v)}" has the wrong form`);
    return v as string;
  }
  optStr(v: unknown, field: string, re?: RegExp): string | undefined { return v === undefined ? undefined : this.str(v, field, re); }
  int(v: unknown, field: string, min = 0): number {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min) this.fail(field, `must be a whole number ≥ ${min}`);
    return v as number;
  }
  list(v: unknown, field: string): unknown[] {
    if (v === undefined) return [];
    if (!Array.isArray(v)) this.fail(field, 'must be a list');
    return v as unknown[];
  }
  strings(v: unknown, field: string, re?: RegExp): string[] { return this.list(v, field).map((s, i) => this.str(s, `${field}[${i}]`, re)); }
  rect(v: unknown, field: string): Rect {
    if (!Array.isArray(v) || v.length !== 4 || !v.every(n => Number.isInteger(n) && n >= 0)) this.fail(field, 'must be [x, y, w, h]');
    const [x, y, w, h] = v as number[];
    if (w! < 1 || h! < 1) this.fail(field, 'needs a width and height of at least 1');
    return [x!, y!, w!, h!];
  }
  time(v: unknown, field: string): string { return this.str(v, field, TIME); }
  lines(v: unknown, field: string): Record<string, string> {
    const o = this.obj(v, field);
    if (typeof o.default !== 'string') this.fail(field, 'needs a default line');
    return Object.fromEntries(Object.entries(o).map(([k, s]) => [k, this.str(s, `${field}.${k}`)]));
  }
}

function parseProject(raw: unknown, index: number): ProjectDef {
  const top = new Reader(`projects[${index}]`).obj(raw, 'entry');
  const r = new Reader(typeof top.id === 'string' ? top.id : `projects[${index}]`);
  const id = r.str(top.id, 'id', ID);
  const opens = r.obj(top.opens, 'opens');
  const signoff = r.obj(top.signoff, 'signoff');
  const by = r.str(signoff.by, 'signoff.by');
  if (!['pell', 'scene', 'none'].includes(by)) r.fail('signoff.by', 'must be pell, scene or none');
  if (by === 'scene' && typeof opens.cue !== 'string') r.fail('signoff.by', 'scene needs opens.cue (the scene that signs)');
  const fund = r.int(top.fund, 'fund');
  if (by === 'none' && fund !== 0) r.fail('fund', 'must be 0 when nobody signs');
  const site = r.obj(top.site, 'site');
  const work = r.obj(site.work, 'site.work');
  const repeatable = top.repeatable === true;
  const house = repeatable && site.place === 'house';
  const place = house ? 'house' : r.str(site.place, 'site.place', PLACE);
  const workPlace = house ? 'house' : r.str(work.place, 'site.work.place', PLACE);
  const area = house && work.area === 'door' ? 'door' as const : r.rect(work.area, 'site.work.area');
  const complete = r.obj(top.complete ?? {}, 'complete');
  const pillarsRaw = r.obj(complete.pillars ?? {}, 'complete.pillars');
  const pillars: Partial<Record<Pillar, number>> = {};
  for (const [k, v] of Object.entries(pillarsRaw)) {
    if (!(PILLAR_KEYS as readonly string[]).includes(k)) r.fail('complete.pillars', `has an unknown Pillar "${k}"`);
    if (typeof v !== 'number' || !Number.isFinite(v)) r.fail(`complete.pillars.${k}`, 'must be a number');
    pillars[k as Pillar] = v as number;
  }
  const ceremony = r.obj(top.ceremony, 'ceremony');
  const lines = r.list(ceremony.lines, 'ceremony.lines').map((l, i) => {
    const o = r.obj(l, `ceremony.lines[${i}]`);
    return {
      speaker: r.str(o.speaker, `ceremony.lines[${i}].speaker`, ID), text: r.str(o.text, `ceremony.lines[${i}].text`),
      ...(o.expr !== undefined ? { expr: r.str(o.expr, `ceremony.lines[${i}].expr`, ID) } : {}),
      ...(o.reveal === true ? { reveal: true } : {})
    };
  });
  const scene = r.optStr(ceremony.scene, 'ceremony.scene', ID);
  if (!scene && lines.filter(l => l.reveal).length !== 1) r.fail('ceremony.lines', 'need exactly one reveal line (the moment the town changes)');
  const shift = top.shift === undefined ? undefined : (() => {
    const s = r.list(top.shift, 'shift');
    if (s.length !== 2) r.fail('shift', 'must be [start, end]');
    return [r.time(s[0], 'shift[0]'), r.time(s[1], 'shift[1]')] as const;
  })();
  const vh = r.int(top.vh, 'vh');
  const materials = r.list(top.materials, 'materials').map((m, i) => {
    const o = r.obj(m, `materials[${i}]`);
    return { item: r.str(o.item, `materials[${i}].item`, ID), count: r.int(o.count, `materials[${i}].count`, 1) };
  });
  if (new Set(materials.map(m => m.item)).size !== materials.length) r.fail('materials', 'lists an item twice');
  const leads = r.strings(top.leads, 'leads', ID);
  if (!leads.length) r.fail('leads', 'needs a lead resident');
  return {
    id, name: r.str(top.name, 'name'), zone: r.str(top.zone, 'zone', ID),
    opens: {
      ...(opens.day !== undefined ? { day: r.int(opens.day, 'opens.day', 1) } : {}),
      ...(opens.flag !== undefined ? { flag: r.str(opens.flag, 'opens.flag', ID) } : {}),
      ...(opens.cue !== undefined ? { cue: r.str(opens.cue, 'opens.cue', ID) } : {})
    },
    signoff: { by: by as SignoffBy, ...(signoff.line !== undefined ? { line: r.str(signoff.line, 'signoff.line') } : {}) },
    fund, materials, vh,
    ...(top.puzzle !== undefined ? { puzzle: r.str(top.puzzle, 'puzzle', /^PZ-\d{2}$/) } : {}),
    ...(top.bonus_puzzle !== undefined ? { bonusPuzzle: r.str(top.bonus_puzzle, 'bonus_puzzle', /^PZ-\d{2}$/) } : {}),
    leads,
    site: { place, work: { place: workPlace, area } },
    ...(shift ? { shift } : {}),
    donors: r.list(top.donors, 'donors').map((d, i) => {
      const o = r.obj(d, `donors[${i}]`);
      const item = r.str(o.item, `donors[${i}].item`, ID);
      if (!materials.some(m => m.item === item)) r.fail(`donors[${i}].item`, `"${item}" isn't one of the materials`);
      return { resident: r.str(o.resident, `donors[${i}].resident`, ID), item, count: r.int(o.count, `donors[${i}].count`, 1), line: r.str(o.line, `donors[${i}].line`) };
    }),
    standing: r.list(top.standing, 'standing').map((s, i) => {
      const o = r.obj(s, `standing[${i}]`);
      return { scene: r.str(o.scene, `standing[${i}].scene`, ID), resident: r.str(o.resident, `standing[${i}].resident`, ID) };
    }),
    complete: {
      pillars, flags: r.strings(complete.flags, 'complete.flags', ID),
      homes: complete.homes === undefined ? 0 : r.int(complete.homes, 'complete.homes'), effects: r.strings(complete.effects, 'complete.effects', ID)
    },
    ceremony: {
      ...(ceremony.at !== undefined ? { at: r.time(ceremony.at, 'ceremony.at') } : {}),
      ...(scene ? { scene } : {}),
      summary: r.str(ceremony.summary, 'ceremony.summary'), lines,
      memories: r.list(ceremony.memories, 'ceremony.memories').map((m, i) => {
        const o = r.obj(m, `ceremony.memories[${i}]`);
        return { resident: r.str(o.resident, `ceremony.memories[${i}].resident`, ID), text: r.str(o.text, `ceremony.memories[${i}].text`), importance: r.int(o.importance, `ceremony.memories[${i}].importance`, 1) };
      })
    },
    repeatable, stretch: top.stretch === true
  };
}

/** The whole file. Throws on the first problem, naming the Project and field. */
export function parseProjects(raw: unknown): ProjectsContent {
  const r = new Reader('(file)');
  const top = r.obj(raw, 'file');
  const projects = r.list(top.projects, 'projects').map(parseProject);
  const ids = projects.map(p => p.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) r.fail('projects', `has "${dup}" twice`);
  const stock = r.obj(top.shop_stock ?? {}, 'shop_stock');
  const shift = r.list(top.shift, 'shift');
  if (shift.length !== 2) r.fail('shift', 'must be [start, end]');
  const pell = r.obj(top.pell, 'pell');
  const asks = r.obj(top.asks, 'asks');
  return {
    projects,
    shopStock: Object.fromEntries(Object.entries(stock).map(([item, v]) => {
      const o = r.obj(v, `shop_stock.${item}`);
      return [item, { count: r.int(o.count, `shop_stock.${item}.count`), restock: r.int(o.restock ?? 0, `shop_stock.${item}.restock`) }];
    })),
    shift: [r.time(shift[0], 'shift[0]'), r.time(shift[1], 'shift[1]')],
    pell: { short: r.str(pell.short, 'pell.short'), signed: r.str(pell.signed, 'pell.signed'), wait: r.str(pell.wait, 'pell.wait') },
    asks: {
      yes: r.lines(asks.yes, 'asks.yes'), no: r.lines(asks.no, 'asks.no'), busy: r.str(asks.busy, 'asks.busy'),
      donateYes: r.lines(asks.donate_yes, 'asks.donate_yes'), donateNo: r.lines(asks.donate_no, 'asks.donate_no'),
      donated: r.str(asks.donated, 'asks.donated')
    }
  };
}

/** `{name}`-style placeholders filled from `vars`; unknown ones are left as written. */
export const fillLine = (text: string, vars: Readonly<Record<string, string | number>>): string =>
  text.replace(/\{([a-z_]+)\}/g, (whole, key: string) => (vars[key] !== undefined ? String(vars[key]) : whole));
