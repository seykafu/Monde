import { type Press } from '@monde/shared';
import { dailyWeather, tideTable } from '../sim/weather';
import { seasonOf, sunrise, sunset } from '../sim/clock';
export function frontPage(paper: Press, seed: number) {
  const weather = dailyWeather(seed, paper.day);
  return { paper, masthead: { day: paper.day, season: seasonOf(paper.day), weather: weather.kind, wind: weather.wind,
    tides: tideTable(paper.day), sunrise: sunrise(paper.day), sunset: sunset(paper.day) } };
}
export const printTime = (minute: number): string => `${String(Math.floor(minute / 60)).padStart(2,'0')}:${String(minute % 60).padStart(2,'0')}`;
