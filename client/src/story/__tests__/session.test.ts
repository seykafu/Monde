// The story session against the real compiled Spring scenes, with a fake world and presenter.
import { describe, expect, it, vi } from 'vitest';
import { createTownState, type TownState } from '../../town/pillars';
import { decodeStory, type OfflineEvent, type StoryPresenter, type StoryWorld, type WorldNow } from '../host';
import type { StoryLine } from '../runtime';
import { SPRING_SCENES, StorySession, SUMMON_COOLDOWN_MINUTES } from '../session';

function fakeWorld(start: Partial<WorldNow> = {}) {
  const state: WorldNow & { town: TownState } = { day: 1, minute: 590, zone: 'wharf', place: 'wharf.ferry_slip', town: createTownState({ day: 1 }), ...start };
  const events: OfflineEvent[] = [];
  const world: StoryWorld = {
    now: () => ({ ...state }),
    setTown: t => { state.town = t; },
    events: () => events,
    appendEvent: e => { events.push(e); },
    persist: vi.fn(),
    checkpoint: vi.fn(async () => {}),
    travel: vi.fn((place: string) => { state.zone = place.split('.')[0]!; state.place = place; }),
    zoneName: id => (id === 'commons' ? 'The Commons' : id),
    aiLine: vi.fn(async (): Promise<readonly StoryLine[]> => [])
  };
  return { state, events, world };
}

function fakePresenter(over: Partial<StoryPresenter> = {}): StoryPresenter {
  return {
    backdrop: vi.fn(), music: vi.fn(), fade: vi.fn(async () => {}), wait: vi.fn(async () => {}), cam: vi.fn(() => true), sfx: vi.fn(() => true),
    thinking: vi.fn(), confirm: vi.fn(async () => true), placeholder: vi.fn(async () => true), charcreate: vi.fn(async () => true),
    aiOpen: vi.fn(async () => []), ...over
  };
}

/** Play whatever the director starts until it has nothing, picking the first option every time. */
async function playOut(session: StorySession): Promise<StoryLine[]> {
  const lines: StoryLine[] = [];
  for (let n = 0; n < 2000; n++) {
    const step = await session.director.next();
    if (!step) return lines;
    if (step.kind === 'line') lines.push(step.line);
    if (step.kind === 'choice') await session.director.choose(0);
  }
  throw new Error('scene did not end');
}

describe('StorySession', () => {
  it('ships the ten Spring beats', () => {
    const ids = SPRING_SCENES.filter(s => s.header).map(s => s.id);
    expect(ids).toEqual(['s01a_ferry', 's01b_walk', 's01c_cottage', 's02_marks', 's03_tolls', 's04_water_again', 's05_first_arrival', 's05b_empty_boat',
      's06_good_coat', 's07a_chime_runs', 's07b_chime_loan', 's08_option', 's09_pell_confession', 's10a_bloom_open', 's10b_bloom_close']);
  });

  it('plays S01a on the ferry slip at 09:50 on Day 1 with every cue landing somewhere', async () => {
    const { world, events } = fakeWorld();
    const warn = vi.fn();
    const session = new StorySession({ world, dev: true, warn });
    const presenter = fakePresenter();
    session.presenter = presenter;
    expect(session.ready()).toBe(true);
    const lines = await playOut(session);
    expect(session.flags.serialize()).toEqual(expect.arrayContaining(['s01a_done', 'met_pell', 'met_moss', 'met_ada', 'return_ticket_kept']));
    expect(presenter.backdrop).toHaveBeenCalledWith('bg_ferry_slip_morning');
    expect(presenter.music).toHaveBeenCalledWith('arrival_theme');
    expect(presenter.charcreate).toHaveBeenCalledTimes(1);
    expect(session.ledger.regard).toMatchObject({ pell: 3, ada: 1 });
    expect(events.filter(e => e.type === 'memory').map(e => e.resident_id)).toEqual(['pell', 'moss', 'ada']);
    expect(lines.find(l => l.text.includes('{'))).toBeUndefined();
    expect(lines.some(l => l.text.startsWith('Fellow. Good.'))).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    // Done: nothing more on the slip today.
    expect(session.ready()).toBe(false);
  });

  it('restores from its snapshot, restarting a scene in progress without applying its effects twice', async () => {
    const { world, events } = fakeWorld();
    const session = new StorySession({ world, dev: true, warn: vi.fn() });
    session.presenter = fakePresenter();
    // Into S01a as far as the first choice, and pick it: Regard +3 for Pell.
    let step = await session.director.next();
    while (step && step.kind !== 'choice') step = await session.director.next();
    await session.director.choose(0);
    expect(session.ledger.regard.pell).toBe(3);
    const saved = JSON.parse(JSON.stringify(session.snapshot()));
    expect(decodeStory(saved).save.active?.id).toBe('s01a_ferry');

    const again = new StorySession({ world, dev: true, warn: vi.fn(), saved });
    again.presenter = fakePresenter();
    expect(again.ready()).toBe(true);
    await playOut(again);
    expect(again.ledger.regard.pell).toBe(3); // the restart replays the choice; its Regard was already applied
    expect(again.flags.has('s01a_done')).toBe(true);
    expect(events.filter(e => e.type === 'regard' && e.resident_id === 'pell')).toHaveLength(1);
  });

  it('summons the player to Bloom Fair, waits after a "Not yet", then travels', async () => {
    const { world, state } = fakeWorld({ day: 25, minute: 720, zone: 'old_quarter', place: 'old_quarter.library' });
    const confirm = vi.fn(async () => false);
    const session = new StorySession({ world, dev: true, warn: vi.fn() });
    session.presenter = fakePresenter({ confirm });
    expect(session.ready()).toBe(true);
    expect(await session.director.next()).toBeNull();
    expect(confirm).toHaveBeenCalledWith('Bloom Fair (opening) is starting: Sundial Lawn, The Commons.', 'Go now', 'Not yet');
    expect(session.ready()).toBe(false); // cooling down
    state.minute += SUMMON_COOLDOWN_MINUTES;
    expect(session.ready()).toBe(true);
    confirm.mockResolvedValueOnce(true);
    const step = await session.director.next();
    expect(step).not.toBeNull();
    expect(world.travel).toHaveBeenCalledWith('commons.sundial_lawn');
    expect(session.active).toBe('s10a_bloom_open');
    expect(session.context().place).toBe('commons.sundial_lawn');
  });

  it('plays any scene on request (?scene=, __story.play) whatever its window', async () => {
    const { world } = fakeWorld({ day: 1, minute: 360, zone: 'old_quarter', place: '' });
    const session = new StorySession({ world, dev: true, warn: vi.fn() });
    session.presenter = fakePresenter();
    expect(session.ready()).toBe(false);
    expect(session.play('nope')).toBe(false);
    expect(session.play('s02_marks')).toBe(true);
    expect(session.ready()).toBe(true);
    await playOut(session);
    expect(session.flags.has('s02_done')).toBe(true);
  });
});
