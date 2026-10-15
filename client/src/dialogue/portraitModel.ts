// Dialogue portraits as data (GDD §16.2 six expressions, §16.1 cartoon busts). Pure: no Phaser, no DOM.
//
// Three things live here, so they run under vitest:
//   1. which of the six portraits an incoming `expr` shows (people), or which art file (anyone);
//   2. the art manifest (client/public/assets/portraits/manifest.json: resident id → expressions with art);
//   3. the procedural bust's look (from the card and the resident's existing colours) and face per expression.
// The Phaser side (portrait.ts) draws from these.
import { PORTRAIT_SET, toPortraitExpression, type PersonaCard, type PortraitExpression } from '@monde/shared';
import { hashString } from '../sim/plans';

// ── Size and files (the §16.2 portrait file contract) ───────────────────────

/** The portrait frame in the dialogue panel, in design pixels. */
export const PORTRAIT_W = 230;
export const PORTRAIT_H = 270;
/** Art files are drawn at the render scale: 460×540 fills the frame pixel for pixel at 2×. */
export const ART_W = PORTRAIT_W * 2;
export const ART_H = PORTRAIT_H * 2;
export const MANIFEST_PATH = 'assets/portraits/manifest.json';

/** `<base>assets/portraits/<id>/<expr>.png`; `base` is import.meta.env.BASE_URL (never a leading /). */
export const portraitUrl = (base: string, residentId: string, expr: string): string =>
  `${base}assets/portraits/${residentId}/${expr}.png`;
export const portraitTextureKey = (residentId: string, expr: string): string => `portrait:${residentId}:${expr}`;

// ── Expressions ─────────────────────────────────────────────────────────────

/** The portrait for any expression id: one of the six; laugh → warm, thinking → neutral, unknown → neutral. */
export function portraitExpression(expr: string | null | undefined): PortraitExpression {
  return (expr ? toPortraitExpression(expr) : null) ?? 'neutral';
}

// ── The art manifest ────────────────────────────────────────────────────────

/** Resident id → the expression ids that have a file. Residents without art are absent. */
export type PortraitManifest = Readonly<Record<string, readonly string[]>>;

const ID = /^[a-z][a-z0-9_]*$/;

/** The manifest as fetched; anything malformed is skipped, so a bad entry costs art, never the dialogue. */
export function parsePortraitManifest(raw: unknown): PortraitManifest {
  const out: Record<string, string[]> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!ID.test(id) || !Array.isArray(list)) continue;
    const exprs = [...new Set(list.filter((e): e is string => typeof e === 'string' && ID.test(e)))];
    if (exprs.length) out[id] = exprs;
  }
  return out;
}

/**
 * Which art file to show for `expr`, or null to draw the procedural bust. Tries the expression itself (an
 * animal's own pose, or a signature expression once there is art for it), then its portrait of the six,
 * then neutral, then any file the resident has: once a resident has art, the bust never mixes in.
 */
export function artExpression(manifest: PortraitManifest, residentId: string, expr: string): string | null {
  const have = manifest[residentId];
  if (!have?.length) return null;
  for (const e of [expr, portraitExpression(expr), 'neutral']) if (have.includes(e)) return e;
  return have[0]!;
}

// ── The procedural bust's look ──────────────────────────────────────────────

export type HairStyle = 'short' | 'cropped' | 'bob' | 'long' | 'bun' | 'braid' | 'curly' | 'tufty' | 'cowlick';
export type Headwear = 'none' | 'peaked' | 'flat' | 'beanie';
export type Glasses = 'none' | 'round' | 'halfmoon' | 'heavy' | 'on_head';

export interface PortraitLook {
  animal: boolean;
  /** The resident's roster colour (their sprite's top): clothes and the frame tint. */
  colour: number;
  skin: number;
  hair: number;
  eyes: number;
  hairStyle: HairStyle;
  headwear: Headwear;
  capColour: number;
  glasses: Glasses;
  moustache: boolean;
  freckles: boolean;
  /** Dark hair going grey at the sides (Vane). */
  greyTemples: boolean;
  age: 'child' | 'adult' | 'elder';
  build: 'narrow' | 'average' | 'broad';
  collar: 'round' | 'vneck' | 'shirt';
}

/** The skin and hair tones the resident billboards have always used (index by the id hash). */
export const SKIN = [0xf2d5b3, 0xe3b48c, 0xc68e64, 0x8d5a3b, 0xf6e1cb, 0xa86f48] as const;
export const HAIR = [0x3b2a20, 0x6b4a2b, 0xb7b2a8, 0x1f1a17, 0x9c4a26, 0xd9c28a, 0x50392b] as const;
const EYES = [0x4a3424, 0x3f6a8f, 0x4f7a42, 0x7a5a2a, 0x55606b] as const;
const GREY = 0xb9b6ae;

/** Hair colours the cards name, most specific first. */
const HAIR_WORDS: readonly [RegExp, number][] = [
  [/\bauburn-grey\b/, 0x9a6a52], [/\bgrey-brown\b/, 0x857463], [/\bgrey-streaked\b/, 0x6f6862],
  [/\bwhite\b/, 0xece8df], [/\bsilver\b/, 0xc9cdd4], [/\bgr[ae]y\b/, GREY], [/\bblack\b/, 0x1f1a1c],
  [/\bauburn\b/, 0x9c4a26], [/\b(?:red|ginger)\b/, 0xb4542c], [/\b(?:blond|blonde|fair)\b/, 0xd9c28a],
  [/\bbrown\b/, 0x6b4a2b], [/\bdark\b/, 0x3b2a20]
];
const HAIR_NOUN = /\b(?:hair|bob|plait|braid|knot|curls?|cowlick|moustache|mustache)\b/;

/** The appearance clause that talks about hair, if any (so "a grey wool cap" doesn't colour the hair). */
function hairClause(appearance: string): string | null {
  return appearance.toLowerCase().split(/[,.;]| and /).find(clause => HAIR_NOUN.test(clause)) ?? null;
}

type LookCard = Pick<PersonaCard, 'id' | 'age' | 'pronouns' | 'kind' | 'appearance'>;

/**
 * The bust for a card: skin and clothes in the resident's existing colours (the billboard hash and the roster
 * colour), with what the card's appearance names layered on top: hair colour and style, a cap, glasses, a
 * moustache, freckles, build. Anything the card doesn't say is varied by the id hash. Elders go grey unless
 * the card says otherwise.
 */
export function portraitLook(card: LookCard, colour: number): PortraitLook {
  const h = hashString(card.id);
  const r = hashString(`${card.id}:portrait`);
  const text = card.appearance.toLowerCase();
  const clause = hairClause(card.appearance);
  const age: PortraitLook['age'] = card.age < 16 ? 'child' : card.age >= 65 ? 'elder' : 'adult';
  let hair: number = HAIR[(h >> 4) % HAIR.length]!;
  // The billboards' palette includes a grey; a card under fifty that names no colour isn't grey.
  if (hair === HAIR[2] && card.age < 50) hair = HAIR[((h >> 4) + 1) % HAIR.length]!;
  const named = clause ? HAIR_WORDS.find(([pattern]) => pattern.test(clause)) : undefined;
  const greyTemples = /\b(?:silver|grey) at the temples\b/.test(text);
  if (named) hair = named[1];
  else if (greyTemples) hair = 0x2e2a28;
  else if (age === 'elder') hair = GREY;

  const she = /\bshe\b/.test(card.pronouns);
  let hairStyle: HairStyle;
  if (/\bbob\b/.test(text)) hairStyle = 'bob';
  else if (/\b(?:plait|braid)\b/.test(text)) hairStyle = 'braid';
  else if (/\b(?:knot|bun|pinned up|tied up)\b/.test(text)) hairStyle = 'bun';
  else if (/\bcowlick\b/.test(text)) hairStyle = 'cowlick';
  else if (/\bstands up\b/.test(text)) hairStyle = 'tufty';
  else if (/\bcurl(?:y|ing|s)\b/.test(text)) hairStyle = 'curly';
  else if (/\bcropped\b/.test(text)) hairStyle = 'cropped';
  else hairStyle = she ? (['bob', 'long', 'bun', 'curly'] as const)[r % 4]! : (['short', 'cropped', 'short', 'curly'] as const)[r % 4]!;

  const headwear: Headwear = /\b(?:peaked cap|railwayman's cap)\b/.test(text) ? 'peaked'
    : /\b(?:flat cap|mill cap)\b/.test(text) ? 'flat'
    : /\b(?:knitted cap|wool cap)\b/.test(text) ? 'beanie' : 'none';
  const capColour = /\bnavy\b/.test(text) ? 0x2f3d5c : /\bgrey wool\b/.test(text) ? 0x7d7a74 : mixColour(colour, 0x2a2420, 0.55);

  let glasses: Glasses = 'none';
  if (/\b(?:glasses|spectacles)\b/.test(text)) {
    glasses = /\bpushed (?:up )?in(?:to)?\b/.test(text) ? 'on_head' : /\bhalf-moon\b/.test(text) ? 'halfmoon'
      : /\bheavy glasses\b/.test(text) ? 'heavy' : 'round';
  }
  return {
    animal: card.kind === 'animal',
    colour,
    skin: SKIN[h % SKIN.length]!,
    hair,
    eyes: EYES[(r >> 6) % EYES.length]!,
    hairStyle,
    headwear,
    capColour,
    glasses,
    moustache: /\b(?:moustache|mustache)\b/.test(text),
    freckles: /\bfreckle/.test(text),
    greyTemples,
    age,
    build: /\b(?:broad-shouldered|barrel-chested)\b|^round and\b/.test(text) ? 'broad'
      : /\b(?:thin|lean|small|short|compact|rangy)\b/.test(text) ? 'narrow' : 'average',
    collar: /\bhigh collar\b|\bshirtsleeves\b|\bsuit\b|\bcoat\b|\btunic\b/.test(text) ? 'shirt' : (['round', 'vneck', 'shirt'] as const)[(r >> 9) % 3]!
  };
}

/** Linear blend of two 0xRRGGBB colours. */
export function mixColour(a: number, b: number, t: number): number {
  const ch = (c: number, s: number) => (c >> s) & 0xff;
  const m = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}

/** Scale a colour's channels (shade < 1, light > 1), clamped. */
export function shadeColour(c: number, f: number): number {
  const s = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return (s((c >> 16) & 0xff) << 16) | (s((c >> 8) & 0xff) << 8) | s(c & 0xff);
}

// ── Faces ───────────────────────────────────────────────────────────────────

/**
 * One expression's face. Brow offsets are in design pixels (negative is up) at the inner and outer ends;
 * `arch` lifts the middle. Each of the six differs in at least two features, plus a small cartoon extra, so
 * they read at a glance and in greyscale.
 */
export interface FaceSpec {
  brow: { inner: number; outer: number; arch: number; weight: number };
  eyes: 'open' | 'smile' | 'wide' | 'narrow' | 'lidded';
  /** Iris scale and gaze offset. */
  iris: { scale: number; dx: number; dy: number };
  mouth: 'calm' | 'grin' | 'frown' | 'grit' | 'open' | 'wavy';
  extras: readonly ('blush' | 'tear' | 'vein' | 'pop' | 'sweat' | 'flush')[];
}

export const FACES: Readonly<Record<PortraitExpression, FaceSpec>> = {
  neutral: { brow: { inner: 0, outer: 0, arch: 2, weight: 4 }, eyes: 'open', iris: { scale: 1, dx: 1, dy: 0 }, mouth: 'calm', extras: [] },
  warm: { brow: { inner: -3, outer: -1, arch: 4, weight: 4 }, eyes: 'smile', iris: { scale: 1, dx: 0, dy: 0 }, mouth: 'grin', extras: ['blush'] },
  sad: { brow: { inner: -8, outer: 4, arch: -1, weight: 4 }, eyes: 'lidded', iris: { scale: 1, dx: 0, dy: 2 }, mouth: 'frown', extras: ['tear'] },
  angry: { brow: { inner: 7, outer: -6, arch: 0, weight: 5.5 }, eyes: 'narrow', iris: { scale: 0.85, dx: 1, dy: 0 }, mouth: 'grit', extras: ['vein', 'flush'] },
  surprised: { brow: { inner: -11, outer: -10, arch: 5, weight: 4 }, eyes: 'wide', iris: { scale: 0.7, dx: 0, dy: 0 }, mouth: 'open', extras: ['pop'] },
  worried: { brow: { inner: -7, outer: 2, arch: -2, weight: 4 }, eyes: 'open', iris: { scale: 0.8, dx: -3, dy: 1 }, mouth: 'wavy', extras: ['sweat'] }
};

/** The six in GDD order, for galleries and tests. */
export const PORTRAIT_EXPRESSIONS: readonly PortraitExpression[] = PORTRAIT_SET;
