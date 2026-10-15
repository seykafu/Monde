import { describe, expect, it } from 'vitest';
import { SaveGame, emptyEventLog, emptyFriendship, migrateSave } from '@monde/shared';
import { applyDawn, meet, recordTurn } from '../../friendship/state';
import { learnTies, tieIndex } from '../../friendship/knownTies';
import { parseDawnPackage } from '../../mind/dawn';
import { Clock } from '../../sim/clock';
import { dailyWeather } from '../../sim/weather';
import { createTownState } from '../../town/pillars';
import { emptyQuietState } from '../../mind/quietMode';
import { baseSkills } from '@monde/shared';
import { collect, type GameState } from '../collect';

const base = (friendship?: GameState['friendship']): GameState => ({
  clock: new Clock({ day: 5, minute: 600 }), town: createTownState({ day: 5 }), player: { zone: 'old_quarter', x: 10.5, y: 10.5, facing: 0 },
  weather: { seed: 1, daily: dailyWeather(1, 5), override: null }, story_flags: {}, quiet: emptyQuietState(), client_events: emptyEventLog(),
  player_name: 'Wren', playtime: 60, fellow: { profile: null, look: null }, skills: baseSkills(), friendship
});

describe('the friendship section of a save (G-13)', () => {
  it('reads a save from before it as nothing known yet, without a version bump', () => {
    const file = JSON.parse(JSON.stringify(collect(base(), 'manual', 'Old'))) as Record<string, unknown>;
    delete file.friendship;
    expect(migrateSave(file).friendship).toEqual(emptyFriendship());
  });

  it('round-trips what the client knows: Regard, ties, known ties, plans, letters and Favors', () => {
    const pkg = parseDawnPackage({
      day: 5, weekday: 'Sat', complete: true, pending: 0,
      plans: [{ resident_id: 'odile', tier: 'core', source: 'model', plan: { blocks: [{ start: '06:00', end: '26:00', action: 'work', place: 'market_row.bakery', with: [], note: '' }], whim: null, barks: [], seek_player: null, intentions: [] } }],
      letters: [{ id: 'l1', from: 'odile', to: 'player', day: 4, text: 'Door.' }],
      favors: [{ id: 'f1', resident_id: 'odile', template: 'fetch', target: 'flour', text: 'Flour.', created_day: 4, expires_day: 8 }],
      ties: { pairs: [{ a: 'june', b: 'odile', label: 'friends', romance: null }], milestones: [{ day: 4, a: 'june', b: 'odile', kind: 'became_friends', from: 'acquaintances', to: 'friends' }] }
    })!;
    let s = recordTurn(meet(emptyFriendship(), 'odile', 3, 20), 'odile', 4, { before: 20, after: 24, delta: 4, hearts_before: 2, hearts_after: 2, first_chat: true, capped: false });
    s = applyDawn(s, pkg, { names: { june: 'June', odile: 'Odile' }, plans: {} }).state;
    s = learnTies(s, [['odile', 'june']], 5, 'seen', tieIndex(pkg.ties.pairs));
    const file = collect(base(s), 'manual', 'Now');
    const back = migrateSave(JSON.parse(JSON.stringify(file))).friendship;
    expect(back).toEqual(s);
    expect(SaveGame.parse(JSON.parse(JSON.stringify(file)))).toEqual(file);
    expect(back.residents.odile!.regard).toBe(24);
    expect(Object.keys(back.known_ties)).toEqual(['june+odile']);
  });

  it('refuses a malformed section rather than half-load it', () => {
    const file = JSON.parse(JSON.stringify(collect(base(), 'manual', 'Bad'))) as Record<string, unknown>;
    expect(() => migrateSave({ ...file, friendship: { ...emptyFriendship(), residents: { odile: { regard: 400 } } } })).toThrow();
  });
});
