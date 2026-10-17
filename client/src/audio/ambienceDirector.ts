// GDD §17. Pure content manifest and mix decisions. Files are optional.
export const AMBIENCE = {
  gulls: 'gulls.mp3', surf: 'surf.mp3', rigging: 'rigging.mp3', rain: 'rain_on_tin.mp3',
  weir: 'weir.mp3', wind: 'station_wind.mp3', pub: 'pub_murmur.mp3', market: 'market_chatter.mp3'
} as const;
export type Bed = keyof typeof AMBIENCE;
type Band = 'day' | 'night';
export const DISTRICT_BEDS: Readonly<Record<string, Record<Band, readonly Bed[]>>> = {
  old_quarter: { day: ['market'], night: ['wind'] },
  market_row: { day: ['market'], night: ['pub'] },
  wharf: { day: ['surf', 'rigging', 'gulls'], night: ['surf', 'rigging'] },
  commons: { day: ['weir', 'wind'], night: ['weir'] },
  station_hill: { day: ['wind'], night: ['wind'] }
};
export function ambienceMix(zone: string, minute: number, census: number, indoors: boolean, rain: boolean): Partial<Record<Bed, number>> {
  // GDD-GAP: town census proxy until there is a complete zone census; 420 is full density,
  // linear 0..1 with a 0.15 environmental floor. 06–18 day band, 0.22 bed gain, 0.3 indoor attenuation.
  const density = Math.max(0, Math.min(1, Number.isFinite(census) ? census / 420 : 0));
  const beds = [...(DISTRICT_BEDS[zone]?.[minute >= 360 && minute < 1080 ? 'day' : 'night'] ?? []), ...(rain ? ['rain' as const] : [])];
  return Object.fromEntries(beds.map(bed => [bed, 0.22 * (indoors ? 0.3 : 1) *
    (bed === 'market' || bed === 'pub' ? density : 0.15 + 0.85 * density)]));
}
export interface ChimeTime { day: number; minute: number }
export function chimeDue(previous: ChimeTime | undefined, now: ChimeTime, running: boolean, held: boolean): boolean {
  // GDD §17: C–E–A–G–D–C at 06:00 and 18:00, not hourly strikes.
  if (!previous || !running || held) return false;
  // Sleep/pass-out jumps straight to the next morning in Monde's 06:00–26:00 clock.
  if (now.day === previous.day + 1 && now.minute >= 360 && now.minute < 361) return true;
  const a = previous.day * 1440 + previous.minute, b = now.day * 1440 + now.minute;
  // Do not replay missed bells after loading, rewinding, or large developer jumps.
  return b > a && b - a <= 60 && [360, 1080].some(m => {
    const t = now.day * 1440 + m;
    return a < t && b >= t;
  });
}
export function chimeLevel(zone: string, indoors: boolean): number {
  // GDD-GAP: distance and wall attenuation; §17 supplies no levels.
  return (zone === 'old_quarter' ? 1 : 0.2) * (indoors ? 0.35 : 1);
}
