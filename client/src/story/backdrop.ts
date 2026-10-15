// VN backdrops for scripted scenes (GDD §16.3). Pure: the ids, the manifest and the stand-in's mood.
//
// StoryScene loads `<base>assets/backdrops/<file>` only when
// assets/backdrops/manifest.json lists the id; otherwise it paints a tinted panel with the place name, coloured
// by the time of day the id names (bg_ferry_slip_morning, bg_pell_kitchen_night…).

export const BACKDROP_MANIFEST_PATH = 'assets/backdrops/manifest.json';

/** `<base>assets/backdrops/<file>` (default `<id>.png`); `base` is import.meta.env.BASE_URL (never a leading /). */
export const backdropUrl = (base: string, id: string, file?: string): string => `${base}assets/backdrops/${file ?? `${id}.png`}`;
export const backdropTextureKey = (id: string): string => `backdrop:${id}`;

const ID = /^[a-z][a-z0-9_]*$/;

const FILE = /^[a-z][a-z0-9_]*\.(png|jpg|webp)$/;

/**
 * The ids that have art, each with its file. Accepts `{ "bg_x": "bg_x.jpg" }` (the shipped form: painted
 * backdrops are JPEGs), `{ "bg_x": true }` (meaning `bg_x.png`) or `["bg_x"]`; anything malformed is skipped,
 * so a bad entry costs art, never the scene.
 */
export function parseBackdropManifest(raw: unknown): ReadonlyMap<string, string> {
  const entries: [unknown, unknown][] = Array.isArray(raw) ? raw.map(id => [id, true]) : raw && typeof raw === 'object'
    ? Object.entries(raw as Record<string, unknown>) : [];
  const out = new Map<string, string>();
  for (const [id, v] of entries) {
    if (typeof id !== 'string' || !ID.test(id)) continue;
    if (v === true) out.set(id, `${id}.png`);
    else if (typeof v === 'string' && FILE.test(v)) out.set(id, v);
  }
  return out;
}

export type BackdropMood = 'dawn' | 'morning' | 'noon' | 'day' | 'dusk' | 'night' | 'fog' | 'interior';

/** Words in an id that set the mood (the last one wins: bg_pell_kitchen_night is night, not interior). */
const MOOD_WORDS: Readonly<Record<string, BackdropMood>> = {
  dawn: 'dawn', morning: 'morning', noon: 'noon', afternoon: 'day', day: 'day', dusk: 'dusk', evening: 'dusk',
  supper: 'dusk', night: 'night', fog: 'fog', interior: 'interior', room: 'interior', kitchen: 'interior',
  office: 'interior', library: 'interior', registry: 'interior', hall: 'interior'
};

export function backdropMood(id: string): BackdropMood {
  let mood: BackdropMood = 'day';
  for (const word of id.replace(/^bg_/, '').split('_')) if (MOOD_WORDS[word]) mood = MOOD_WORDS[word]!;
  return mood;
}

export interface MoodPalette {
  /** Top and bottom of the wash. */
  sky: number;
  ground: number;
  /** The plaque's rule and the soft horizon band. */
  accent: number;
  label: string;
}

/** Art direction for the stand-in (§16.4's palette: warm mornings, amber dusks, readable blue nights). */
export const MOOD_PALETTE: Readonly<Record<BackdropMood, MoodPalette>> = {
  dawn: { sky: 0xd99a86, ground: 0x2f2a33, accent: 0xffd2a8, label: 'Dawn' },
  morning: { sky: 0x9cc4cf, ground: 0x2c3a35, accent: 0xffe3a0, label: 'Morning' },
  noon: { sky: 0xb8d6a6, ground: 0x2f3b27, accent: 0xfff0b8, label: 'Noon' },
  day: { sky: 0xa9c2b0, ground: 0x2a3630, accent: 0xe4c77f, label: 'Day' },
  dusk: { sky: 0xd08a5c, ground: 0x2b2230, accent: 0xffc27a, label: 'Dusk' },
  night: { sky: 0x3d4f80, ground: 0x12151f, accent: 0xffc46b, label: 'Night' },
  fog: { sky: 0xb5bec2, ground: 0x343a3c, accent: 0xe7ecef, label: 'Fog' },
  interior: { sky: 0xb08a5e, ground: 0x2a2018, accent: 0xffd59a, label: 'Indoors' }
};

const QUALIFIERS = new Set(['bg', ...Object.keys(MOOD_WORDS).filter(w => !['library', 'office', 'kitchen', 'hall', 'registry', 'room'].includes(w)), 'dry', 'work', 'front', 'page']);

/** "Ferry Slip" from bg_ferry_slip_morning: the id's words without the time of day. */
export function backdropTitle(id: string): string {
  const words = id.split('_').filter(w => w && !QUALIFIERS.has(w));
  return words.map(w => w[0]!.toUpperCase() + w.slice(1)).join(' ') || id;
}
