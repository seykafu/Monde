// The procedural character rig: draws a CharacterLook (or Bastien's CatLook) as a full sprite sheet in
// the sheet contract's layout (sheet.ts), so every character animates before real sheets exist.
//
// Style (GDD §16.1, D15): Stardew-like chunky pixels in a 32×48 cell, feet on the bottom row; a big
// head (about 40% of the height), stubby limbs, a soft dark outline (each part's own dark tone leaning
// to a warm near-black, softer still where a part overlaps another), light from the upper left.
//
// Poses (per facing; "right" is "left" mirrored):
//   idle  rest · breathe (head and shoulders drop 1 px) · blink (rest, eyes shut)
//   walk  contact L · passing · contact R · passing: alternating legs (the trailing heel lifts at
//         contact, the swing foot clears the ground at passing), arms counter-swinging, the body 1 px
//         up on passing frames, hems flaring at contact and hair tips lagging the bob.
// Pure: no Phaser, no DOM. renderSheet returns RGBA pixels; characterSprite.ts uploads them.

import { INK, farRamp, mix, ramp, type CatLook, type CharacterLook, type Look, type Ramp } from './look';
import { Frame, Mask, lit } from './pixels';
import { FRAME_H, FRAME_W, PROCEDURAL_LAYOUT, breathFrames, columns, type Facing, type SheetLayout } from './sheet';

/** One drawing's pose. Indices are the character's own [left, right]. */
export interface Pose {
  /** Whole upper body (head, torso, arms, hem), px; −1 = up. */
  ub: number;
  /** Head and shoulders only (breathing), px; +1 = down. */
  breath: number;
  /** Foot raised off the ground, px. */
  lift: readonly [number, number];
  /** Foot ahead of the hip (side view), px; negative = behind. */
  fwd: readonly [number, number];
  /** Arm swing: +1 forward, −1 back. */
  arm: readonly [number, number];
  /** Hem and skirt flare, px. */
  flare: number;
  /** Hair tips (below the jaw) hang this many px lower than the head would put them. */
  lag: number;
  /** Ponytail / long hair / scarf tail swing, px (+ = toward screen right in front view, back in side view). */
  sway: number;
  blink: boolean;
}

const REST: Pose = { ub: 0, breath: 0, lift: [0, 0], fwd: [0, 0], arm: [0, 0], flare: 0, lag: 0, sway: 0, blink: false };
export const IDLE_POSES: readonly Pose[] = [REST, { ...REST, breath: 1 }];
export const BLINK_POSE: Pose = { ...REST, blink: true };
export const WALK_POSES: readonly Pose[] = [
  // Contact, left foot forward: right heel up, right arm forward.
  { ...REST, lift: [0, 1], fwd: [3, -3], arm: [-1, 1], flare: 1, sway: 1 },
  // Passing: the right foot swings through clear of the ground; the body rides 1 px up.
  { ...REST, ub: -1, lift: [0, 3], fwd: [-1, 1], arm: [0, 0], lag: 1 },
  // Contact, right foot forward.
  { ...REST, lift: [1, 0], fwd: [-3, 3], arm: [1, -1], flare: 1, sway: -1 },
  // Passing: the left foot swings through.
  { ...REST, ub: -1, lift: [3, 0], fwd: [1, -1], arm: [0, 0], lag: 1 }
];

type View = 'down' | 'left' | 'up';

// Anatomy (rows from the top of a 32×48 cell at rest). Soles sit on GROUND; the outline below them is the cell's last row.
const GROUND = 46;
const HEAD_TOP = 7;
const SHOULDER = 23;
const HEM = 35;

const GLINT = 0xfff8ee;
const BLUSH = 0xe8786a;

/** Render one character's whole sheet as RGBA pixels, in `layout` (the procedural layout by default). */
export function renderSheet(look: Look, layout: SheetLayout = PROCEDURAL_LAYOUT): { width: number; height: number; data: Uint8ClampedArray } {
  if (layout.frameWidth !== FRAME_W || layout.frameHeight !== FRAME_H || layout.walk !== WALK_POSES.length)
    throw new Error('renderSheet: the rig draws 32×48 cells with a 4-frame walk');
  const cols = columns(layout), width = cols * FRAME_W, height = layout.rows.length * FRAME_H;
  const data = new Uint8ClampedArray(width * height * 4);
  const breaths = breathFrames(layout);
  layout.rows.forEach((facing, row) => {
    for (let col = 0; col < cols; col++) {
      const pose = col < breaths ? IDLE_POSES[col % IDLE_POSES.length]!
        : col < layout.idle ? BLINK_POSE
        : WALK_POSES[col - layout.idle]!;
      drawFrame(look, facing, pose).blit(data, width, col * FRAME_W, row * FRAME_H, facing === 'right');
    }
  });
  return { width, height, data };
}

/** One cell. "right" is drawn as "left"; renderSheet mirrors it. */
export function drawFrame(look: Look, facing: Facing, pose: Pose): Frame {
  const view: View = facing === 'right' ? 'left' : facing;
  return look.kind === 'cat' ? drawCat(look, view, pose) : drawHuman(look, view, pose);
}

// ── Humans ──────────────────────────────────────────────────────────────────

interface Tones { skin: Ramp; hair: Ramp; top: Ramp; bottom: Ramp; shoes: Ramp; acc: Ramp; legs: Ramp }

function drawHuman(look: CharacterLook, view: View, p: Pose): Frame {
  const f = new Frame(FRAME_W, FRAME_H);
  const t: Tones = {
    skin: ramp(look.skin, true), hair: ramp(look.hair, true), top: ramp(look.top), bottom: ramp(look.bottom),
    shoes: ramp(look.shoes), acc: ramp(look.accessoryColour),
    // Under a skirt: bare legs, so the stride reads against the skirt.
    legs: look.bottomStyle === 'skirt' ? ramp(look.skin, true) : ramp(look.bottom)
  };
  if (view === 'left') drawSide(f, look, t, p);
  else drawFrontBack(f, look, t, p, view === 'down');
  return f;
}

/** Front ("down") or back ("up") view. */
function drawFrontBack(f: Frame, look: CharacterLook, t: Tones, p: Pose, front: boolean): void {
  const ub = p.ub, hb = p.ub + p.breath, ht = HEAD_TOP + hb;
  const hem = HEM + ub;
  // Screen side 0 is the left of the picture: the character's right leg/arm from the front, their left from behind.
  const charSide = (s: 0 | 1): 0 | 1 => (front ? (s === 0 ? 1 : 0) : s);

  // Arms: swung toward the camera they hang 1 px lower in front of the body; swung away they shorten and tuck behind it.
  const armTop = SHOULDER + hb + 1;
  const arms = ([0, 1] as const).map(s => {
    const a = p.arm[charSide(s)] * (front ? 1 : -1);
    const away = a < 0, toward = a > 0;
    const x = s === 0 ? (away ? 7 : 6) : (away ? 22 : 23);
    const len = away ? 6 : toward ? 9 : 8;
    return { away, sleeve: f.mask().rect(x, armTop, 3, len), hand: f.mask().rect(x, armTop + len, 3, 3) };
  });
  const drawArm = (arm: (typeof arms)[number]) => {
    f.paint(arm.sleeve, lit(arm.sleeve, t.top, { right: 1 }), t.top);
    f.paint(arm.hand, lit(arm.hand, t.skin, { right: 1, bottom: 1 }), t.skin);
  };
  arms.filter(a => a.away).forEach(drawArm);

  // Legs and shoes.
  for (const s of [0, 1] as const) {
    const lift = p.lift[charSide(s)], x = s === 0 ? 10 : 17, sole = GROUND - lift;
    const leg = f.mask().rect(x, hem - 1, 5, sole - 2 - (hem - 1));
    if (look.bottomStyle === 'shorts') {
      const thigh = leg.clone().band(0, Math.min(sole - 3, HEM + 4)), shin = leg.clone().cut(thigh);
      if (!shin.empty) f.paint(shin, lit(shin, t.skin, { right: 1 }), t.skin);
      f.paint(thigh, lit(thigh, t.bottom, { right: 1 }), t.bottom);
    } else f.paint(leg, lit(leg, t.legs, { right: 1 }), t.legs);
    const shoe = f.mask().rows(sole - 2, [[[x, x + 4]], [[s === 0 ? x - 1 : x, s === 0 ? x + 4 : x + 5]], [[s === 0 ? x - 1 : x, s === 0 ? x + 4 : x + 5]]]);
    f.paint(shoe, lit(shoe, t.shoes, { right: 1 }), t.shoes);
  }

  // Skirt over the legs, under the top's hem.
  if (look.bottomStyle === 'skirt') {
    const sk = f.mask().rows(hem - 1, [[[9, 22]], [[9, 22]], [[9, 22]], [[8, 23]], [[8, 23]], [[8 - p.flare, 23 + p.flare]], [[8 - p.flare, 23 + p.flare]]]);
    f.paint(sk, lit(sk, t.bottom, { right: 2, bottom: 1 }), t.bottom);
  }

  // Torso, with the hem flaring as the legs open.
  const shoulders = SHOULDER + hb;
  const torso = f.mask().span(shoulders, 10, 21);
  for (let y = shoulders + 1; y < hem; y++) torso.span(y, 9, 22);
  torso.span(hem, 9 - p.flare, 22 + p.flare);
  f.paint(torso, lit(torso, t.top, { right: 2, left: 1, bottom: 1 }), t.top);
  if (look.accessory === 'apron') {
    if (front) {
      const apron = f.mask().rect(11, shoulders + 1, 1, 3).rect(20, shoulders + 1, 1, 3).rect(11, shoulders + 4, 10, hem - shoulders - 1).span(hem + 3, 12, 19);
      for (let y = hem; y < hem + 3; y++) apron.span(y, 11, 20);
      f.paint(apron, lit(apron, t.acc, { right: 1, bottom: 1 }), t.acc);
    } else f.decal(f.mask().span(shoulders + 8, 9, 22).rect(14, shoulders + 8, 4, 2), t.acc.shade);
  }
  if (look.accessory === 'scarf') {
    const scarf = f.mask().span(shoulders - 1, 10, 21).span(shoulders, 9, 22).span(shoulders + 1, 10, 21);
    if (front) scarf.rect(11, shoulders + 2, 3, 5 + Math.max(0, p.lag)).span(shoulders + 7 + p.lag, 11 + Math.min(0, p.sway), 13 + Math.min(0, p.sway));
    else scarf.rect(18, shoulders + 2, 3, 4);
    f.paint(scarf, lit(scarf, t.acc, { right: 1, bottom: 1 }), t.acc);
  }

  arms.filter(a => !a.away).forEach(drawArm);

  // Head: the hair behind it first (long styles), then the face, then the hair over it.
  const head = headMask(f, ht, 'down');
  head.rect(6, ht + 8, 1, 3).rect(25, ht + 8, 1, 3); // ears
  f.paint(head, lit(head, t.skin, { right: 1, bottom: 1 }), t.skin);
  if (front) drawFace(f, look, t, ht, p.blink);
  drawHair(f, look, t, front ? 'down' : 'up', ht, p);
  if (front && look.accessory === 'glasses') {
    const rim = mix(INK, look.hair, 0.25);
    f.decal(f.mask().span(ht + 7, 9, 12).span(ht + 7, 19, 22).span(ht + 8, 13, 18), rim);
    f.decal(f.mask().rect(9, ht + 8, 1, 3).rect(12, ht + 8, 1, 3).rect(19, ht + 8, 1, 3).rect(22, ht + 8, 1, 3).span(ht + 11, 9, 12).span(ht + 11, 19, 22), rim);
  }
}

/** Side view, facing left (the near side is the character's left). */
function drawSide(f: Frame, look: CharacterLook, t: Tones, p: Pose): void {
  const ub = p.ub, hb = p.ub + p.breath, ht = HEAD_TOP + hb;
  const hem = HEM + ub, shoulders = SHOULDER + hb, armTop = shoulders + 1;
  const far = farRamp;
  const arm = (x: number, swing: number, tones: { top: Ramp; skin: Ramp }) => {
    const reach = 3 * swing, end = armTop + 10 - Math.abs(swing);
    const all = f.mask().strip(x, armTop, x - reach, end, 3);
    const sleeve = all.clone().band(0, end - 3), hand = all.clone().band(end - 2, end);
    f.paint(sleeve, lit(sleeve, tones.top, { right: 1 }), tones.top);
    f.paint(hand, lit(hand, tones.skin, { right: 1, bottom: 1 }), tones.skin);
  };
  const leg = (x: number, i: 0 | 1, tones: { legs: Ramp; bottom: Ramp; skin: Ramp; shoes: Ramp }) => {
    const lift = p.lift[i], fwd = p.fwd[i], sole = GROUND - lift, foot = x - fwd;
    const all = f.mask().strip(x, hem - 1, foot, sole - 3, 4);
    if (look.bottomStyle === 'shorts') {
      const thigh = all.clone().band(0, Math.min(sole - 4, HEM + 4)), shin = all.clone().cut(thigh);
      if (!shin.empty) f.paint(shin, lit(shin, tones.skin, { right: 1 }), tones.skin);
      f.paint(thigh, lit(thigh, tones.bottom, { right: 1 }), tones.bottom);
    } else f.paint(all, lit(all, tones.legs, { right: 1 }), tones.legs);
    // A shoe pointing left; a trailing foot (behind the hip, heel up) keeps its toe on the ground.
    const toe = foot - 2;
    const shoe = f.mask().rows(sole - 2, [[[toe + 2, toe + 5]], [[toe, toe + 5]], [[toe, toe + 5]]]);
    if (fwd < 0 && lift > 0) shoe.rect(toe, sole + 1, 2, lift);
    f.paint(shoe, lit(shoe, tones.shoes, { right: 1 }), tones.shoes);
  };

  // Far side (the character's right): arm and leg behind the body, a shade darker.
  const farTones = { top: far(t.top), skin: far(t.skin), legs: far(t.legs), bottom: far(t.bottom), shoes: far(t.shoes) };
  arm(15, p.arm[1], farTones);
  leg(14, 1, farTones);
  leg(13, 0, t);
  if (look.bottomStyle === 'skirt') {
    const sk = f.mask().rows(hem - 1, [[[11, 20]], [[11, 20]], [[10, 20]], [[10, 21]], [[10, 21]], [[10, 21 + p.flare]], [[9, 21 + p.flare]]]);
    f.paint(sk, lit(sk, t.bottom, { right: 2, bottom: 1 }), t.bottom);
  }
  const torso = f.mask().span(shoulders, 12, 19);
  for (let y = shoulders + 1; y < hem; y++) torso.span(y, 11, 20);
  torso.span(hem, 11, 20 + p.flare);
  f.paint(torso, lit(torso, t.top, { right: 2, left: 1, bottom: 1 }), t.top);
  if (look.accessory === 'apron') {
    const apron = f.mask().rect(11, shoulders + 4, 2, hem - shoulders - 1).rect(10, hem, 3, 3);
    f.paint(apron, lit(apron, t.acc, { bottom: 1 }), t.acc);
    f.decal(f.mask().span(shoulders + 8, 13, 20), t.acc.shade);
  }
  if (look.accessory === 'scarf') {
    const scarf = f.mask().span(shoulders - 1, 11, 19).span(shoulders, 11, 20).span(shoulders + 1, 12, 19)
      .rect(19 + Math.max(0, p.sway), shoulders + 1, 3, 2).rect(20 + Math.max(0, p.sway) + p.lag, shoulders + 3, 2, 3);
    f.paint(scarf, lit(scarf, t.acc, { right: 1, bottom: 1 }), t.acc);
  }
  arm(14, p.arm[0], t);

  const head = headMask(f, ht, 'left');
  head.set(7, ht + 10); // nose
  f.paint(head, lit(head, t.skin, { right: 1, bottom: 1 }), t.skin);
  // Ear.
  f.decal(f.mask().rect(16, ht + 8, 2, 3), t.skin.shade);
  f.decal(f.mask().set(17, ht + 9), t.skin.line);
  drawFace(f, look, t, ht, p.blink, true);
  drawHair(f, look, t, 'left', ht, p);
  if (look.accessory === 'glasses') {
    const rim = mix(INK, look.hair, 0.25);
    f.decal(f.mask().span(ht + 7, 8, 12).rect(8, ht + 8, 1, 3).span(ht + 11, 8, 11).span(ht + 8, 13, 16), rim);
  }
}

function headMask(f: Frame, ht: number, view: View): Mask {
  if (view === 'left') {
    const m = f.mask().rows(ht, [[[11, 20]], [[9, 22]]]);
    for (let i = 2; i <= 12; i++) m.span(ht + i, 8, 23);
    return m.rows(ht + 13, [[[8, 22]], [[9, 21]], [[11, 19]]]);
  }
  const m = f.mask().rows(ht, [[[10, 21]], [[8, 23]]]);
  for (let i = 2; i <= 13; i++) m.span(ht + i, 7, 24);
  return m.rows(ht + 14, [[[8, 23]], [[10, 21]]]);
}

function drawFace(f: Frame, look: CharacterLook, t: Tones, ht: number, blink: boolean, side = false): void {
  const dark = mix(look.eyes, INK, 0.6), iris = mix(look.eyes, INK, 0.15);
  const eye = (x: number) => {
    if (blink) { f.decal(f.mask().span(ht + 10, x, x + 1), t.skin.line); return; }
    f.decal(f.mask().rect(x, ht + 8, 2, 3), dark);
    f.dot(x + 1, ht + 9, iris).dot(x + 1, ht + 10, iris).dot(x, ht + 8, GLINT);
  };
  const cheek = mix(look.skin, BLUSH, 0.32), mouth = t.skin.inner;
  if (side) {
    eye(9);
    f.decal(f.mask().span(ht + 12, 11, 12), cheek);
    f.decal(f.mask().span(ht + 13, 8, 9), mouth);
    return;
  }
  eye(10); eye(20);
  f.decal(f.mask().span(ht + 12, 8, 9).span(ht + 12, 22, 23), cheek);
  f.decal(f.mask().span(ht + 13, 15, 16), mouth);
}

/**
 * Hair by style and view. Rows from the top of the head (r = 0); anything from the jaw down (r ≥ 16)
 * is a "tip": it lags the body's bob and swings with `sway`.
 */
function drawHair(f: Frame, look: CharacterLook, t: Tones, view: View, ht: number, p: Pose): void {
  type Row = ReadonlyArray<readonly [number, number]> | null;
  const rows: Row[] = [];
  const set = (r: number, ...spans: (readonly [number, number])[]) => { rows[r + 6] = spans; };
  const fill = (r0: number, r1: number, ...spans: (readonly [number, number])[]) => { for (let r = r0; r <= r1; r++) set(r, ...spans); };
  const style = look.hairStyle;
  // Shared crowns (rows −2..4 front/back, −2..5 side).
  const crown = (wide: boolean) => {
    if (view === 'left') {
      set(-2, [12, 20]); set(-1, [10, 22]); set(0, [9, 23]); fill(1, 4, [8, wide ? 25 : 24]);
    } else {
      set(-2, [11, 20]); set(-1, [9, 22]); set(0, [8, 23]); fill(1, 4, wide ? [6, 25] : [7, 24]);
    }
  };
  let tail: Mask | null = null;
  if (view === 'down') {
    switch (style) {
      case 'short':
        crown(false); set(5, [7, 10], [13, 24]); set(6, [7, 9], [16, 24]); set(7, [7, 8], [19, 24]); set(8, [7, 7], [22, 24]); set(9, [7, 7], [23, 24]);
        break;
      case 'cropped':
        set(-1, [10, 21]); set(0, [8, 23]); fill(1, 3, [7, 24]); set(4, [7, 9], [22, 24]); set(5, [7, 7], [24, 24]); set(6, [7, 7], [24, 24]);
        break;
      case 'bob':
        crown(true); set(5, [6, 25]); fill(6, 13, [5, 8], [23, 26]); set(14, [5, 9], [22, 26]); set(15, [6, 9], [22, 25]);
        break;
      case 'long':
        crown(true); set(5, [6, 14], [17, 25]); set(6, [6, 12], [19, 25]); set(7, [6, 10], [21, 25]);
        fill(8, 17, [6, 8], [23, 25]); fill(18, 19, [6, 8], [23, 25]); set(20, [7, 8], [23, 24]);
        break;
      case 'ponytail':
        crown(false); set(5, [7, 13], [18, 24]); set(6, [7, 9], [22, 24]); set(7, [7, 7], [24, 24]);
        // The tail peeks out beside the head.
        tail = f.mask().rect(25, ht + 5, 2, 7 + p.lag).set(25, ht + 12 + p.lag);
        break;
      case 'bun':
        set(-4, [13, 18]); set(-3, [12, 19]); crown(false); set(5, [7, 9], [22, 24]); set(6, [7, 7], [24, 24]);
        break;
    }
  } else if (view === 'up') {
    const back = (r1: number, nape: (readonly [number, number])[]) => {
      crown(style === 'bob' || style === 'long');
      fill(5, r1, style === 'bob' || style === 'long' ? [6, 25] : [7, 24]);
      set(r1 + 1, ...nape);
    };
    switch (style) {
      case 'short': back(12, [[8, 23]]); set(14, [10, 13], [18, 21]); break;
      case 'cropped': set(-1, [10, 21]); set(0, [8, 23]); fill(1, 10, [7, 24]); set(11, [8, 23]); set(12, [10, 21]); break;
      case 'bob': back(13, [[6, 25]]); set(15, [6, 25]); set(16, [7, 24]); break;
      case 'long': back(15, [[6, 25]]); fill(17, 19, [7, 24]); set(20, [8, 23]); set(21, [10, 21]); break;
      case 'ponytail':
        back(12, [[8, 23]]);
        tail = f.mask().rows(ht + 8 + p.lag, [[[14, 17]], [[14, 17]], [[14, 17]], [[14, 17]], [[14, 17]], [[14, 17]], [[14, 17]], [[14, 17]], [[15, 17]], [[15, 16]]]).shifted(p.sway, 0);
        break;
      case 'bun': set(-4, [13, 18]); set(-3, [12, 19]); back(12, [[8, 23]]); break;
    }
  } else {
    switch (style) {
      case 'short':
        crown(false); set(5, [8, 10], [13, 24]); set(6, [14, 24]); fill(7, 10, [18, 24]); set(11, [18, 23]); set(12, [19, 22]);
        break;
      case 'cropped':
        set(-1, [11, 21]); set(0, [9, 23]); fill(1, 3, [8, 24]); set(4, [13, 24]); fill(5, 9, [18, 24]); set(10, [19, 23]);
        break;
      case 'bob':
        crown(true); set(5, [8, 10], [13, 25]); fill(6, 13, [15, 25]); set(14, [16, 25]); set(15, [17, 24]);
        break;
      case 'long':
        crown(true); set(5, [8, 10], [13, 25]); fill(6, 15, [15, 25]);
        fill(16, 19, [17, 24 + Math.max(0, p.sway)]); set(20, [18, 23 + Math.max(0, p.sway)]);
        break;
      case 'ponytail':
        crown(false); set(5, [8, 10], [13, 24]); set(6, [14, 24]); fill(7, 10, [18, 24]); set(11, [19, 23]);
        tail = f.mask().rows(ht + 5 + p.lag, [[[24, 26]], [[24, 27]], [[25, 27]], [[25, 27]], [[25, 27]], [[25, 27]], [[25, 27]], [[25, 26]], [[25, 26]], [[26, 26]]]).shifted(p.sway, 0);
        break;
      case 'bun':
        set(-3, [20, 24]); fill(-2, -1, [12, 25]); set(0, [9, 25]); fill(1, 4, [8, 24]); set(5, [8, 9], [14, 24]); fill(6, 10, [18, 24]); set(11, [19, 23]);
        break;
    }
  }
  const cap = f.mask(), tips = f.mask();
  rows.forEach((spans, i) => spans?.forEach(([a, b]) => (i - 6 >= 16 ? tips : cap).span(ht + i - 6, a, b)));
  // Lagging tips stretch down rather than detach, so the hair never shows a seam.
  const hair = cap.add(tips).add(tips.shifted(0, p.lag));
  if (tail) f.paint(tail, lit(tail, t.hair, { right: 1, bottom: 1 }), t.hair);
  f.paint(hair, lit(hair, t.hair, { right: 1, top: 1 }), t.hair);
  // A highlight streak across the crown, and a tie for tails.
  const sheen = view === 'left' ? f.mask().span(ht, 12, 15).span(ht + 1, 11, 13) : f.mask().span(ht, 10, 14).span(ht + 1, 9, 11);
  f.decal(sheen.clip(hair), t.hair.light);
  if (style === 'ponytail' && view !== 'down') {
    f.decal(view === 'up' ? f.mask().span(ht + 7, 14, 17) : f.mask().rect(24, ht + 5, 1, 2), t.top.shade);
  }
}

// ── Bastien ─────────────────────────────────────────────────────────────────
// A cat on the same 32×48 cell, low on the ground: body, head, ears, tail, four legs that trot in
// diagonal pairs (front-left with back-right), the tail tip swaying.

function drawCat(look: CatLook, view: View, p: Pose): Frame {
  const f = new Frame(FRAME_W, FRAME_H);
  const fur = ramp(look.fur, true), mark = ramp(look.markings), bib = ramp(look.bib);
  const ub = p.ub, hb = p.ub + p.breath;
  // Diagonal pairs: pair A = left fore + right hind follow lift[0]/fwd[0], pair B the other two.
  const liftA = p.lift[0] ? 1 : 0, liftB = p.lift[1] ? 1 : 0;
  if (view === 'left') {
    const tailUp = p.sway;
    const tail = f.mask().strip(24, 30 + ub, 26, 37 + ub, 2).rows(28 + ub, [[[25 + tailUp, 26 + tailUp]], [[25, 26]]]);
    f.paint(tail, lit(tail, fur, { right: 1 }), fur);
    const leg = (x: number, lift: number, fwd: number, tones: Ramp) => {
      const m = f.mask().strip(x, 41 + ub, x - fwd, GROUND - 1 - lift, 2).span(GROUND - lift, x - fwd - 1, x - fwd + 1);
      f.paint(m, lit(m, tones, { right: 1 }), tones);
    };
    const farFur = farRamp(fur);
    leg(21, liftA, p.fwd[0] > 0 ? 1 : p.fwd[0] < 0 ? -1 : 0, farFur);    // far hind
    leg(11, liftB, p.fwd[1] > 0 ? 1 : p.fwd[1] < 0 ? -1 : 0, farFur);    // far fore
    const body = f.mask().rows(35 + ub, [[[12, 22]], [[10, 24]], [[9, 24]], [[9, 24]], [[9, 24]], [[10, 23]], [[11, 22]]]);
    f.paint(body, lit(body, fur, { right: 1, bottom: 1, top: 1 }), fur);
    f.decal(f.mask().rect(15, 35 + ub, 1, 3).rect(18, 35 + ub, 1, 3).rect(21, 36 + ub, 1, 3), mark.base);
    leg(19, liftB, p.fwd[1] > 0 ? 1 : p.fwd[1] < 0 ? -1 : 0, fur);       // near hind
    leg(9, liftA, p.fwd[0] > 0 ? 1 : p.fwd[0] < 0 ? -1 : 0, fur);        // near fore
    const head = f.mask().rows(28 + hb, [[[6, 6], [11, 11]], [[5, 7], [10, 12]], [[5, 12]], [[4, 13]], [[4, 13]], [[4, 13]], [[5, 12]], [[6, 11]]]);
    f.paint(head, lit(head, fur, { right: 1, bottom: 1 }), fur);
    f.decal(f.mask().rect(4, 33 + hb, 3, 2).rect(9, 36 + ub, 3, 3), bib.base);
    f.decal(f.mask().span(30 + hb, 8, 9).span(31 + hb, 8, 8), mark.base);
    if (p.blink) f.decal(f.mask().span(32 + hb, 5, 6), fur.line);
    else f.dot(5, 31 + hb, mix(look.eyes, INK, 0.3)).dot(5, 32 + hb, mix(look.eyes, INK, 0.3)).dot(6, 31 + hb, GLINT);
    f.dot(4, 33 + hb, 0xd88a8a);
    return f;
  }
  const front = view === 'down';
  const leg = (x: number, lift: number) => {
    const m = f.mask().rect(x, 40 + ub, 3, GROUND - lift - (40 + ub) + 1);
    f.paint(m, lit(m, fur, { right: 1 }), fur);
    f.decal(f.mask().span(GROUND - lift, x, x + 2), bib.base);
  };
  if (!front) {
    // From behind the tail is in front of the body.
    leg(10, liftB); leg(19, liftA);
  }
  const body = f.mask().rows(33 + ub, [[[11, 20]], [[10, 21]], [[9, 22]], [[9, 22]], [[9, 22]], [[9, 22]], [[10, 21]], [[11, 20]]]);
  f.paint(body, lit(body, fur, { right: 2, bottom: 1 }), fur);
  if (front) {
    leg(11, liftA); leg(18, liftB);
    const head = f.mask().rows(23 + hb, [[[9, 10], [21, 22]], [[9, 11], [20, 22]], [[9, 22]], [[8, 23]], [[8, 23]], [[8, 23]], [[8, 23]], [[9, 22]], [[10, 21]], [[12, 19]]]);
    f.paint(head, lit(head, fur, { right: 1, bottom: 1 }), fur);
    f.decal(f.mask().rows(23 + hb, [[[10, 10]], null, null]).set(21, 24 + hb), 0xd88a8a);
    f.decal(f.mask().span(25 + hb, 14, 17).span(26 + hb, 15, 16), mark.base);
    f.decal(f.mask().rect(13, 29 + hb, 6, 3).rect(13, 34 + ub, 6, 4), bib.base);
    const eyes = mix(look.eyes, INK, 0.3);
    if (p.blink) f.decal(f.mask().span(28 + hb, 11, 12).span(28 + hb, 19, 20), fur.line);
    else {
      f.decal(f.mask().rect(11, 27 + hb, 2, 2).rect(19, 27 + hb, 2, 2), eyes);
      f.dot(11, 27 + hb, GLINT).dot(19, 27 + hb, GLINT);
    }
    f.dot(15, 30 + hb, 0xd88a8a).dot(16, 30 + hb, 0xd88a8a);
  } else {
    const head = f.mask().rows(25 + hb, [[[9, 10], [21, 22]], [[9, 11], [20, 22]], [[9, 22]], [[8, 23]], [[8, 23]], [[8, 23]], [[9, 22]], [[10, 21]]]);
    f.paint(head, lit(head, fur, { right: 1, bottom: 1 }), fur);
    f.decal(f.mask().rect(13, 27 + hb, 1, 3).rect(16, 27 + hb, 1, 3).rect(13, 34 + ub, 1, 3).rect(16, 34 + ub, 1, 3).rect(19, 35 + ub, 1, 2), mark.base);
    const tail = f.mask().rect(15, 36 + ub, 2, 4).rect(16 + p.sway, 31 + ub, 2, 5);
    f.paint(tail, lit(tail, fur, { right: 1 }), fur);
  }
  f.decal(f.mask().span(32 + hb, 11, 20), look.collar);
  return f;
}
