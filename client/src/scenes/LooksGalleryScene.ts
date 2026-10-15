// Dev-only contact sheet of the residents' looks (`?looks=1`; `&page=1` for the second twelve, `&page=2` for every
// hair style): each card's walking sprite (the procedural rig: front, side and back, at 3×) beside its neutral
// dialogue bust (the procedural Portrait, never the drawn art), so the two can be checked against each other and
// against the card.
import Phaser from 'phaser';
import { HAIR_STYLES, HEADWEAR_KINDS, type CardLook, type PersonaCard } from '@monde/shared';
import { personaCards } from '../world/residents';
import { characterSheet } from '../render/characterSprite';
import { lookFromCard, residentLook, BASTIEN_LOOK, type Look } from '../render/character/look';
import { frameFor, type Facing } from '../render/character/sheet';
import { Portrait } from '../dialogue/portrait';
import { portraitLook } from '../dialogue/portraitModel';
import { rosterColour } from '../dialogue/panel';
import { displayName } from '../sim/residentSim';
import { FAMILY_BODY, GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE } from '../util/constants';

const COLS = 3, ROWS = 4, PER_PAGE = COLS * ROWS;
const CELL_W = GAME_WIDTH / COLS, CELL_H = GAME_HEIGHT / ROWS;

type GalleryCard = Pick<PersonaCard, 'id' | 'name' | 'age' | 'pronouns' | 'kind' | 'appearance' | 'occupation'> & { look?: CardLook | undefined };
interface Entry { card: GalleryCard; index: number }

/** Page 2: one made-up resident per hair style (caps on the last three), to check the sprite → bust hair mapping. */
function styleEntries(): Entry[] {
  return HAIR_STYLES.map((style, i) => {
    const cap = i >= HAIR_STYLES.length - 3 ? HEADWEAR_KINDS[i - HAIR_STYLES.length + 4]! : 'none';
    const look: CardLook = {
      kind: 'human', skin: i % 10, hair: { style, colour: (i * 5) % 12 }, eyes: i % 8, build: 'medium', height: 'tall',
      outfit: { cut: 'plain', top: (i * 3) % 16, bottom: 6, bottom_style: 'trousers', shoes: 13 }, accessory: { kind: 'none' },
      ...(cap !== 'none' ? { headwear: { kind: cap, colour: 6 } } : {})
    };
    const card: GalleryCard = {
      id: `style_${style}`, name: style, age: 30, pronouns: 'they/them', kind: 'resident', appearance: '',
      occupation: cap === 'none' ? 'hair style' : cap, look
    };
    return { card, index: i };
  });
}

export class LooksGalleryScene extends Phaser.Scene {
  constructor() { super('LooksGallery'); }

  create(): void {
    const page = Number(new URLSearchParams(window.location.search).get('page') ?? 0) || 0;
    this.cameras.main.setBackgroundColor('#efe6cf');
    const entries: Entry[] = page === 2 ? styleEntries()
      : personaCards.map((card, index) => ({ card, index })).slice(page * PER_PAGE, (page + 1) * PER_PAGE);
    entries.forEach(({ card, index }, i) => {
      const x = Math.round((i % COLS) * CELL_W), y = Math.round(Math.floor(i / COLS) * CELL_H), colour = rosterColour(index);
      this.add.graphics().lineStyle(1, 0xb9a985, 1).strokeRect(x + 0.5, y + 0.5, CELL_W - 1, CELL_H - 1);
      const look: Look = card.look ? lookFromCard(card.look, colour)
        : card.kind === 'animal' ? { ...BASTIEN_LOOK, collar: colour } : residentLook(card.id, colour);
      const sheet = characterSheet(this, card.id, look);
      const views: [Facing, number][] = [['down', 4], ['left', 102], ['up', 200]];
      for (const [facing, dx] of views) {
        const { frame, flipX } = frameFor(sheet.layout, facing, 'idle', 0);
        this.add.image(x + dx, y + 28, sheet.key, frame).setOrigin(0, 0).setScale(3).setFlipX(flipX);
      }
      const bust = new Portrait(this, { residentId: card.id, look: portraitLook(card, colour), x: x + 304, y: y + 30, art: false });
      bust.root.setScale(0.5);
      bust.setExpression('neutral', true);
      const tag = card.look ? '' : '  (no look: hash)';
      const name = this.add.text(x + 8, y + 5, `${displayName(card.name)}, ${card.age}${tag}`, {
        fontFamily: FAMILY_BODY, fontSize: '15px', color: '#3b2f25', resolution: RENDER_SCALE
      });
      this.add.text(name.x + name.width + 8, y + 8, card.occupation.split(/[;,(]/)[0]!.trim().slice(0, 34), {
        fontFamily: FAMILY_BODY, fontSize: '11px', fontStyle: 'italic', color: '#6b5a45', resolution: RENDER_SCALE
      });
    });
  }
}
