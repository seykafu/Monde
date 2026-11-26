import { expect, it } from 'vitest';
import { emptyPeople } from '@monde/shared';
import { cardTies } from '../../friendship/state';
import { personaCards, handWrittenCards } from '../../world/residents';
import { stayScore } from '../../town/migration';
import { DAY1_PILLARS } from '../../town/pillars';
import { peopleOf, presentAt, stayFactors, stayFriends, stayInputsOf, stayResidents } from '../../town/people';
import { runMigrationSoak } from '../../town/__tests__/migrationSoak';
import { springVoters } from '../poll';
import { DEEDS, PLAY_STYLES } from './springSoak';

it('prints Day-1 census adults under 30 and their four Stay factors', () => {
  const friends = stayFriends(personaCards, cardTies(personaCards));
  const rows = stayResidents(emptyPeople()).map(r => {
    const input = stayInputsOf(r, 1, { friends: id => friends(id).length });
    return { id: input.id, stay: stayScore(input, DAY1_PILLARS), ...stayFactors(input, DAY1_PILLARS) };
  }).filter(r => r.stay < 30).sort((a, b) => a.stay - b.stay);
  console.info('Day 1: id, Stay, town, friends, purpose, roots\n' + rows.map(r =>
    [r.id, ...[r.stay, r.town, r.friends, r.purpose, r.roots].map(n => n.toFixed(2))].join(' ')).join('\n'));
  expect(rows.length).toBeGreaterThan(0);
});

it.each(PLAY_STYLES)('measures notices, sailings and the Option Clause for %s', style => {
  const cast = new Set(handWrittenCards.map(c => c.id));
  for (let seed = 2026; seed <= 2033; seed++) {
    const r = runMigrationSoak(style, 25, { seed });
    const people = peopleOf(r.final);
    const voters = new Set(springVoters({ worldSeed: seed, town: r.final, cards: personaCards,
      regard: () => 0, met: () => false, deeds: DEEDS[style], flags: new Set() }).map(v => v.id));
    const stay = new Set(stayResidents(people).map(r => r.card.id));
    const adults = new Set([...personaCards, ...r.households.flatMap(h => h.residents.map(r => r.card))]
      .filter(c => c.age >= 18).map(c => c.id));
    if (style === 'passive') {
      expect(r.days.find(d => d.notices.length)).toMatchObject({ day: 9, notices: ['fenna_renard'] });
      expect(people.departed).toMatchObject([{ id: 'fenna_renard', day: 11 }]);
    }
    for (const d of r.days) {
      expect(d.notices.some(id => cast.has(id))).toBe(false);
      expect(people.departed.filter(p => p.day === d.day && adults.has(p.id)).length).toBeLessThanOrEqual(2);
    }
    for (const d of people.departed) {
      expect(stay.has(d.id) || voters.has(d.id) || presentAt(r.final, d.id, 25, 720)).toBe(false);
      expect(r.final.migration.lowStayNights[d.id]).toBeUndefined();
    }
    console.info('Spring census', style, seed, 'notices', r.notices, 'departures', r.departures,
      'first notice', r.days.find(d => d.notices.length)?.day ?? '-', 'who', r.days.find(d => d.notices.length)?.notices.join(','), 'first sailing', people.departed[0]?.day ?? '-',
      'census', r.final.census, 'clause', r.final.optionClause.exercisedDay ?? '-', 'sailed', people.departed.map(d => d.id).join(',') || '-');
  }
}, 60000);
