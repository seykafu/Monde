import Phaser from 'phaser';
import { parse } from 'yaml';
import copyYaml from '../../../content/surveys.yaml?raw';
import type { Clock } from '../sim/clock';
import { metResidents } from '../friendship/state';
import { getFriendship } from './friendship';
import { findCard } from '../world/roster';
import { telemetry } from '../telemetry/emit';
import { queue, surveyGate } from '../telemetry/runtime';
import type { EventData } from '../telemetry/schema';
import { GAME_WIDTH, GAME_HEIGHT, FAMILY_BODY } from '../util/constants';
const copy = parse(copyYaml) as { title: string; intro: string; scale: string[]; day7: Record<'pace' | 'residents' | 'next', string>; spring: { talk_again: string; talk_choices: string[]; town_change: string; anything_else: string; text_note: string } };
type Answer = Extract<EventData, { type: 'survey_answer' }>['answer'];
interface Open { host: Phaser.Scene; clock: Clock; survey: 'day7' | 'spring' }
interface Question { text: string; choices?: string[]; answer(value: number | string): Answer }
export function openSurvey(host: Phaser.Scene, clock: Clock, survey: Open['survey']): boolean {
  if (!surveyGate.claim(survey, queue.enabled, clock.day)) return false;
  if (!host.scene.get('Survey')) host.scene.add('Survey', SurveyScene, false);
  host.scene.launch('Survey', { host, clock, survey });
  return true;
}
/** Observe the existing report's shutdown, including its return-to-title path. */
export function surveyAfterReport(host: Phaser.Scene, clock: Clock): void {
  host.scene.get('SpringReport').events.once('shutdown', () => {
    host.game.events.once('poststep', () => openSurvey(host.scene.isActive('Title') ? host.scene.get('Title') : host, clock, 'spring'));
  });
}
export class SurveyScene extends Phaser.Scene {
  private opened!: Open;
  constructor() { super('Survey'); }
  init(data: Open): void { this.opened = data; }
  create(): void {
    const { host, clock, survey } = this.opened;
    const previousInput = host.input.enabled, previousKeys = host.input.keyboard?.enabled;
    host.input.enabled = false; if (host.input.keyboard) host.input.keyboard.enabled = false;
    clock.pause('survey'); this.scene.bringToTop();
    const questions: Question[] = survey === 'day7'
      ? (['pace', 'residents', 'next'] as const).map(question => ({ text: copy.day7[question], choices: copy.scale, answer: value => ({ survey, question, value: Number(value) }) }))
      : [...metResidents(getFriendship(this.registry)).filter(id => !!findCard(id)).map(resident => ({
        text: `${findCard(resident)!.name}\n${copy.spring.talk_again}`, choices: copy.spring.talk_choices,
        answer: (value: number | string): Answer => ({ survey: 'spring', question: 'talk_again', resident, value: (['yes', 'not_sure', 'no'] as const)[Number(value)-1]! }),
      })), { text: copy.spring.town_change, choices: copy.scale, answer: value => ({ survey, question: 'town_change', value: Number(value) }) },
      { text: `${copy.spring.anything_else}\n${copy.spring.text_note}`, answer: value => ({ survey, question: 'anything_else', value: String(value) }) }];
    let field: HTMLTextAreaElement | undefined;
    const cleanup = () => { field?.remove(); field = undefined; };
    this.events.once('shutdown', () => {
      cleanup(); clock.resume('survey'); host.input.enabled = previousInput;
      if (host.input.keyboard) { host.input.keyboard.enabled = previousKeys ?? true; host.input.keyboard.resetKeys(); }
      void queue.flush();
    });
    this.input.keyboard?.on('keydown-ESC', () => this.scene.stop());
    let index = 0;
    const draw = () => {
      cleanup(); this.children.removeAll(true);
      if (index >= questions.length || !queue.enabled) { this.scene.stop(); return; }
      const q = questions[index]!;
      this.add.rectangle(0,0,GAME_WIDTH,GAME_HEIGHT,0xf2e4c7).setOrigin(0).setInteractive();
      const text = (x: number, y: number, s: string, size = 22) => this.add.text(x,y,s,{ fontFamily: FAMILY_BODY, fontSize: `${size}px`, color: '#394a3b', wordWrap: { width: GAME_WIDTH-160 } });
      text(80,50,copy.title,32); text(80,100,copy.intro,18); text(80,160,q.text);
      const button = (y: number, label: string, action: () => void) => text(80,y,label).setInteractive({ useHandCursor: true }).on('pointerup',action);
      const answer = (value: string | number) => { telemetry({ type: 'survey_answer', day: clock.day, answer: q.answer(value) }); index++; draw(); };
      if (q.choices) q.choices.forEach((label,i) => button(270+i*48,label,() => answer(i+1)));
      else {
        field = document.createElement('textarea'); field.maxLength = 1000; field.setAttribute('aria-label',copy.spring.anything_else);
        const rect = this.game.canvas.getBoundingClientRect();
        Object.assign(field.style,{ position:'fixed', zIndex:'20', left:`${rect.left+rect.width*0.07}px`, top:`${rect.top+rect.height*0.4}px`, width:`${rect.width*0.8}px`, height:`${rect.height*0.2}px`, fontSize:'18px' });
        field.addEventListener('keydown', e => { e.stopPropagation(); if(e.key === 'Escape') this.scene.stop(); });
        document.body.appendChild(field);
        button(500,'Send this note',() => { if (field?.value.trim()) answer(field.value.trim()); else { index++; draw(); } });
      }
      button(570,'Skip this question',() => { index++; draw(); });
      button(630,'Back to the town · Skip the rest',() => this.scene.stop());
    };
    draw();
  }
}
