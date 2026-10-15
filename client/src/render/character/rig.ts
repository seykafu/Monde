// The procedural character rig: draws a CharacterLook (or Bastien's CatLook) as a full sprite sheet in
// the sheet contract's layout (sheet.ts), so every character animates before real sheets exist.
//
// Style (GDD §16.1, D15): Stardew-like chunky pixels in a 32×48 cell, feet on the bottom row; a big
// head (about 40% of the height), stubby limbs, a soft dark outline (each part's own dark tone leaning
// to a warm near-black, softer still where a part overlaps another), light from the upper left.
//
// Bodies (§11.1): three builds (narrow, medium, broad: the torso, arms and legs move out 1 px a side per
// step; the head stays the same big head) × two heights (tall is the residents' body; short sits 2 px lower
// above the legs, so its legs are 2 px shorter). Outfit cuts: plain (the residents' placeholder top), and
// §11.1's six starter outfits: a knitted jumper (ribbed neck, hem and cuffs), a fisher's smock (long, with a
// placket), a pinafore and dungarees (a bib and straps over the `trim` layer), a workshop shirt (collar
// points, sleeves rolled to the elbow) and a harbour coat (long, buttoned, with a back vent).
//
// Poses (per facing; "right" is "left" mirrored):
//   idle  rest · breathe (head and shoulders drop 1 px) · blink (rest, eyes shut)
//   walk  contact L · passing · contact R · passing: alternating legs (the trailing heel lifts at
//         contact, the swing foot clears the ground at passing), arms counter-swinging, the body 1 px
//         up on passing frames, hems flaring at contact and hair tips lagging the bob.
// Pure: no Phaser, no DOM. renderSheet returns RGBA pixels; characterSprite.ts uploads them.

import { INK, farRamp, mix, ramp, type Build, type CatLook, type CharacterLook, type Look, type OutfitCut, type Ramp } from './look';
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

// Anatomy (rows from the top of a 32×48 cell at rest, for a tall body). Soles sit on GROUND; the outline
// below them is the cell's last row.
const GROUND = 46;
const HEAD_TOP = 7;
const SHOULDER = 23;
const HEM = 35;
/** A short body sits this much lower above the legs. */
const SHORT_DROP = 2;
/** Each build step moves the torso, arms and legs this many px out a side. */
const BUILD_DX: Record<Build, number> = { narrow: -1, medium: 0, broad: 1 };
/** Long cuts run on past the waist (px). */
const CUT_LENGTH: Partial<Record<OutfitCut, number>> = { smock: 2, coat: 4 };

const GLINT = 0xfff8ee;
const BLUSH = 0xe8786a;

/** How a look's body and clothes sit in the cell. */
export interface Fit {
  /** Half-width step: −1 narrow, 0 medium, +1 broad. */
  dx: number;
  /** 0 tall, SHORT_DROP short. */
  drop: number;
  cut: OutfitCut;
  /** Extra torso length below the waist. */
  long: number;
  /** A bib and straps over the trim layer (pinafore, dungarees). */
  bib: boolean;
  /** Sleeves rolled to the elbow (the workshop shirt). */
  rolled: boolean;
}

export function fitOf(look: CharacterLook): Fit {
  const cut = look.outfit ?? 'plain';
  return {
    dx: BUILD_DX[look.build ?? 'medium'], drop: look.height === 'short' ? SHORT_DROP : 0, cut,
    long: CUT_LENGTH[cut] ?? 0, bib: cut === 'pinafore' || cut === 'dungarees', rolled: cut === 'apron'
  };
}

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

// ── The badge (§11.1): a bust cut from the sprite ───────────────────────────

/** The bust's size: the head (with the tallest hair) and the shoulders. */
export const BADGE_W = 28;
export const BADGE_H = 28;

/** Where the bust sits in a resting front-facing frame. */
export function bustRect(look: Look): { x: number; y: number; w: number; h: number } {
  const drop = look.kind === 'human' ? fitOf(look).drop : 0;
  // A cat's head sits lower in the cell (drawCat).
  const top = look.kind === 'human' ? HEAD_TOP + drop - 5 : 20;
  return { x: (FRAME_W - BADGE_W) / 2, y: top, w: BADGE_W, h: BADGE_H };
}

/**
 * The player's badge (§11.1): the resting front frame's head and shoulders, as RGBA pixels. The Journal and
 * letters show it where a portrait would go (the player has none in VN scenes).
 */
export function renderBadge(look: Look): { width: number; height: number; data: Uint8ClampedArray } {
  const frame = drawFrame(look, 'down', REST), r = bustRect(look);
  const full = new Uint8ClampedArray(FRAME_W * FRAME_H * 4);
  frame.blit(full, FRAME_W, 0, 0);
  const data = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) {
    const sy = r.y + y;
    if (sy < 0 || sy >= FRAME_H) continue;
    data.set(full.subarray((sy * FRAME_W + r.x) * 4, (sy * FRAME_W + r.x + r.w) * 4), y * r.w * 4);
  }
  return { width: r.w, height: r.h, data };
}

// ── Humans ──────────────────────────────────────────────────────────────────

interface Tones {
  skin: Ramp; hair: Ramp; top: Ramp; trim: Ramp; bottom: Ramp; shoes: Ramp; acc: Ramp; legs: Ramp;
  /** What the torso and sleeves are made of: the top, or under a bib the trim. */
  body: Ramp;
}

function drawHuman(look: CharacterLook, view: View, p: Pose): Frame {
  const f = new Frame(FRAME_W, FRAME_H);
  const fit = fitOf(look);
  const top = ramp(look.top), trim = ramp(look.trim ?? look.top);
  const t: Tones = {
    skin: ramp(look.skin, true), hair: ramp(look.hair, true), top, trim, bottom: ramp(look.bottom),
    shoes: ramp(look.shoes), acc: ramp(look.accessoryColour),
    // Under a skirt: bare legs, so the stride reads against the skirt.
    legs: look.bottomStyle === 'skirt' ? ramp(look.skin, true) : ramp(look.bottom),
    body: fit.bib ? trim : top
  };
  if (view === 'left') drawSide(f, look, t, fit, p);
  else drawFrontBack(f, look, t, fit, p, view === 'down');
  return f;
}

/** Front ("down") or back ("up") view. */
function drawFrontBack(f: Frame, look: CharacterLook, t: Tones, fit: Fit, p: Pose, front: boolean): void {
  const { dx, drop } = fit;
  const ub = p.ub, hb = p.ub + p.breath, ht = HEAD_TOP + drop + hb;
  const hem = HEM + drop + ub, coatHem = hem + fit.long;
  // Screen side 0 is the left of the picture: the character's right leg/arm from the front, their left from behind.
  const charSide = (s: 0 | 1): 0 | 1 => (front ? (s === 0 ? 1 : 0) : s);

  // Arms: swung toward the camera they hang 1 px lower in front of the body; swung away they shorten and tuck behind it.
  const armTop = SHOULDER + drop + hb + 1;
  const arms = ([0, 1] as const).map(s => {
    const a = p.arm[charSide(s)] * (front ? 1 : -1);
    const away = a < 0, toward = a > 0;
    const x = s === 0 ? (away ? 7 : 6) - dx : (away ? 22 : 23) + dx;
    return { away, x, len: away ? 6 : toward ? 9 : 8 };
  });
  const drawArm = (arm: (typeof arms)[number]) => {
    const cloth = fit.rolled ? Math.min(4, arm.len) : arm.len;
    const sleeve = f.mask().rect(arm.x, armTop, 3, cloth), skin = f.mask().rect(arm.x, armTop + cloth, 3, arm.len - cloth + 3);
    f.paint(sleeve, lit(sleeve, t.body, { right: 1 }), t.body);
    f.paint(skin, lit(skin, t.skin, { right: 1, bottom: 1 }), t.skin);
    // Ribbed cuffs (the hand's edge takes the sleeve's last row).
    if (fit.cut === 'jumper' && cloth >= 3) f.decal(f.mask().span(armTop + cloth - 2, arm.x, arm.x + 2), t.body.shade);
  };
  arms.filter(a => a.away).forEach(drawArm);

  // Legs and shoes.
  const legW = 5 + dx;
  for (const s of [0, 1] as const) {
    const lift = p.lift[charSide(s)], x = s === 0 ? 10 - dx : 17, sole = GROUND - lift;
    const leg = f.mask().rect(x, hem - 1, legW, sole - 2 - (hem - 1));
    if (look.bottomStyle === 'shorts') {
      const thigh = leg.clone().band(0, Math.min(sole - 3, HEM + drop + 4)), shin = leg.clone().cut(thigh);
      if (!shin.empty) f.paint(shin, lit(shin, t.skin, { right: 1 }), t.skin);
      f.paint(thigh, lit(thigh, t.bottom, { right: 1 }), t.bottom);
    } else f.paint(leg, lit(leg, t.legs, { right: 1 }), t.legs);
    const toe: readonly [number, number] = s === 0 ? [x - 1, x + legW - 1] : [x, x + legW];
    const shoe = f.mask().rows(sole - 2, [[[x, x + legW - 1]], [toe], [toe]]);
    f.paint(shoe, lit(shoe, t.shoes, { right: 1 }), t.shoes);
  }

  // Skirt over the legs, under the top's hem.
  if (look.bottomStyle === 'skirt') {
    const a = 9 - dx, b = 22 + dx;
    const sk = f.mask().rows(hem - 1, [[[a, b]], [[a, b]], [[a, b]], [[a - 1, b + 1]], [[a - 1, b + 1]], [[a - 1 - p.flare, b + 1 + p.flare]], [[a - 1 - p.flare, b + 1 + p.flare]]]);
    f.paint(sk, lit(sk, t.bottom, { right: 2, bottom: 1 }), t.bottom);
  }

  // Torso, with the hem flaring as the legs open; long cuts run on past the waist in an A-line.
  const shoulders = SHOULDER + drop + hb, x0 = 9 - dx, x1 = 22 + dx;
  const torso = f.mask().span(shoulders, x0 + 1, x1 - 1);
  for (let y = shoulders + 1; y < coatHem; y++) torso.span(y, y > hem ? x0 - 1 : x0, y > hem ? x1 + 1 : x1);
  const out = fit.long ? 1 : 0;
  torso.span(coatHem, x0 - out - p.flare, x1 + out + p.flare);
  f.paint(torso, lit(torso, t.body, { right: 2, left: 1, bottom: 1 }), t.body);
  drawCutFrontBack(f, t, fit, front, shoulders, hem, coatHem, p);

  if (look.accessory === 'apron') {
    if (front) {
      const a = 11 - dx, b = 20 + dx;
      const apron = f.mask().rect(a, shoulders + 1, 1, 3).rect(b, shoulders + 1, 1, 3).rect(a, shoulders + 4, b - a + 1, hem - shoulders - 1).span(hem + 3, a + 1, b - 1);
      for (let y = hem; y < hem + 3; y++) apron.span(y, a, b);
      f.paint(apron, lit(apron, t.acc, { right: 1, bottom: 1 }), t.acc);
    } else f.decal(f.mask().span(shoulders + 8, x0, x1).rect(14, shoulders + 8, 4, 2), t.acc.shade);
  }
  if (look.accessory === 'scarf') {
    const scarf = f.mask().span(shoulders - 1, 10 - dx, 21 + dx).span(shoulders, 9 - dx, 22 + dx).span(shoulders + 1, 10 - dx, 21 + dx);
    if (front) scarf.rect(11 - dx, shoulders + 2, 3, 5 + Math.max(0, p.lag)).span(shoulders + 7 + p.lag, 11 - dx + Math.min(0, p.sway), 13 - dx + Math.min(0, p.sway));
    else scarf.rect(18 + dx, shoulders + 2, 3, 4);
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

/** The outfit's details over the torso, front or back. Only tones the sprite already has. */
function drawCutFrontBack(f: Frame, t: Tones, fit: Fit, front: boolean, shoulders: number, hem: number, coatHem: number, p: Pose): void {
  const { dx } = fit, x0 = 9 - dx, x1 = 22 + dx;
  switch (fit.cut) {
    case 'jumper': {
      // Ribbing: a neckband in front and a knitted band along the hem.
      if (front) f.decal(f.mask().span(shoulders + 1, 13, 18), t.top.shade);
      const rib = f.mask();
      for (let x = x0 - p.flare; x <= x1 + p.flare; x += 2) rib.set(x, hem - 1);
      f.decal(rib, t.top.shade);
      break;
    }
    case 'smock':
      if (front) f.decal(f.mask().rect(15, shoulders + 1, 2, 5), t.top.shade).decal(f.mask().set(15, shoulders + 3).set(15, shoulders + 5), t.top.light);
      else f.decal(f.mask().span(shoulders + 4, x0 + 1, x1 - 1), t.top.shade);
      break;
    case 'apron':
      // A shirt: collar points.
      if (front) f.decal(f.mask().set(13, shoulders + 1).set(14, shoulders + 2).set(18, shoulders + 1).set(17, shoulders + 2), t.top.light);
      else f.decal(f.mask().span(shoulders + 1, 12, 19), t.top.shade);
      break;
    case 'coat':
      if (front) {
        // Lapels, the opening and three buttons.
        f.decal(f.mask().set(12, shoulders + 1).set(13, shoulders + 2).set(19, shoulders + 1).set(18, shoulders + 2), t.top.shade);
        f.decal(f.mask().rect(16, shoulders + 3, 1, coatHem - shoulders - 3), t.top.line);
        f.decal(f.mask().set(14, shoulders + 5).set(14, shoulders + 8).set(14, shoulders + 11), t.top.light);
      } else {
        f.decal(f.mask().rect(15, shoulders + 1, 2, 1), t.top.shade);
        f.decal(f.mask().rect(16, hem, 1, coatHem - hem), t.top.line);
      }
      break;
    case 'pinafore':
    case 'dungarees': {
      // The bib and straps (or crossed straps behind), and the waistband, in the top's colour over the trim layer.
      const a = 11 - dx, b = 20 + dx;
      const bib = f.mask();
      if (front) bib.rect(a, shoulders, 2, 3).rect(b - 1, shoulders, 2, 3).rect(a, shoulders + 3, b - a + 1, hem - shoulders - 3);
      else {
        for (let y = shoulders; y < hem - 2; y++) {
          const k = Math.round(((y - shoulders) / Math.max(1, hem - 3 - shoulders)) * (b - a - 3));
          bib.span(y, a + k, a + k + 1).span(y, b - k - 1, b - k);
        }
      }
      for (let y = hem - 2; y <= hem; y++) bib.span(y, x0, x1);
      f.paint(bib, lit(bib, t.top, { right: 1, bottom: 1 }), t.top);
      if (front && fit.cut === 'dungarees') f.decal(f.mask().set(a, shoulders + 3).set(b, shoulders + 3), t.top.light);
      if (front && fit.cut === 'pinafore') f.decal(f.mask().span(shoulders + 6, a + 1, b - 1), t.top.shade);
      break;
    }
    case 'plain':
      break;
  }
}

/** Side view, facing left (the near side is the character's left). */
function drawSide(f: Frame, look: CharacterLook, t: Tones, fit: Fit, p: Pose): void {
  const { dx, drop } = fit;
  const ub = p.ub, hb = p.ub + p.breath, ht = HEAD_TOP + drop + hb;
  const hem = HEM + drop + ub, coatHem = hem + fit.long, shoulders = SHOULDER + drop + hb, armTop = shoulders + 1;
  const far = farRamp;
  const arm = (x: number, swing: number, tones: { body: Ramp; skin: Ramp }) => {
    const reach = 3 * swing, end = armTop + 10 - Math.abs(swing);
    const all = f.mask().strip(x, armTop, x - reach, end, 3);
    const split = fit.rolled ? armTop + 3 : end - 3;
    const sleeve = all.clone().band(0, split), hand = all.clone().band(split + 1, end);
    f.paint(sleeve, lit(sleeve, tones.body, { right: 1 }), tones.body);
    f.paint(hand, lit(hand, tones.skin, { right: 1, bottom: 1 }), tones.skin);
  };
  const legW = dx > 0 ? 5 : 4;
  const leg = (x: number, i: 0 | 1, tones: { legs: Ramp; bottom: Ramp; skin: Ramp; shoes: Ramp }) => {
    const lift = p.lift[i], fwd = p.fwd[i], sole = GROUND - lift, foot = x - fwd;
    const all = f.mask().strip(x, hem - 1, foot, sole - 3, legW);
    if (look.bottomStyle === 'shorts') {
      const thigh = all.clone().band(0, Math.min(sole - 4, HEM + drop + 4)), shin = all.clone().cut(thigh);
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
  const farTones = { body: far(t.body), skin: far(t.skin), legs: far(t.legs), bottom: far(t.bottom), shoes: far(t.shoes) };
  arm(15, p.arm[1], farTones);
  leg(14, 1, farTones);
  leg(13, 0, t);
  const s0 = 11 - dx, s1 = 20 + dx;
  if (look.bottomStyle === 'skirt') {
    const sk = f.mask().rows(hem - 1, [[[s0, s1]], [[s0, s1]], [[s0 - 1, s1]], [[s0 - 1, s1 + 1]], [[s0 - 1, s1 + 1]], [[s0 - 1, s1 + 1 + p.flare]], [[s0 - 2, s1 + 1 + p.flare]]]);
    f.paint(sk, lit(sk, t.bottom, { right: 2, bottom: 1 }), t.bottom);
  }
  const torso = f.mask().span(shoulders, s0 + 1, s1 - 1);
  for (let y = shoulders + 1; y < coatHem; y++) torso.span(y, s0, y > hem ? s1 + 1 : s1);
  torso.span(coatHem, s0, s1 + (fit.long ? 1 : 0) + p.flare);
  f.paint(torso, lit(torso, t.body, { right: 2, left: 1, bottom: 1 }), t.body);
  drawCutSide(f, t, fit, shoulders, hem, coatHem);
  if (look.accessory === 'apron') {
    const apron = f.mask().rect(s0, shoulders + 4, 2, hem - shoulders - 1).rect(s0 - 1, hem, 3, 3);
    f.paint(apron, lit(apron, t.acc, { bottom: 1 }), t.acc);
    f.decal(f.mask().span(shoulders + 8, s0 + 2, s1), t.acc.shade);
  }
  if (look.accessory === 'scarf') {
    const scarf = f.mask().span(shoulders - 1, s0, s1 - 1).span(shoulders, s0, s1).span(shoulders + 1, s0 + 1, s1 - 1)
      .rect(s1 - 1 + Math.max(0, p.sway), shoulders + 1, 3, 2).rect(s1 + Math.max(0, p.sway) + p.lag, shoulders + 3, 2, 3);
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

/** The outfit's details seen from the side (facing left: the front edge is the torso's left). */
function drawCutSide(f: Frame, t: Tones, fit: Fit, shoulders: number, hem: number, coatHem: number): void {
  const s0 = 11 - fit.dx, s1 = 20 + fit.dx;
  switch (fit.cut) {
    case 'jumper': {
      const rib = f.mask();
      for (let x = s0; x <= s1; x += 2) rib.set(x, hem - 1);
      f.decal(rib, t.top.shade);
      break;
    }
    case 'smock':
      f.decal(f.mask().rect(s0 + 1, shoulders + 1, 1, 4), t.top.shade);
      break;
    case 'apron':
      f.decal(f.mask().set(s0 + 1, shoulders + 1).set(s0 + 2, shoulders + 2), t.top.light);
      break;
    case 'coat':
      f.decal(f.mask().rect(s0, shoulders + 2, 1, coatHem - shoulders - 2), t.top.shade);
      f.decal(f.mask().set(s0 + 1, shoulders + 5).set(s0 + 1, shoulders + 8).set(s0 + 1, shoulders + 11), t.top.light);
      break;
    case 'pinafore':
    case 'dungarees': {
      const bib = f.mask().rect(15, shoulders, 2, 3).rect(s0, shoulders + 3, 4, hem - shoulders - 3);
      for (let y = hem - 2; y <= hem; y++) bib.span(y, s0, s1);
      f.paint(bib, lit(bib, t.top, { right: 1, bottom: 1 }), t.top);
      break;
    }
    case 'plain':
      break;
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
 * is a "tip": it lags the body's bob and swings with `sway`. Extra pieces (tails, bunches, plaits) are
 * separate masks drawn behind the cap.
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
  /** The big round mop of curls (all views share the top). */
  const curlCrown = () => {
    set(-4, [11, 14], [17, 20]); set(-3, [9, 22]); set(-2, [7, 24]); set(-1, [6, 25]); fill(0, 4, [5, 26]);
  };
  /** Tufts standing up from the crown. */
  const tuftCrown = (side: boolean) => {
    if (side) { set(-4, [11, 11], [15, 16], [20, 21]); set(-3, [10, 12], [14, 17], [19, 22]); set(-2, [9, 23]); set(-1, [8, 24]); fill(0, 4, [8, 24]); }
    else { set(-4, [9, 9], [13, 14], [19, 20]); set(-3, [9, 11], [12, 15], [18, 21]); set(-2, [8, 23]); set(-1, [7, 24]); fill(0, 4, [7, 24]); }
  };
  let extra: Mask | null = null;
  /** Shade dots for texture (curls, plaits), clipped to the hair. */
  const texture = f.mask();
  /** Hair ties: in the top's shade, like the ponytail's. */
  const ties = f.mask();
  /** A plait hanging from (x, r0) to r1, `w` px wide: bands of shade every other row and a tie at the end. */
  const plait = (x: number, r0: number, r1: number, w: number, swing: number): Mask => {
    const m = f.mask();
    for (let r = r0; r <= r1; r++) {
      const lag = r >= 16 ? p.lag : 0, sx = r >= 16 ? swing : 0, k = (r - r0) % 4;
      // Woven: every other row pinches in on alternating sides, so the outline scallops like a plait.
      m.span(ht + r + lag, x + sx + (k === 1 ? 1 : 0), x + w - 1 + sx - (k === 3 ? 1 : 0));
      if (k === 1 || k === 3) texture.set(x + sx + (k === 1 ? 1 : w - 2), ht + r + lag);
    }
    const end = ht + r1 + (r1 >= 16 ? p.lag : 0) - 1;
    ties.span(end, x + (r1 >= 16 ? swing : 0), x + w - 1 + (r1 >= 16 ? swing : 0));
    return m;
  };
  /** A bunch (pigtail) sticking out at ear level; `dir` −1 to the screen left, +1 to the right. */
  const bunch = (x: number, dir: -1 | 1): Mask => {
    const at = (dx: number) => x + dir * dx;
    const r0 = 4 + p.lag;
    const m = f.mask().rows(ht + r0, [[[Math.min(at(0), at(1)), Math.max(at(0), at(1))]], [[Math.min(at(0), at(2)), Math.max(at(0), at(2))]],
      [[Math.min(at(0), at(3)), Math.max(at(0), at(3))]], [[Math.min(at(0), at(3)), Math.max(at(0), at(3))]],
      [[Math.min(at(1), at(3)), Math.max(at(1), at(3))]], [[Math.min(at(1), at(2)), Math.max(at(1), at(2))]]]);
    ties.set(x, ht + r0 + 1).set(x, ht + r0 + 2);
    return m;
  };
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
        extra = f.mask().rect(25, ht + 5, 2, 7 + p.lag).set(25, ht + 12 + p.lag);
        break;
      case 'bun':
        set(-4, [13, 18]); set(-3, [12, 19]); crown(false); set(5, [7, 9], [22, 24]); set(6, [7, 7], [24, 24]);
        break;
      case 'curly':
        curlCrown(); set(5, [5, 11], [14, 17], [20, 26]); set(6, [5, 9], [22, 26]);
        fill(7, 11, [5, 7], [24, 26]); set(8, [4, 7], [24, 27]); set(10, [4, 7], [24, 27]); set(12, [6, 7], [24, 25]);
        texture.set(13, ht + 1).set(22, ht + 1).set(10, ht + 3).set(18, ht + 3).set(6, ht + 9).set(25, ht + 9);
        break;
      case 'braids':
        crown(false); set(5, [7, 14], [17, 24]); set(6, [7, 10], [21, 24]); fill(7, 12, [7, 8], [23, 24]);
        extra = plait(5, 11, 22, 3, 0).add(plait(24, 11, 22, 3, 0));
        break;
      case 'buzz':
        set(-1, [10, 21]); set(0, [8, 23]); fill(1, 2, [7, 24]); set(3, [7, 8], [23, 24]); set(4, [7, 7], [24, 24]);
        break;
      case 'pigtails':
        crown(false); set(5, [7, 14], [17, 24]); set(6, [7, 9], [22, 24]); set(7, [7, 7], [24, 24]);
        extra = bunch(6, -1).add(bunch(25, 1));
        break;
      case 'swept':
        crown(true); set(5, [6, 18], [21, 25]); set(6, [6, 15], [22, 25]); set(7, [6, 12], [23, 25]); set(8, [6, 9], [23, 25]);
        fill(9, 14, [6, 8], [23, 25]); set(15, [7, 8], [23, 24]);
        break;
      case 'tufty':
        tuftCrown(false); set(5, [7, 9], [11, 13], [15, 18], [21, 24]); set(6, [7, 8], [12, 12], [16, 17], [23, 24]); set(7, [7, 7], [24, 24]);
        break;
    }
  } else if (view === 'up') {
    const back = (r1: number, nape: (readonly [number, number])[]) => {
      crown(style === 'bob' || style === 'long' || style === 'swept');
      fill(5, r1, style === 'bob' || style === 'long' || style === 'swept' ? [6, 25] : [7, 24]);
      set(r1 + 1, ...nape);
    };
    switch (style) {
      case 'short': back(12, [[8, 23]]); set(14, [10, 13], [18, 21]); break;
      case 'cropped': set(-1, [10, 21]); set(0, [8, 23]); fill(1, 10, [7, 24]); set(11, [8, 23]); set(12, [10, 21]); break;
      case 'bob': back(13, [[6, 25]]); set(15, [6, 25]); set(16, [7, 24]); break;
      case 'long': back(15, [[6, 25]]); fill(17, 19, [7, 24]); set(20, [8, 23]); set(21, [10, 21]); break;
      case 'ponytail':
        back(12, [[8, 23]]);
        extra = f.mask().rows(ht + 8 + p.lag, [[[14, 17]], [[14, 17]], [[14, 17]], [[14, 17]], [[14, 17]], [[14, 17]], [[14, 17]], [[14, 17]], [[15, 17]], [[15, 16]]]).shifted(p.sway, 0);
        break;
      case 'bun': set(-4, [13, 18]); set(-3, [12, 19]); back(12, [[8, 23]]); break;
      case 'curly':
        curlCrown(); fill(5, 12, [5, 26]); set(8, [4, 27]); set(10, [4, 27]); set(13, [6, 25]); set(14, [8, 23]);
        texture.set(10, ht + 1).set(19, ht + 1).set(14, ht + 5).set(22, ht + 6).set(9, ht + 9).set(17, ht + 10);
        break;
      case 'braids':
        back(12, [[8, 23]]);
        extra = plait(10, 13, 22, 3, p.sway).add(plait(19, 13, 22, 3, p.sway));
        break;
      case 'buzz': set(-1, [10, 21]); set(0, [8, 23]); fill(1, 9, [7, 24]); set(10, [8, 23]); break;
      case 'pigtails': back(12, [[8, 23]]); extra = bunch(6, -1).add(bunch(25, 1)); break;
      case 'swept': back(14, [[6, 25]]); set(16, [8, 23]); break;
      case 'tufty': tuftCrown(false); fill(5, 11, [7, 24]); set(12, [8, 23]); set(13, [9, 11], [14, 17], [20, 22]); break;
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
        extra = f.mask().rows(ht + 5 + p.lag, [[[24, 26]], [[24, 27]], [[25, 27]], [[25, 27]], [[25, 27]], [[25, 27]], [[25, 27]], [[25, 26]], [[25, 26]], [[26, 26]]]).shifted(p.sway, 0);
        break;
      case 'bun':
        set(-3, [20, 24]); fill(-2, -1, [12, 25]); set(0, [9, 25]); fill(1, 4, [8, 24]); set(5, [8, 9], [14, 24]); fill(6, 10, [18, 24]); set(11, [19, 23]);
        break;
      case 'curly':
        set(-4, [12, 15], [18, 21]); set(-3, [10, 23]); set(-2, [8, 25]); set(-1, [7, 26]); fill(0, 4, [6, 26]);
        set(5, [6, 9], [12, 26]); fill(6, 11, [15, 26]); set(8, [15, 27]); set(10, [15, 27]); set(12, [16, 25]); set(13, [17, 24]);
        texture.set(14, ht).set(23, ht + 1).set(18, ht + 4).set(24, ht + 8).set(19, ht + 10);
        break;
      case 'braids':
        crown(false); set(5, [8, 10], [13, 24]); set(6, [14, 24]); fill(7, 10, [18, 24]); set(11, [19, 23]);
        extra = plait(20, 12, 22, 3, p.sway);
        break;
      case 'buzz':
        set(-1, [11, 21]); set(0, [9, 23]); fill(1, 3, [8, 24]); set(4, [16, 24]); fill(5, 9, [18, 24]); set(10, [19, 23]);
        break;
      case 'pigtails':
        crown(false); set(5, [8, 10], [13, 24]); set(6, [14, 24]); fill(7, 10, [18, 24]); set(11, [19, 23]);
        extra = bunch(23, 1);
        break;
      case 'swept':
        crown(true); set(5, [7, 25]); set(6, [7, 12], [14, 25]); set(7, [7, 10], [15, 25]); fill(8, 13, [16, 25]); set(14, [17, 25]); set(15, [18, 24]);
        break;
      case 'tufty':
        tuftCrown(true); set(5, [8, 8], [10, 11], [14, 24]); set(6, [15, 24]); fill(7, 10, [18, 24]); set(11, [19, 23]);
        break;
    }
  }
  const cap = f.mask(), tips = f.mask();
  rows.forEach((spans, i) => spans?.forEach(([a, b]) => (i - 6 >= 16 ? tips : cap).span(ht + i - 6, a, b)));
  // Lagging tips stretch down rather than detach, so the hair never shows a seam.
  const hair = cap.add(tips).add(tips.shifted(0, p.lag));
  if (extra) f.paint(extra, lit(extra, t.hair, { right: 1, bottom: 1 }), t.hair);
  f.paint(hair, lit(hair, t.hair, { right: 1, top: 1 }), t.hair);
  // A highlight streak across the crown, texture, and ties for tails, plaits and bunches.
  const sheen = view === 'left' ? f.mask().span(ht, 12, 15).span(ht + 1, 11, 13) : f.mask().span(ht, 10, 14).span(ht + 1, 9, 11);
  f.decal(sheen.clip(hair), t.hair.light);
  f.decal(texture, t.hair.shade);
  if (style === 'ponytail' && view !== 'down') {
    f.decal(view === 'up' ? f.mask().span(ht + 7, 14, 17) : f.mask().rect(24, ht + 5, 1, 2), t.top.shade);
  }
  f.decal(ties, t.top.shade);
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
