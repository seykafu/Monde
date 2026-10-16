// G-02: the roster of cards (authored + generated), S05's `arrival` alias, the dawn package's households, and the held
// events the alias releases.
import { afterEach, describe, expect, it } from 'vitest';
import { cardsFromHousehold, drawHousehold, emptyPeople, templateHousehold, type ArrivalHousehold } from '@monde/shared';
import { parseDawnPackage } from '../../mind/dawn';
import { emptyEventLog, isHeld, resolveHeld, scriptedMemory, sendable } from '../../mind/events';
import { personaCards } from '../residents';
import { allCards, arrivalId, findCard, onRosterChange, resetRoster, resolveAlias, rosterEntry, syncRoster } from '../roster';

function household(day: number, slot = 0): ArrivalHousehold {
  const draw = drawHousehold({
    seed: 5, day, slot, youthShare: 0.5, recent: [], alive: new Map(), portraitUses: new Map(), archetype: 'retired_couple',
    facts: { day, pillars: { prosperity: 30, safety: 40, spirit: 40, charm: 45 }, flags: new Set(), freeHomes: [{ home: 'old_quarter.vacant_house_47', beds: 3 }], unrestoredHomes: 60, pupils: 9, storefrontsFree: 0 }
  })!;
  const built = cardsFromHousehold(templateHousehold(draw, { residents: new Map() }, 5), draw, new Set(), 'old_quarter.vacant_house_47');
  return { id: draw.id, archetype: draw.archetype, day, home: 'old_quarter.vacant_house_47', summary: 'A couple from Carrow.', generated_by: 'template',
    residents: built.map(b => ({ card: b.card, household: draw.id, archetype: draw.archetype, arrived_day: day, dream_template: b.dream_template })) };
}

afterEach(() => resetRoster());

describe('the roster', () => {
  it('adds the generated residents after the authored cards, with indices that never shift', () => {
    const h = household(8);
    let changes = 0;
    const off = onRosterChange(() => changes++);
    syncRoster({ ...emptyPeople(), households: [h] }, 8);
    expect(allCards()).toHaveLength(personaCards.length + 2);
    const second = h.residents[1]!.card.id;
    const index = rosterEntry(second)!.index;
    expect(index).toBe(personaCards.length + 1);
    // The first leaves: the second keeps their colour.
    syncRoster({ ...emptyPeople(), households: [{ ...h, residents: [h.residents[1]!] }] }, 9);
    expect(rosterEntry(second)!.index).toBe(index);
    expect(findCard(h.residents[0]!.card.id)).toBeUndefined();
    expect(changes).toBe(2);
    off();
  });

  it("resolves S05's `arrival` to the first real arrival, the morning's boat included", () => {
    expect(resolveAlias('arrival')).toBe('arrival');
    const h = household(8);
    syncRoster({ ...emptyPeople(), pending: [h] }, 7);
    expect(arrivalId()).toBeNull(); // not their morning yet
    syncRoster({ ...emptyPeople(), pending: [h] }, 8);
    expect(resolveAlias('arrival')).toBe(h.residents[0]!.card.id);
    expect(findCard('arrival')!.name).toBe(h.residents[0]!.card.name);
    expect(resolveAlias('pell')).toBe('pell');
  });
});

describe('held events for the alias', () => {
  it('stay queued until the arrival is real, then go under their id', () => {
    const stamp = { id: 'e1', day: 8, minute: 500 };
    const log = { ...emptyEventLog(), outbox: [scriptedMemory(stamp, { scene_id: 's05_first_arrival', cue_key: 'k1' }, { resident: 'arrival', place: 'wharf.ferry_slip', text: 'Stepped off the ferry.', importance: 7 })] };
    expect(isHeld(log.outbox[0]!)).toBe(true);
    expect(sendable(log)).toEqual([]);
    const resolved = resolveHeld(log, 'arrival', 'ilse_maertens');
    expect(sendable(resolved).map(e => 'resident' in e && e.resident)).toEqual(['ilse_maertens']);
    expect(resolveHeld(resolved, 'arrival', 'x')).toBe(resolved);
  });
});

describe('the dawn package', () => {
  it("parses the server's households and the generated ids, dropping a malformed household", () => {
    const h = household(8);
    const pkg = parseDawnPackage({ day: 8, plans: [], letters: [], favors: [], ties: {}, arrivals: [h, { id: 'bad' }], generated: [h.residents[0]!.card.id, 7] });
    expect(pkg!.arrivals).toHaveLength(1);
    expect(pkg!.arrivals![0]!.residents[0]!.card.kind).toBe('arrival');
    expect(pkg!.generated).toEqual([h.residents[0]!.card.id]);
    expect(parseDawnPackage({ day: 8, plans: [] })!.generated).toBeNull();
  });
});
