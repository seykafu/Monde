// The Spring soak bot (MVP_PLAN Q-02, first version): three player scripts play Days 1–25 through to the End-of-Spring
// report on the real game modules in Quiet Mode (qa/springBot.ts), saving at every dawn and reloading the save.
// Set BOT_OUT=<dir> to write each run's log, issues and report there.
import { writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => import('./phaserStub'));

// The game's dev logging ([town] dawn, [arrivals]…) would fill the run's output.
vi.spyOn(console, 'info').mockImplementation(() => undefined);
const { auditSpring, playSpring, PROJECT_IDS } = await import('../springBot');
type Result = Awaited<ReturnType<typeof playSpring>>;

const OUT = process.env.BOT_OUT;
const write = (res: Result) => {
  if (!OUT) return;
  writeFileSync(`${OUT}/bot_${res.script}.txt`, [
    res.played.join(' → '),
    `saves ${res.saves} · reloads ${res.reloads} · Marks ${res.marks.length} · puzzles ${res.puzzles.join(',')} · arrivals ${res.arrivals} · departures ${res.departures}`,
    `scuffles ${JSON.stringify(res.scuffles)}`, `favors ${JSON.stringify(res.favors)}`,
    '', 'ISSUES', ...res.issues, '', 'PROJECTS', JSON.stringify(res.projects), '', 'REPORT', JSON.stringify(res.report), '',
    'DAYS', ...res.days.map(d => `D${d.day} ${d.weekday} appeal ${d.appeal} census ${d.census} coins ${d.coins} fund ${d.fund} stamina ${d.stamina}`),
    '', 'LOG', ...res.log
  ].join('\n'));
};

// The story beats each script reaches, in order (S05 or its empty boat; S07 A or B).
const BEATS = {
  strong: ['s01a_ferry', 's01b_walk', 's01c_cottage', 's02_marks', 's03_tolls', 's04_water_again', 's07a_chime_runs', 's05_first_arrival',
    's06_good_coat', 's08_option', 's09_pell_confession', 's10a_bloom_open', 's10b_bloom_close', 's10c_straw_poll'],
  lazy: ['s01a_ferry', 's01b_walk', 's01c_cottage', 's02_marks', 's03_tolls', 's04_water_again', 's05b_empty_boat', 's06_good_coat',
    's07b_chime_loan', 's08_option', 's09_pell_confession', 's10a_bloom_open', 's10b_bloom_close', 's10c_straw_poll'],
  social: ['s01a_ferry', 's01b_walk', 's01c_cottage', 's02_marks', 's03_tolls', 's04_water_again', 's07a_chime_runs', 's05b_empty_boat',
    's06_good_coat', 's08_option', 's09_pell_confession', 's10a_bloom_open', 's10b_bloom_close', 's10c_straw_poll']
} as const;

describe('the Spring soak bot', () => {
  it('finds every place the Spring sends the player standable and reachable (one known gap: closed-district homes)', () => {
    const audit = auditSpring();
    // Follow-up (QA report): Favors at the homes of residents who live in Millbrook, Station Hill or off the map.
    expect(audit.filter(a => !a.includes("live where a Spring player can't go"))).toEqual([]);
  });

  describe.each(['strong', 'lazy', 'social'] as const)('the %s player', script => {
    let res: Result;
    it('plays Days 1–25 to the End-of-Spring report with nothing stuck', async () => {
      res = await playSpring(script, { reloadEveryDawn: script !== 'lazy' });
      write(res);
      expect(res.issues).toEqual([]);
      expect(res.played).toEqual(BEATS[script]);
      for (const flag of ['s10c_done', 'spring_poll_taken', 'option_known', 'pell_confessed', 'bloom_fair_closed']) expect(res.flags, flag).toContain(flag);
      // Every dawn saved; the strong and social players reload every dawn save (and a few afternoon saves).
      expect(res.saves).toBe(25);
      if (script !== 'lazy') expect(res.reloads).toBeGreaterThanOrEqual(25);
      // The Straw Poll was taken and the report adds up from the final state.
      expect(res.poll?.ballots).toBeGreaterThan(0);
      expect(res.report?.poll).toEqual(res.poll);
      expect(res.report?.days).toBe(25);
      const days = res.report!.moments.map(m => m.day);
      expect(days).toEqual([...days].sort((a, b) => a - b));
      expect(res.report!.moments.at(-1)?.day).toBe(25);
    }, 120_000);

    if (script === 'strong') it('opens every Spring Project, solves every Mark in sequence and every puzzle', () => {
      for (const id of PROJECT_IDS.filter(p => p !== 'homes')) expect(res.projects[id]?.opened, id).not.toBeNull();
      expect(Object.keys(res.projects).filter(id => id.startsWith('homes:') && res.projects[id]!.opened !== null).length).toBeGreaterThanOrEqual(5);
      expect(res.marks.filter(m => !m.startsWith('T-'))).toHaveLength(19);
      expect(res.puzzles.sort()).toEqual(['PZ-01', 'PZ-02', 'PZ-03', 'PZ-04', 'PZ-05', 'PZ-06', 'PZ-13', 'PZ-15', 'PZ-18']);
      expect(res.arrivals).toBeGreaterThan(0);
      // The clock ran with S07a's chime (its Project opens the moment PZ-15 is solved), and the report says so.
      const s07 = res.log.find(l => l.includes('▶ s07a_chime_runs'))!;
      expect(res.projects.clocktower?.opened).toBe(Number(/^D(\d+)/.exec(s07)![1]));
      expect(res.report!.moments.find(m => m.text.startsWith('The clocktower runs'))?.day).toBe(res.projects.clocktower?.opened);
    });

    if (script === 'social') it('does the Favors it is asked, including a chore at a home upstairs', () => {
      expect(res.favors.find(f => f.id.startsWith('bot_help_chore_odile'))?.status).toBe('completed');
      expect(res.favors.find(f => f.id.startsWith('bot_find_nell'))?.status).toBe('completed');
    });

    if (script === 'lazy') it('reaches the end on the deferred and empty-boat branches without building anything', () => {
      expect(Object.values(res.projects).filter(p => p.opened !== null)).toEqual([]);
      expect(res.flags).toContain('clock_pending_pinion');
      expect(res.flags).toContain('s05_b_seen');
    });
  });
});
