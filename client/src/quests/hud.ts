// The objective line under the HUD's clock and the first-steps card (Kasey's playtest, 2026-10-18: "help guide the
// player on where to go to start the game"). ZoneScene attaches it once in create().
//
// - The objective line: a small card in the HUD's style under the clock (and the Pillar strip when it shows), what
//   quests/objective.ts says now: a header ("NEXT · before 11:30", "MEANWHILE", "FAVOR · by Day 6"), the place or the
//   thing to do with "→ Market Row" when it's on another board, and why. It replaces the Next hint card (story/hint.ts
//   has the same scene first). Hidden under scenes, dialogue and menus, while a door fades, once the player stands
//   where an open scene is about to start, and when the Journal's Quests page turns it off (remembered on the device).
//   The objectives it shows are published for the dialogue's context (quests/runtime.ts currentObjective).
// - The first-steps card: once per save, when S01a–c have handed the player the cottage keys, two or three warm lines on
//   where to go next and that the Journal's Quests page (J) keeps track. Enter or a click puts it away, as does
//   opening the Journal.
// - Toasts: a dream learned or moved on (quests/runtime.ts) shows in the zone's toast.
import type Phaser from 'phaser';
import { textSize, watchAccessibility } from '../accessibility/runtime';
import type { ProjectsAttachment } from '../projects/attach';
import type { StoryAttachment } from '../scenes/story/attach';
import { FAMILY_BODY, RENDER_SCALE } from '../util/constants';
import type { Objective, Objectives } from './objective';
import { nextQuestToast, objectivesNow } from './runtime';
import { OBJECTIVE_KEY, getQuests, objectiveShown, updateQuests, watchObjectiveShown } from './state';

/** Overlays that hide the objective line and the card (they're for walking about). */
export const OBJECTIVE_HIDDEN_UNDER = ['Story', 'Dialogue', 'Fellowship', 'TownLedger', 'People', 'SaveMenu', 'DawnReport', 'SpringReport', 'StrawPoll', 'Survey'];
/** The HUD's Pillar strip toggle (TownLedgerScene STRIP_KEY): the line sits under the strip, or where it would be. */
const STRIP_KEY = 'monde.hud.pillarStrip';
/** How often the line looks again (real ms); the objectives themselves are recomputed once a game minute or on a change. */
const REFRESH_MS = 250;
/** GDD-GAP: the card is for a New Game's first steps; a save from before this feature, loaded later in Spring, skips it. */
export const FIRST_STEPS_LAST_DAY = 2;
/** Registry keys whose change can change the objective. */
const WATCHED = ['monde.friendship', 'monde.story.flags', 'monde.projects', 'monde.town', 'monde.riddles', 'monde.quests', 'monde.inventory', 'monde.events'];

export interface QuestHudOptions {
  story: StoryAttachment;
  projects: ProjectsAttachment;
  /** The zone's toast. */
  toast(text: string): void;
  /** True while the zone can't be walked in (an edge fade). */
  busy(): boolean;
  /** The HUD box: its left edge and width (the line matches it). */
  x: number;
  w: number;
}

/** The first-steps card's lines (2–3 lines, in the game's voice), from the objectives once the cottage is the player's. */
export function firstStepsLines(o: Objectives): string[] {
  const next = o.main ?? o.next;
  return [
    'The cottage is yours, and so is the rest of the day.',
    next ? `Next: ${next.when.replace(/^Tomorrow/, 'tomorrow')}, ${next.where}. ${next.reason}` : `For now: ${o.meanwhile.title}.`,
    'Your Journal’s Quests page (J) keeps track of where to go. Until then, say hello to the neighbours (E).'
  ];
}

/** GDD-GAP: no number for it; a toast shows for about five seconds (ZoneScene showToast), so they queue that far apart. */
export const TOAST_GAP_MS = 5200;

export function attachQuestHud(scene: Phaser.Scene, opts: QuestHudOptions): void {
  const registry = scene.registry;
  const style = (size: number, color: string, italic = false): Phaser.Types.GameObjects.Text.TextStyle =>
    ({ fontFamily: FAMILY_BODY, fontSize: `${size}px`, color, fontStyle: italic ? 'italic' : 'normal', resolution: RENDER_SCALE, wordWrap: { width: opts.w - 28 } });
  const bg = scene.add.graphics();
  const head = scene.add.text(opts.x + 14, 0, '', style(13, '#e4c77f'));
  const title = scene.add.text(opts.x + 14, 0, '', style(textSize(16), '#fff0ce'));
  const why = scene.add.text(opts.x + 14, 0, '', style(textSize(14), '#d9cfb4', true));
  // The first-steps card, top left under the district's name and the controls line (and clear of the dev lines).
  const cardX = 24, cardY = 136, cardW = 440;
  const cardBg = scene.add.graphics();
  const cardText = scene.add.text(cardX + 16, cardY + 12, '', { fontFamily: FAMILY_BODY, fontSize: `${textSize(16)}px`, color: '#fff0ce', resolution: RENDER_SCALE, wordWrap: { width: cardW - 32 }, lineSpacing: 4 });
  const cardHint = scene.add.text(cardX + cardW - 14, 0, 'Enter or click to close', { fontFamily: FAMILY_BODY, fontSize: '12px', color: '#d9cfb4', fontStyle: 'italic', resolution: RENDER_SCALE }).setOrigin(1, 0);
  const line = [bg, head, title, why], card = [cardBg, cardText, cardHint];
  for (const o of [...line, ...card]) o.setVisible(false);
  scene.cameras.main.ignore([...line, ...card]);

  // ── The objectives, recomputed once a game minute or when something changes ──
  let version = 0, key = '', current: Objectives | null = null;
  const bump = (_parent: unknown, k: string) => { if (WATCHED.includes(k)) version++; };
  registry.events.on('changedata', bump).on('setdata', bump);
  const objectivesFor = (): Objectives => {
    const clock = registry.get('monde.clock') as { day: number; minute: number } | undefined;
    const k = `${clock?.day}:${clock?.minute}:${opts.story.place()}:${version}`;
    if (k !== key || !current) {
      key = k;
      current = objectivesNow(registry, { ceremony: opts.projects.hint() });
      registry.set(OBJECTIVE_KEY, current);
    }
    return current;
  };

  // ── The line ──
  let shownKey = '';
  const layout = (o: Objective | null, visible: boolean) => {
    const top = registry.get(STRIP_KEY) !== false ? 16 + 102 + 6 + 32 + 6 : 16 + 102 + 6;
    const on = visible && !!o;
    const k = on ? `${o!.header}|${o!.title}|${o!.direction}|${o!.reason}|${o!.when}|${top}` : '';
    if (k !== shownKey) {
      shownKey = k;
      if (on) {
        const header = o!.when && !o!.header.includes(o!.when.toUpperCase()) && !o!.header.includes(o!.when) ? `${o!.header} · ${o!.when}` : o!.header;
        head.setText(header.toUpperCase()).setY(top + 9);
        title.setText(o!.direction ? `${o!.title}  ${o!.direction}` : o!.title).setY(head.y + head.height + 2);
        why.setText(o!.reason).setY(title.y + title.height + 2);
        const h = why.y + why.height + 9 - top;
        bg.clear().fillStyle(0x28372d, 0.86).fillRoundedRect(opts.x, top, opts.w, h, 8)
          .lineStyle(1.5, 0xe4c77f, 0.4).strokeRoundedRect(opts.x, top, opts.w, h, 8);
      }
    }
    for (const g of line) g.setVisible(on);
  };

  // ── The first-steps card ──
  let cardUp = false;
  const dismiss = () => {
    if (!cardUp) return;
    cardUp = false;
    for (const o of card) o.setVisible(false);
  };
  const showCard = (o: Objectives) => {
    cardText.setText(firstStepsLines(o).join('\n'));
    cardHint.setY(cardText.y + cardText.height + 6);
    const h = cardHint.y + cardHint.height + 10 - cardY;
    cardBg.clear().fillStyle(0x28372d, 0.94).fillRoundedRect(cardX, cardY, cardW, h, 10)
      .lineStyle(2, 0xe4c77f, 0.7).strokeRoundedRect(cardX, cardY, cardW, h, 10);
    cardText.setInteractive({ useHandCursor: true }).once('pointerdown', dismiss);
    cardUp = true;
    updateQuests(registry, q => ({ ...q, first_steps: true }));
  };
  const onKey = (e: KeyboardEvent) => { if (cardUp && (e.key === 'Enter' || e.key === 'j' || e.key === 'J')) dismiss(); };
  scene.input.keyboard?.on('keydown', onKey);

  const firstStepsDue = (): boolean => {
    if (getQuests(registry).first_steps) return false;
    const held = registry.get('monde.story.session') as { session?: { flags: { has(f: string): boolean }; active?: string } } | undefined;
    const clock = registry.get('monde.clock') as { day: number } | undefined;
    return !!held?.session?.flags.has('s01c_done') && !held.session.active && (clock?.day ?? 99) <= FIRST_STEPS_LAST_DAY;
  };

  // Toasts wait for the zone to be uncovered (a dawn's dream news would otherwise fade under the paper).
  let toastAt = -Infinity;
  let at = 0;
  const update = (time: number) => {
    if (time - at < REFRESH_MS) return;
    at = time;
    const covered = OBJECTIVE_HIDDEN_UNDER.some(k => scene.scene.isActive(k));
    if (covered && cardUp && scene.scene.isActive('People')) dismiss();
    if (covered || opts.busy()) { layout(null, false); for (const o of card) o.setVisible(false); return; }
    if (time - toastAt > TOAST_GAP_MS) { const t = nextQuestToast(); if (t) { toastAt = time; opts.toast(t); } }
    const o = objectivesFor();
    // Standing there with the window open: the scene is about to start, nothing to point at.
    const hint = opts.story.hint();
    const arrived = !!hint && hint.open && opts.story.place() === hint.place;
    layout(o.hud, objectiveShown() && !arrived);
    if (!cardUp && firstStepsDue()) showCard(o);
    for (const c of card) c.setVisible(cardUp);
  };
  scene.events.on('update', update);
  const relayout = () => { shownKey = ''; title.setFontSize(textSize(16)); why.setFontSize(textSize(14)); cardText.setFontSize(textSize(16)); };
  const offAccess = watchAccessibility(relayout);
  const offShown = watchObjectiveShown(() => { shownKey = ''; });
  scene.events.once('shutdown', () => {
    scene.events.off('update', update);
    registry.events.off('changedata', bump).off('setdata', bump);
    scene.input.keyboard?.off('keydown', onKey);
    offAccess(); offShown();
  });
}
