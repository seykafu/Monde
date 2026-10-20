import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { SavedFellow, BUILDS, HEIGHTS, HEADWEAR_KINDS, OUTFIT_CUTS } from '@monde/shared';
import { DEFAULT_PLAYER_LOOK, HAIR_STYLES, lookKey, lookFromCard, residentLook, mix, INK } from '../look';
import { BLINK_POSE, IDLE_POSES, drawFrame, renderBadge, renderSheet } from '../rig';
import { DEFAULT_CHOICES, lookFromChoices } from '../../../fellow/options';
import { playerLook, PLAYER_LOOK_KEY } from '../../characterSprite';
import baseline from './resident-baseline.json';
import { loadFullRoster } from '../../../sim/__tests__/content';

vi.mock('phaser', () => ({ default: {} }));

describe('Fellow facelift', () => {
  it('preserves pre-facelift RGBA hashes for all 212 residents and hair/outfit/cap coverage', async () => {
    // Recorded from the unmodified rig before adding face; never regenerate to approve a Fellow change.
    const roster = await loadFullRoster();
    expect(roster).toHaveLength(212);
    const looks = roster.map(c => ({ id: c.id, look: c.look ? lookFromCard(c.look, 0x5fa36a) : residentLook(c.id, 0x5fa36a) }));
    for (const id of ['odile', 'pell', 'margo', 'teo', 'augusta'])
      looks.push({ id: `hash-${id}`, look: residentLook(id, 0xaa735c) });
    for (const hairStyle of HAIR_STYLES) for (const outfit of OUTFIT_CUTS) for (const headwear of HEADWEAR_KINDS)
      looks.push({ id: `${hairStyle}-${outfit}-${headwear}`, look: lookFromCard({
        kind: 'human', skin: 8, hair: { style: hairStyle, colour: 3 }, eyes: 1, build: 'broad', height: 'short',
        outfit: { cut: outfit, top: 4, bottom: 15, bottom_style: 'trousers', shoes: 2, trim: 9 },
        accessory: { kind: 'none' }, headwear: { kind: headwear }
      }, 0x5fa36a) });
    expect(looks).toHaveLength(553);
    expect(Object.keys(baseline)).toHaveLength(looks.length);
    for (const { id, look } of looks)
      expect(createHash('sha256').update(renderSheet(look).data).digest('hex'), id)
        .toBe((baseline as Record<string, string>)[id]);
  });

  it('round-trips new and legacy looks through the saved Fellow schema', () => {
    const legacy = { ...DEFAULT_PLAYER_LOOK };
    delete legacy.face;
    for (const look of [DEFAULT_PLAYER_LOOK, legacy]) {
      const saved = { profile: null, look };
      expect(SavedFellow.parse(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    }
    expect(lookFromChoices(DEFAULT_CHOICES)).toEqual(DEFAULT_PLAYER_LOOK);
    expect(lookKey(legacy)).not.toBe(lookKey(DEFAULT_PLAYER_LOOK));
  });

  it('upgrades a legacy registry look without mutating it', () => {
    const legacy = { ...DEFAULT_PLAYER_LOOK };
    delete legacy.face;
    const get = vi.fn(() => legacy);
    const result = playerLook({ get } as unknown as Parameters<typeof playerLook>[0]);
    expect(get).toHaveBeenCalledWith(PLAYER_LOOK_KEY);
    expect(result).toEqual(DEFAULT_PLAYER_LOOK);
    expect(legacy).not.toHaveProperty('face');
    expect(playerLook({ get: () => undefined } as unknown as Parameters<typeof playerLook>[0])).toBe(DEFAULT_PLAYER_LOOK);
  });

  it('limits front idle changes to the head, shoulder corners and hands for all builds and heights', () => {
    for (const hairStyle of HAIR_STYLES) for (const build of BUILDS) for (const height of HEIGHTS) {
      const look = { ...DEFAULT_PLAYER_LOOK, hairStyle, build, height }, old = { ...look };
      delete old.face;
      const a = drawFrame(old, 'down', IDLE_POSES[0]!), b = drawFrame(look, 'down', IDLE_POSES[0]!);
      const drop = height === 'short' ? 2 : 0, dx = BUILDS.indexOf(build) - 1;
      let changes = 0;
      for (let y = 0; y < 48; y++) for (let x = 0; x < 32; x++) {
        if (a.get(x, y) === b.get(x, y)) continue;
        changes++;
        const head = y <= 23 + drop;
        const hand = y >= 31 + drop && y <= 36 + drop && (x <= 9 - dx || x >= 22 + dx);
        // The requested one-pixel shoulder rounding and its automatic outline sit beside the bust.
        const shoulder = y >= 23 + drop && y <= 25 + drop && (x <= 9 - dx || x >= 22 + dx);
        expect(head || hand || shoulder, `${hairStyle}/${build}/${height}: ${x},${y}`).toBe(true);
      }
      expect(changes).toBeGreaterThan(0);
    }
  });

  it('keeps the bright 2×3 eyes, inward catchlights and curved blink clear of every fringe', () => {
    for (const hairStyle of HAIR_STYLES) {
      const look = { ...DEFAULT_PLAYER_LOOK, hairStyle };
      const open = drawFrame(look, 'down', IDLE_POSES[0]!), shut = drawFrame(look, 'down', BLINK_POSE);
      expect(open.get(12, 15), hairStyle).toBe(0xfff8ee);
      expect(open.get(19, 15), hairStyle).toBe(0xfff8ee);
      const iris = mix(look.eyes, INK, 0.15);
      for (const [x, inner] of [[11, 12], [19, 19]]) {
        for (let y = 15; y <= 17; y++) for (let xx = x!; xx <= x! + 1; xx++)
          expect(open.get(xx, y), hairStyle).toBe(y === 15 && xx === inner ? 0xfff8ee : iris);
        expect(shut.get(x!, 16), hairStyle).toBe(iris);
        expect(shut.get(x! + 1, 17), hairStyle).toBe(iris);
        expect(shut.get(x! + 2, 16), hairStyle).toBe(iris);
      }
      const side = drawFrame(look, 'left', IDLE_POSES[0]!);
      expect(side.get(10, 15), hairStyle).toBe(0xfff8ee);
      expect(side.get(9, 17), hairStyle).toBe(iris);
      const badge = renderBadge(look);
      expect(badge.width).toBe(28);
      expect(badge.height).toBe(28);
    }
  });
});
