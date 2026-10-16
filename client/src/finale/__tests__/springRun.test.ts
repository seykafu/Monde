// MVP G-11, a scripted run: Days 20–25 of a game through the story session the game uses (story/session.ts, the
// compiled Spring scenes, the real host handlers), with a world over a registry and a presenter standing in for
// StoryScene. The fair opens and closes (S10a, S10b), Sable counts the Straw Poll (S10c's {campaign} cue: the poll is
// taken from the registry's world and `vote.*` comes back to the script), the Day 26 Lantern prints it, and the
// End-of-Spring report is due, adds up, and is shown once.
import { describe, expect, it } from 'vitest';
import { emptyEventLog, emptyRiddles, emptyScuffles, fallbackPress, type ClientEvent, type SavedFriendship } from '@monde/shared';
import { minutesToHhmm } from '../../sim/plans';
import type { StoryPresenter, StoryWorld, WorldNow } from '../../story/host';
import { StorySession } from '../../story/session';
import type { TownState } from '../../town/pillars';
import { applySpringPreset } from '../devPreset';
import { voteOutcome } from '../poll';
import { springReport } from '../report';
import { REPORT_DAY, finaleOf, reportDue, updateFinale } from '../state';
import { ensureStrawPoll, withStrawPoll } from '../take';

const registry = () => {
  const data = new Map<string, unknown>();
  const r = { get: (k: string) => data.get(k), set: (k: string, v: unknown) => { data.set(k, v); return r; }, remove: (k: string) => data.delete(k) };
  return r;
};

describe('Days 20–25 to the End-of-Spring report', () => {
  it.each([0, 1] as const)('plays the fair, the poll and the report (choice %i)', async choice => {
    const r = registry();
    applySpringPreset(r, 'social', 20, 6 * 60);
    r.set('monde.events', emptyEventLog());
    const regard = (id: string) => (r.get('monde.friendship') as SavedFriendship).regard[id] ?? 0;
    const now: Omit<WorldNow, 'town'> & { town?: TownState } = { day: 20, minute: 360, zone: 'old_quarter', place: '' };
    const lines: string[] = [], played: string[] = [];
    const world: StoryWorld = {
      now: () => ({ ...now, town: r.get('monde.town') as TownState, regard: (r.get('monde.friendship') as SavedFriendship).regard }),
      setTown: s => { r.set('monde.town', s); },
      events: () => (r.get('monde.events') as { outbox: ClientEvent[] }).outbox,
      appendEvent: e => { const log = r.get('monde.events') as { outbox: ClientEvent[] }; r.set('monde.events', { ...log, outbox: [...log.outbox, e] }); },
      newId: () => `id-${Math.random()}`,
      persist: () => { r.set('monde.story.flags', session.snapshot()); },
      checkpoint: async () => undefined,
      travel: place => { now.place = place; now.zone = place.split('.')[0]!; },
      zoneName: id => id,
      aiLine: async () => []
    };
    const presenter: StoryPresenter = {
      backdrop: () => undefined, music: () => undefined, fade: async () => undefined, wait: async () => undefined,
      cam: () => true, sfx: () => true, thinking: () => undefined, confirm: async () => true,
      placeholder: async () => true, charcreate: async () => false, aiOpen: async () => [],
      // StoryScene's presenter: count the poll (finale/attach.ts openStrawPoll without the card) and return `vote.*`.
      strawPoll: async () => { const f = ensureStrawPoll(r, regard, 5); return f?.poll ? voteOutcome(f.poll) : null; }
    };
    const session = new StorySession({ world, saved: r.get('monde.story.flags') as Record<string, string | boolean>, dev: true, warn: m => { throw new Error(m); } });
    session.presenter = presenter;
    r.set('monde.story.session', { clock: r.get('monde.clock'), session });

    for (let day = 20; day <= 25; day++) {
      now.day = day;
      for (let minute = 360; minute < 1560; minute += 5) {
        now.minute = minute;
        if (!session.ready()) continue;
        for (let n = 0; n < 2000; n++) {
          const step = await session.director.next();
          if (!step) break;
          if (step.kind === 'line') lines.push(step.line.text);
          if (step.kind === 'choice') await session.director.choose(Math.min(choice, step.options.length - 1));
          if (session.active && played.at(-1) !== session.active) played.push(session.active);
        }
        session.settle();
        world.persist();
      }
    }
    expect(played).toEqual(['s10a_bloom_open', 's10b_bloom_close', 's10c_straw_poll']);
    for (const flag of ['s10a_done', 'bloom_fair_open', 's10b_done', 'bloom_fair_closed', 's10c_done', 'spring_poll_taken']) expect(session.flags.has(flag), flag).toBe(true);
    // The script read the count back: Sable says the Fellow's share out loud.
    const poll = finaleOf(r).poll!;
    expect(poll).not.toBeNull();
    const v = voteOutcome(poll);
    const said = v.winner === 'tie' ? 'Dead level' : `${v.winner === 'fellow' ? v.share : v[v.winner]} per cent`;
    expect(lines.some(l => l.includes(said)), said).toBe(true);
    expect(lines.some(l => /\{[\w.]+\}/.test(l))).toBe(false);
    expect((r.get('monde.events') as { outbox: ClientEvent[] }).outbox.some(e => e.kind === 'scripted_memory' && e.scene_id === 's10c_straw_poll')).toBe(true);

    // Day 26: the Lantern prints the poll, then the report.
    expect(reportDue(r, 25)).toBe(false);
    const paper = withStrawPoll(fallbackPress(REPORT_DAY, [], []), finaleOf(r), REPORT_DAY, id => id);
    expect(paper.poll?.ballots).toBe(poll.ballots);
    expect(reportDue(r, REPORT_DAY)).toBe(true);
    const rep = springReport({
      day: REPORT_DAY, town: r.get('monde.town') as TownState, projects: r.get('monde.projects') as never, riddles: emptyRiddles(), scuffles: emptyScuffles(),
      friendship: r.get('monde.friendship') as SavedFriendship, regard, name: id => id, flags: session.flags.snapshot(), poll
    });
    expect(rep.poll).toBe(poll);
    expect(rep.friends.length).toBeGreaterThan(10);
    expect(rep.moments.at(-1)?.day).toBe(25);
    updateFinale(r, s => ({ ...s, reportDay: REPORT_DAY }));
    expect(reportDue(r, REPORT_DAY + 3)).toBe(false);
    // Nothing more to play: free play on Day 26 has no story beats.
    now.day = 26;
    for (let minute = 360; minute < 1560; minute += 30) { now.minute = minute; expect(session.ready(), minutesToHhmm(minute)).toBe(false); }
    expect(ensureStrawPoll(r, () => 100, 5)!.poll).toEqual(poll);
  }, 30000);
});
