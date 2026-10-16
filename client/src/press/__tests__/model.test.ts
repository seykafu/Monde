import { expect, it } from 'vitest';
import { fallbackPress, SavedFriendship, emptyFriendship } from '@monde/shared';
import { frontPage } from '../model';
import { dailyWeather, tideTable } from '../../sim/weather';
import { sunrise,sunset } from '../../sim/clock';
it('prints the actual wind, tide table and daylight for every spring day',() => {
  for (let day=1;day<=25;day++) {
    const m = frontPage(fallbackPress(day,[],[]),123).masthead;
    expect(m.wind).toBe(dailyWeather(123,day).wind); expect(m.tides).toEqual(tideTable(day));
    expect([m.sunrise,m.sunset]).toEqual([sunrise(day),sunset(day)]);
  }
});
it('round-trips editions and defaults old v3 friendship sections',() => {
  const paper = fallbackPress(4,[],[]), saved = { ...emptyFriendship(),papers:[paper] };
  expect(SavedFriendship.parse(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  const { papers: _papers,favor_book: _favors,...old } = saved;
  expect(SavedFriendship.parse(old).papers).toEqual([]);
});
