import { describe, expect, it, vi } from 'vitest';
import { ClientEvent } from '@monde/shared';
import { applyPillarDelta, createTownState, DAY1_PILLARS, type TownState } from '../../town/pillars';
import type { ZoneDef } from '../../world/zoneFormat';
import { zones } from '../../world/zones';
import type { StorySave } from '../director';
import {
  ARRIVAL_STANDIN, DEFAULT_FELLOW, buildStoryContext, clipActivity, createStoryHandlers, decodeStory, emptyLedger, encodeStory, fellowSigned, metInScenes, placeAt,
  plainText, pronounWords, sceneName, STORY_META_KEY, summonText, syncTownFlags,
  scuffleEvent, type HandlerDeps, type StoryLedger, type StoryPresenter, type StoryWorld, type WorldNow
} from '../host';
import type { CueContext, HostCue, StoryHandlers, StoryLine } from '../runtime';
import { FlagStore } from '../flags';

const now = (over: Partial<WorldNow> = {}): WorldNow => ({ day: 1, minute: 590, zone: 'wharf', place: 'wharf.ferry_slip', ...over });

describe('buildStoryContext', () => {
  it('reads the clock, the place, the town engine and the default Fellow', () => {
    const ctx = buildStoryContext(now(), emptyLedger());
    expect(ctx).toMatchObject({ day: 1, minute: 590, weekday: 'tue', zone: 'wharf', place: 'wharf.ferry_slip', pillar: { ...DAY1_PILLARS } });
    expect(ctx.regard).toEqual({ arrival: 5 });
    expect(ctx.values).toMatchObject({
      name: 'Fellow', they: 'they', them: 'them', their: 'their', theyre: "they're",
      player: { name: 'Fellow', background: 'tinkerer', why: 'curious' }, census: 210, ferry_day: true, coins: 0,
      arrival: { ...ARRIVAL_STANDIN }
    });
    expect(typeof ctx.values!.appeal).toBe('number');
    expect(buildStoryContext(now({ day: 2 }), emptyLedger()).values!.ferry_day).toBe(false); // Wednesday
    expect(buildStoryContext(now({ day: 2 }), emptyLedger()).weekday).toBe('wed');
  });

  it("reads Regard from the game's mirror over the ledger's (the arrival keeps the ledger's)", () => {
    const ledger = { ...emptyLedger(), regard: { arrival: 5, pell: 3 } };
    expect(buildStoryContext(now({ regard: { pell: 23, odile: 20 } }), ledger).regard).toEqual({ arrival: 5, pell: 23, odile: 20 });
    expect(buildStoryContext(now(), ledger).regard).toEqual({ arrival: 5, pell: 3 });
  });

  it('uses the signed Fellowship application, the live town and any outcomes', () => {
    const town: TownState = applyPillarDelta(createTownState({ day: 3 }), 'spirit', 7, 'dev');
    const ledger: StoryLedger = { ...emptyLedger(), regard: { pell: 12 }, coins: 20 };
    const ctx = buildStoryContext(now({ day: 3, town, profile: { name: 'Ines', pronouns: 'she/her', background: 'homecomer', why: 'running_from_something' } }),
      ledger, { puzzle: { solved: true } });
    expect(ctx.pillar.spirit).toBe(DAY1_PILLARS.spirit + 7);
    expect(ctx.regard).toEqual({ pell: 12 });
    expect(ctx.values).toMatchObject({ name: 'Ines', they: 'she', their: 'her', theyre: "she's", coins: 20, puzzle: { solved: true },
      player: { name: 'Ines', background: 'homecomer', why: 'running' } });
  });

  it('passes sleeping and Scuffles through so the director defers', () => {
    expect(buildStoryContext(now({ asleep: true }), emptyLedger()).asleep).toBe(true);
    expect(buildStoryContext(now(), emptyLedger()).asleep).toBeUndefined();
  });
});

describe('small helpers', () => {
  it('fills pronoun tokens for presets and custom sets', () => {
    expect(pronounWords('he/him')).toEqual({ they: 'he', them: 'him', their: 'his', theyre: "he's" });
    expect(pronounWords('xe/xem/xyr')).toEqual({ they: 'xe', them: 'xem', their: 'xyr', theyre: "xe's" });
    expect(pronounWords('nonsense')).toEqual({ they: 'they', them: 'them', their: 'their', theyre: "they're" });
  });

  it('finds the place the player is at: a doorstep first, then the smallest rect around them', () => {
    const zone = { id: 'z', places: [
      { id: 'lane', rect: [0, 5, 20, 2], door: [1, 5] }, { id: 'square', rect: [4, 4, 4, 4], door: [6, 8] }, { id: 'shop', rect: [12, 0, 3, 3], door: [13, 3] }
    ] } as unknown as ZoneDef;
    expect(placeAt(zone, { x: 13.5, y: 3.5 })).toBe('z.shop');
    expect(placeAt(zone, { x: 5.5, y: 5.5 })).toBe('z.square');
    expect(placeAt(zone, { x: 15.5, y: 6.5 })).toBe('z.lane');
    expect(placeAt(zone, { x: 18.5, y: 1.5 })).toBe('');
    // The wharf's spawn is S01a's place.
    const wharf = zones.wharf!;
    expect(placeAt(wharf, { x: wharf.spawn[0] + 0.5, y: wharf.spawn[1] + 0.5 })).toBe('wharf.ferry_slip');
  });

  it('drops markdown emphasis the panel cannot style', () => {
    expect(plainText("The *Gannet*'s engine fades. **Loud** 2 * 3")).toBe("The Gannet's engine fades. Loud 2 * 3");
  });

  it('words summonses and clips a brief to the talk API', () => {
    expect(sceneName('S10a · Bloom Fair (opening)', 's10a')).toBe('Bloom Fair (opening)');
    expect(summonText({ place: 'commons.sundial_lawn' }, 'S10a · Bloom Fair (opening)', 'The Commons'))
      .toBe('Bloom Fair (opening) is starting: Sundial Lawn, The Commons.');
    const long = "Aurélien Monde's life and work, the first council's 1866 minute book, the Commons Charter (Margo calls it 'the record' or 'the claim', never 'the legend')";
    const clipped = clipActivity(long);
    expect(clipped.length).toBeLessThanOrEqual(120);
    expect(clipped.endsWith('…')).toBe(true);
    expect(long.startsWith(clipped.slice(0, -1))).toBe(true);
    expect(clipActivity('  short   brief ')).toBe('short brief');
  });
});

// ── Cues ────────────────────────────────────────────────────────────────────

function harness(opts: { presenter?: boolean; town?: TownState } = {}) {
  const ledger = emptyLedger();
  let town = opts.town ?? createTownState({ day: 1 });
  const events: ClientEvent[] = [];
  const outcomes: Record<string, unknown> = {};
  const warn = vi.fn();
  let ids = 0;
  const world: StoryWorld = {
    now: () => now({ town }),
    setTown: vi.fn((t: TownState) => { town = t; }),
    events: () => events,
    // As scenes/events.ts appendEvent: checked against the shared contract.
    appendEvent: vi.fn((e: ClientEvent) => { events.push(ClientEvent.parse(e)); }),
    newId: () => `e${++ids}`,
    persist: vi.fn(),
    checkpoint: vi.fn(async () => {}),
    travel: vi.fn(),
    zoneName: id => id,
    aiLine: vi.fn(async (id: string): Promise<readonly StoryLine[]> => [{ kind: 'say', speaker: id, text: 'A live line.' }])
  };
  const presenter: StoryPresenter = {
    backdrop: vi.fn(), music: vi.fn(), fade: vi.fn(async () => {}), wait: vi.fn(async () => {}),
    cam: vi.fn((effect: string) => effect === 'shake'), sfx: vi.fn((id: string) => id === 'bell'), thinking: vi.fn(),
    confirm: vi.fn(async () => true), placeholder: vi.fn(async () => true), puzzle: vi.fn(async () => true), charcreate: vi.fn(async () => false),
    aiOpen: vi.fn(async () => [])
  };
  const deps: HandlerDeps = {
    dev: true, warn, ledger: () => ledger, world: () => world, presenter: () => (opts.presenter === false ? null : presenter),
    setOutcome: (name, value) => { outcomes[name] = value; }, scenePlace: id => (id === 's01a_ferry' ? 'wharf.ferry_slip' : '')
  };
  const handlers = createStoryHandlers(deps);
  const ctx = (key: string, scene = 's01a_ferry'): CueContext => ({ scene, key, game: buildStoryContext(now(), ledger), flags: new FlagStore({ dev: true }) });
  const run = async <K extends HostCue['cmd']>(cue: Extract<HostCue, { cmd: K }>, key = 's01a_ferry:1', scene?: string) =>
    (handlers[cue.cmd] as NonNullable<StoryHandlers[K]>)(cue, ctx(key, scene));
  return { ledger, events, outcomes, warn, world, presenter, run, town: () => town };
}

describe('cue → effect', () => {
  it('mirrors Regard, queues it as scripted_regard with its scene and cue, once per cue position', async () => {
    const h = harness();
    await h.run({ cmd: 'regard', resident: 'pell', delta: 3 }, 's01a_ferry:12:choice:0:0');
    await h.run({ cmd: 'regard', resident: 'pell', delta: 3 }, 's01a_ferry:12:choice:0:0'); // a restarted scene
    await h.run({ cmd: 'regard', resident: 'pell', delta: 2 }, 's01a_ferry:40');
    expect(h.ledger.regard.pell).toBe(5);
    expect(h.events).toEqual([
      { kind: 'scripted_regard', id: 'e1', day: 1, minute: 590, resident: 'pell', delta: 3, scene_id: 's01a_ferry', cue_key: 's01a_ferry:12:choice:0:0' },
      { kind: 'scripted_regard', id: 'e2', day: 1, minute: 590, resident: 'pell', delta: 2, scene_id: 's01a_ferry', cue_key: 's01a_ferry:40' }
    ]);
  });

  it("doesn't queue a cue the log already has (a restart whose ledger was lost)", async () => {
    const h = harness();
    await h.run({ cmd: 'regard', resident: 'pell', delta: 3 }, 's01a_ferry:12');
    h.ledger.applied = [];
    await h.run({ cmd: 'regard', resident: 'pell', delta: 3 }, 's01a_ferry:12');
    expect(h.events).toHaveLength(1);
  });

  it('moves Pillars through the town engine (story source, clamped there) once', async () => {
    const h = harness();
    await h.run({ cmd: 'pillar', pillar: 'spirit', delta: 2 }, 's04:9', 's04_water_again');
    await h.run({ cmd: 'pillar', pillar: 'spirit', delta: 2 }, 's04:9', 's04_water_again');
    expect(h.town().pillars.spirit).toBe(DAY1_PILLARS.spirit + 2);
    expect(h.town().log.at(-1)).toMatchObject({ pillar: 'spirit', source: 'story', applied: 2, note: 's04_water_again' });
  });

  it('keeps coins, items, Projects and riddles in the ledger', async () => {
    const h = harness();
    await h.run({ cmd: 'coins', delta: 20 }, 'a');
    await h.run({ cmd: 'coins', delta: -5 }, 'b');
    await h.run({ cmd: 'item', item: 'lantern_pinion', delta: 1 }, 'c');
    await h.run({ cmd: 'item', item: 'lantern_pinion', delta: -1 }, 'd');
    await h.run({ cmd: 'item', item: 'lantern_pinion', delta: -1 }, 'e');
    await h.run({ cmd: 'project', id: 'fountain' }, 'f');
    await h.run({ cmd: 'riddle', id: 'OQ-1' }, 'g');
    expect(h.ledger).toMatchObject({ coins: 15, items: { lantern_pinion: 0 }, projects: ['fountain'], riddles: ['OQ-1'] });
    expect(h.outcomes.riddle).toEqual({ solved: false });
  });

  it('names the residents a scene introduced (their met_ flags), for the Journal', () => {
    expect(metInScenes(['s01a_done', 'met_pell', 'met_tollmen', 'met_moss', 'metal'], id => ['pell', 'moss'].includes(id))).toEqual(['pell', 'moss']);
  });

  it('puts {coins} in the purse (G-09), once per cue', async () => {
    const h = harness();
    const purse = vi.fn();
    h.world.coins = purse;
    await h.run({ cmd: 'coins', delta: 20 }, 's01c_cottage:24', 's01c_cottage');
    await h.run({ cmd: 'coins', delta: 20 }, 's01c_cottage:24', 's01c_cottage');
    await h.run({ cmd: 'coins', delta: -20 }, 's03_tolls:40', 's03_tolls');
    expect(purse.mock.calls).toEqual([[20], [-20]]);
    expect(h.ledger.coins).toBe(0);
  });

  it('hands {project} to the Projects engine (G-03) once per cue, with the scene that cued it', async () => {
    const h = harness();
    const projectCue = vi.fn((id: string) => id === 'fountain');
    h.world.projectCue = projectCue;
    await h.run({ cmd: 'project', id: 'fountain' }, 's04:43', 's04_water_again');
    await h.run({ cmd: 'project', id: 'fountain' }, 's04:43', 's04_water_again'); // a restarted scene
    await h.run({ cmd: 'project', id: 'station' }, 's11:70', 's11_station');
    expect(projectCue.mock.calls).toEqual([['fountain', 's04_water_again'], ['station', 's11_station']]);
    expect(h.ledger.projects).toEqual(['fountain', 'station']);
    expect(h.warn).toHaveBeenCalledWith(expect.stringContaining('{project: station} is not one of'));
  });

  it('queues scripted memories as scripted_memory with the scene, cue and place', async () => {
    const h = harness();
    await h.run({ cmd: 'memory', resident: 'moss', text: 'Brought the Fellow in.', importance: 4 }, 's01a_ferry:90');
    await h.run({ cmd: 'memory', resident: 'moss', text: 'Brought the Fellow in.', importance: 4 }, 's01a_ferry:90');
    await h.run({ cmd: 'memory', resident: 'arrival', text: 'Stepped off.', importance: 6 }, 's05:3', 's05_first_arrival');
    expect(h.events).toHaveLength(2);
    expect(h.events[0]).toEqual({
      kind: 'scripted_memory', id: 'e1', day: 1, minute: 590, resident: 'moss', place: 'wharf.ferry_slip', text: 'Brought the Fellow in.', importance: 4,
      scene_id: 's01a_ferry', cue_key: 's01a_ferry:90'
    });
    // The arrival alias is queued as it is (mind/events.ts holds it back from the server until it has a real id).
    expect(h.events[1]).toMatchObject({ kind: 'scripted_memory', resident: 'arrival', place: 'wharf.ferry_slip', scene_id: 's05_first_arrival' });
  });

  it('persists before a checkpoint and survives a failing one', async () => {
    const h = harness();
    await h.run({ cmd: 'checkpoint', key: 'campaign_season' });
    expect(h.world.persist).toHaveBeenCalled();
    expect(h.world.checkpoint).toHaveBeenCalledWith('campaign_season');
    (h.world.checkpoint as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('disk full'));
    await expect(h.run({ cmd: 'checkpoint', key: 'campaign_season' })).resolves.toBeUndefined();
    expect(h.warn).toHaveBeenCalledWith(expect.stringContaining('disk full'));
  });

  it('sends presentation cues to the presenter and warns about what it lacks', async () => {
    const h = harness();
    await h.run({ cmd: 'backdrop', id: 'bg_ferry_slip_morning' });
    await h.run({ cmd: 'music', id: 'arrival_theme' });
    await h.run({ cmd: 'fade' });
    await h.run({ cmd: 'wait' });
    await h.run({ cmd: 'wait', seconds: 3 });
    await h.run({ cmd: 'cam', effect: 'shake' });
    await h.run({ cmd: 'cam', effect: 'spin' });
    await h.run({ cmd: 'sfx', id: 'bell' });
    await h.run({ cmd: 'sfx', id: 'kazoo' });
    expect(h.presenter.backdrop).toHaveBeenCalledWith('bg_ferry_slip_morning');
    expect(h.presenter.music).toHaveBeenCalledWith('arrival_theme');
    expect(h.presenter.fade).toHaveBeenCalledTimes(1);
    expect(h.presenter.wait).toHaveBeenNthCalledWith(1, 1);
    expect(h.presenter.wait).toHaveBeenNthCalledWith(2, 3);
    expect(h.warn.mock.calls.map(c => String(c[0]))).toEqual([expect.stringContaining('spin'), expect.stringContaining('kazoo')]);
  });

  it('carries on without a presenter', async () => {
    const h = harness({ presenter: false });
    await h.run({ cmd: 'fade' });
    await h.run({ cmd: 'puzzle', id: 'PZ-03' });
    expect(h.outcomes.puzzle).toEqual({ solved: false });
    expect(h.warn).toHaveBeenCalledWith(expect.stringContaining('fade'));
  });

  it('awaits the real puzzle and Scuffle presenters', async () => {
    const h = harness();
    await h.run({ cmd: 'puzzle', id: 'PZ-01' });
    h.presenter.scuffle = vi.fn(async () => 'loss' as const);
    await h.run({ cmd: 'scuffle', id: 'sc_bakery_tutorial' });
    expect(h.presenter.puzzle).toHaveBeenCalledWith('PZ-01');
    expect(h.presenter.scuffle).toHaveBeenCalledWith('sc_bakery_tutorial', expect.any(String));
    expect(h.presenter.placeholder).not.toHaveBeenCalled();
    expect(h.outcomes).toMatchObject({ puzzle: { solved: true }, scuffle: { won: false } });
  });

  it('logs a story Scuffle as a §9.6 town event (importance 7) once, with the player and its enemies', async () => {
    const h = harness();
    await h.run({ cmd: 'scuffle', id: 'sc_bakery_tutorial' }, 's03:71', 's01a_ferry');
    await h.run({ cmd: 'scuffle', id: 'sc_bakery_tutorial' }, 's03:71', 's01a_ferry'); // a restarted scene
    expect(h.events).toEqual([{
      kind: 'town_event', id: 'e1', day: 1, minute: 590, type: 'scuffle', place: 'wharf.ferry_slip', participants: ['player', 'bru', 'nettie'],
      summary: 'Fellow lost a Scuffle against Bru and Nettie at Ferry Slip.', importance: 7
    }]);
    const lost = scuffleEvent({ id: 'x', day: 3, minute: 700 }, 'sc_unknown', 'market_row.bakery', false, { values: { name: 'Wren' } });
    expect(lost).toMatchObject({ participants: ['player'], summary: 'Wren lost a Scuffle at Fournier & Fille.' });
  });

  it('hands {ai_line} to the world and {ai_open} to the presenter at the scene place', async () => {
    const h = harness();
    const lines = await h.run({ cmd: 'ai_line', slot: 'fair_roz_low', speaker: { id: 'rosalind', auto: false }, brief: 'One sentence.', fallback: 'Sixty cups.' });
    expect(lines).toEqual([{ kind: 'say', speaker: 'rosalind', text: 'A live line.' }]);
    expect(h.presenter.thinking).toHaveBeenCalledWith('rosalind');
    expect(h.world.aiLine).toHaveBeenCalledWith('rosalind', 'One sentence.');
    await h.run({ cmd: 'ai_open', resident: 'margo', topic: 'The record.', turns: 3 });
    expect(h.presenter.aiOpen).toHaveBeenCalledWith({ cmd: 'ai_open', resident: 'margo', topic: 'The record.', turns: 3 }, 'wharf.ferry_slip');
  });

  it('opens the Fellowship form, and warns when there is none', async () => {
    const h = harness();
    await h.run({ cmd: 'charcreate' });
    expect(h.presenter.charcreate).toHaveBeenCalled();
    expect(h.warn).toHaveBeenCalledWith(expect.stringContaining('no Fellowship form'));
  });

  it('opens the form for an unsigned New Game (no profile yet)', async () => {
    const h = harness();
    const base = h.world.now();
    h.world.now = () => ({ ...base, profile: null });
    await h.run({ cmd: 'charcreate' });
    expect(h.presenter.charcreate).toHaveBeenCalledTimes(1);
  });

  it("skips the form when this game's application is already signed", async () => {
    const h = harness();
    const base = h.world.now();
    h.world.now = () => ({ ...base, profile: { name: 'Wren', pronouns: 'they/them', background: 'homecomer', why: 'running' } });
    await h.run({ cmd: 'charcreate' });
    expect(h.presenter.charcreate).not.toHaveBeenCalled();
    expect(fellowSigned({ ...DEFAULT_FELLOW })).toBe(false);
    expect(fellowSigned(null)).toBe(false);
    expect(fellowSigned({ ...DEFAULT_FELLOW, why: 'to_help' })).toBe(true);
  });
});

describe('town flags and the save', () => {
  it('copies story flags the town engine reads into the town', () => {
    const town = createTownState({ day: 18 });
    expect(syncTownFlags(town, new Set(['met_pell']))).toBe(town);
    expect(syncTownFlags(town, new Set(['option_known', 'met_pell'])).flags).toEqual({ option_known: true });
  });

  it('round-trips the director and ledger through story_flags', () => {
    const save: StorySave = { version: 1, flags: ['met_pell', 's01a_done'], completed: ['s01a_ferry'], queue: [{ id: 's01b_walk', restart: true }],
      active: { id: 's01b_walk', initialFlags: ['met_pell', 's01a_done'] } };
    const ledger: StoryLedger = { ...emptyLedger(), regard: { arrival: 5, pell: 6 }, coins: 20, items: { key: 1 }, applied: ['s01a_ferry|x'] };
    const record = encodeStory(save, ledger);
    expect(record.met_pell).toBe(true);
    expect(typeof record[STORY_META_KEY]).toBe('string');
    expect(decodeStory(JSON.parse(JSON.stringify(record)))).toEqual({ save, ledger });
  });

  it('reads flags-only and broken records without throwing', () => {
    expect(decodeStory({ met_pell: true, legacy_count: 3 }).save).toEqual({ version: 1, flags: ['met_pell'], completed: [], queue: [] });
    const broken = decodeStory({ met_ada: true, [STORY_META_KEY]: '{not json' });
    expect(broken.save.flags).toEqual(['met_ada']);
    expect(broken.ledger).toEqual(emptyLedger());
    expect(decodeStory(undefined).save.flags).toEqual([]);
    const odd = decodeStory({ [STORY_META_KEY]: JSON.stringify({ queue: [{ id: 3 }, { id: 's02_marks', from: 's01c_cottage' }], ledger: { coins: 'lots', regard: { pell: 'x', ada: 2 } } }) });
    expect(odd.save.queue).toEqual([{ id: 's02_marks', from: 's01c_cottage' }]);
    expect(odd.ledger).toMatchObject({ coins: 0, regard: { arrival: 5, ada: 2 } });
  });
});
