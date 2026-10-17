import { describe, expect, it, vi } from 'vitest';
import { SavedFriendship, emptyFriendship, fallbackPress, parseReportBody, type Press } from '@monde/shared';
import {
  WITHDRAWN, frontKey, isGeneratedFront, isGeneratedLetter, isGeneratedStory, isReported, letterKey, markReported,
  mergeReported, printPaper, stampGenerated, storyKey
} from '../report';
import { MindClient, type StorageLike } from '../../mind/api';

// §9.13 Report on the Lantern and on letters: what's generated, what's withdrawn in print, and what the save keeps.
const SERVER: Press = {
  ...fallbackPress(5, [], []), source: 'model', headline: 'BROOMS OUT ON MARKET ROW', dek: 'The Fellow sweeps; the desk notes it.',
  stories: [
    { event_id: 'sweep', title: 'Market Row', text: 'The Fellow swept Market Row before the stalls opened.' },
    { event_id: null, title: 'Letters desk', text: 'The letters desk is open. Bring ink.' },
  ],
  letters: [{ from: 'odile', text: 'The broom is by the door.', id: 'letter_odile_4' }, { from: 'pell', text: 'An old note.' }],
};
/** The Option clause's morning (story/optionCalendar.ts): an authored headline, dek and lead story over the model's. */
const optionMorning = (paper: Press): Press => ({ ...paper, headline: 'THE WHARF HAS AN OPTION ON IT', dek: 'The Lantern prints the clause.',
  stories: [{ event_id: null, title: 'Page nine', text: 'Clause nine of the streetlight loan…' }, ...paper.stories].slice(0, 3) });

describe('what is generated', () => {
  it('stamps every story and the front of an untouched model edition', () => {
    const paper = stampGenerated({ ...SERVER, notices: ['Market today.'] }, SERVER);
    expect(paper.stories.map(s => s.model_index)).toEqual([0, 1]);
    expect(isGeneratedFront(paper)).toBe(true);
    expect(paper.stories.every(s => isGeneratedStory(paper, s))).toBe(true);
    // Stamping again (a re-published edition) changes nothing.
    expect(stampGenerated(paper, SERVER)).toEqual(paper);
  });
  it('leaves the client’s authored story, headline and dek unreportable and keeps the model story’s server index', () => {
    const paper = stampGenerated(optionMorning(SERVER), SERVER);
    expect(paper.stories.map(s => [s.title, s.model_index])).toEqual([['Page nine', undefined], ['Market Row', 0], ['Letters desk', 1]]);
    expect(isGeneratedFront(paper)).toBe(false);
    expect(isGeneratedStory(paper, paper.stories[0]!)).toBe(false);
    expect(printPaper(paper).stories.map(s => s.report)).toEqual([null,
      { kind: 'press', day: 5, story: 0, event_id: 'sweep', reason: 'Report story' },
      { kind: 'press', day: 5, story: 1, event_id: null, reason: 'Report story' }]);
  });
  it('stamps nothing in a template edition or in Quiet Mode, even with stale stamps', () => {
    const template: Press = { ...SERVER, source: 'template' };
    for (const paper of [stampGenerated(template, template), stampGenerated({ ...SERVER, model_front: true, stories: SERVER.stories.map((s, i) => ({ ...s, model_index: i })) }, null)]) {
      expect(isGeneratedFront(paper)).toBe(false);
      expect(paper.stories.some(s => isGeneratedStory(paper, s))).toBe(false);
      const printed = printPaper(paper);
      expect([printed.front, ...printed.stories].every(i => i.report === null && i.key === null)).toBe(true);
    }
    // A model edition stamped by hand still reads as template if its source says so.
    expect(isGeneratedStory(template, { ...SERVER.stories[0]!, model_index: 0 })).toBe(false);
  });
  it('treats only reflection letters as generated', () => {
    expect(isGeneratedLetter({ id: 'letter_odile_4' })).toBe(true);
    expect(isGeneratedLetter({ id: 'letter_census_12_9' })).toBe(true);
    for (const l of [{}, { id: '' }, { id: 'welcome_note' }, { id: 'press_4' }, { id: 'editor' }]) expect(isGeneratedLetter(l)).toBe(false);
    const printed = printPaper(stampGenerated(SERVER, SERVER));
    expect(printed.letters.map(l => l.report)).toEqual([{ kind: 'letter', letter_id: 'letter_odile_4', reason: 'Report letter' }, null]);
  });
});

describe('the paper as printed', () => {
  it('withdraws reported items with the Lantern’s lines and offers no second report', () => {
    const paper = stampGenerated(SERVER, SERVER);
    const printed = printPaper(paper, [frontKey(5), storyKey(5, 1), letterKey('letter_odile_4'), storyKey(4, 0)]);
    expect([printed.paper.headline, printed.paper.dek]).toEqual([WITHDRAWN.headline, WITHDRAWN.dek]);
    expect(printed.paper.stories.map(s => s.title)).toEqual(['Market Row', WITHDRAWN.title]);
    expect(printed.paper.stories[1]!.text).toBe(WITHDRAWN.story);
    expect(printed.paper.letters.map(l => l.text)).toEqual([WITHDRAWN.letter, 'An old note.']);
    expect([printed.front, printed.stories[1], printed.letters[0]].map(i => [i!.withdrawn, i!.report])).toEqual([[true, null], [true, null], [true, null]]);
    expect(printed.stories[0]).toMatchObject({ withdrawn: false, key: storyKey(5, 0) });
    // The edition itself is untouched: the save keeps what was printed and the key that withdrew it.
    expect(paper.headline).toBe(SERVER.headline);
  });
  it('sends bodies the server contract accepts', () => {
    const printed = printPaper(stampGenerated(SERVER, SERVER));
    for (const i of [printed.front, ...printed.stories, printed.letters[0]!]) expect(parseReportBody(i.report)).toEqual(i.report);
  });
});

describe('the reported set in the save', () => {
  it('adds a key once and survives a save round trip', () => {
    const state = markReported(emptyFriendship(), storyKey(5, 0));
    expect(markReported(state, storyKey(5, 0))).toBe(state);
    const next = markReported(state, letterKey('letter_odile_4'));
    expect(next.reported).toEqual(['press:5:story:0', 'letter:letter_odile_4']);
    expect(isReported(next, 'letter:letter_odile_4')).toBe(true);
    expect(SavedFriendship.parse(JSON.parse(JSON.stringify(next))).reported).toEqual(next.reported);
  });
  it('defaults an older save to nothing reported and keeps printed stamps through a reload', () => {
    const { reported: _reported, ...old } = { ...emptyFriendship(), papers: [stampGenerated(SERVER, SERVER)] };
    const parsed = SavedFriendship.parse(JSON.parse(JSON.stringify(old)));
    expect(parsed.reported).toEqual([]);
    expect(parsed.papers[0]!.model_front).toBe(true);
    expect(parsed.papers[0]!.stories.map(s => s.model_index)).toEqual([0, 1]);
    expect(parsed.papers[0]!.letters[0]!.id).toBe('letter_odile_4');
  });
  it('merges keys into an older copy of the save without duplicates', () => {
    expect(mergeReported(undefined, ['a'])).toEqual(['a']);
    expect(mergeReported(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
  });
});

describe('the mind client', () => {
  it('posts a report body to the world’s /reports and says whether it was recorded', async () => {
    const storage: StorageLike & { data: Map<string, string> } = {
      data: new Map(), getItem(k) { return this.data.get(k) ?? null; }, setItem(k, v) { this.data.set(k, v); }, removeItem(k) { this.data.delete(k); }
    };
    const calls: { url: string; body: unknown }[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
      if (url.endsWith('/v1/worlds')) return new Response(JSON.stringify({ world_id: '3f2c1e8a-1111-4222-8333-444455556666', token: 'a'.repeat(64) }), { status: 200 });
      return new Response(JSON.stringify({ recorded: !url.includes('nope') }), { status: calls.length > 2 ? 429 : 200 });
    }) as unknown as typeof globalThis.fetch;
    const mind = new MindClient({ baseUrl: 'https://mind.test', inviteCode: 'SPRING', storage, fetch, randomUUID: () => 'device-1', log: () => {} });
    const body = { kind: 'press', day: 5, story: 'front', reason: 'Report headline' } as const;
    expect(await mind.report(body)).toBe(true);
    expect(calls.at(-1)).toEqual({ url: 'https://mind.test/v1/worlds/3f2c1e8a-1111-4222-8333-444455556666/reports', body });
    expect(await mind.report({ kind: 'letter', letter_id: 'letter_odile_4', reason: 'Report letter' })).toBe(false);
  });
});
