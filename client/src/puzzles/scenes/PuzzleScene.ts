import Phaser from 'phaser';
import { FAMILY_BODY, FAMILY_HEADING, RENDER_SCALE } from '../../util/constants';
import { sfxCineChime, installAudioUnlock } from '../../audio/Sfx';
import type { Clock } from '../../sim/clock';
import { getFellow } from '../../fellow/state';
import { regardFor } from '../../scenes/friendship';
import { puzzles } from '../catalog';
import type { Puzzle, PuzzleState } from '../core';
import { completePuzzle, puzzleSave, storePuzzle } from '../runtime';
import { words, decode } from '../PZ-03';
import { vendors, awnings, gifts, requests } from '../PZ-04';
import { grid as lensGrid, mirrors, trace } from '../PZ-05';
import { suspects, statements } from '../PZ-06';
import { wiring, circuits } from '../PZ-13';
import { gears } from '../PZ-15';
import { planks, gaps, sums } from '../PZ-18';
export const PUZZLE_SCENE = 'SpringPuzzle';
export interface PuzzleOpen { id: string; host: string; clock: Clock; done?: (solved: boolean)=>void }
export const companions: Readonly<Record<string,string>> = {'PZ-01':'bertrand','PZ-02':'odile','PZ-03':'margo','PZ-04':'nell','PZ-05':'nell','PZ-06':'bertrand','PZ-13':'augusta','PZ-15':'bertrand','PZ-18':'kasimir'};
const backdrops: Record<string,string> = {'PZ-01':'bg_fountain_square_work','PZ-02':'bg_bakery_interior','PZ-03':'bg_library_reading_room','PZ-04':'bg_market_hall_supper','PZ-13':'bg_town_hall_registry','PZ-15':'bg_clocktower_square'};
export function registerPuzzleScene(host: Phaser.Scene): void { if (!host.game.scene.keys[PUZZLE_SCENE]) host.scene.add(PUZZLE_SCENE,PuzzleScene,false); }
export function openPuzzle(host: Phaser.Scene, clock: Clock, id: string): Promise<boolean> {
  if (!puzzles[id] || host.scene.isActive(PUZZLE_SCENE)) return Promise.resolve(false);
  registerPuzzleScene(host);
  return new Promise(resolve=>{ host.scene.launch(PUZZLE_SCENE,{id,clock,host:host.scene.key,done:resolve} satisfies PuzzleOpen); host.scene.bringToTop(PUZZLE_SCENE); });
}
/** One notebook shell, nine physical boards. Every mouse target is also in the keyboard focus order. */
export class PuzzleScene extends Phaser.Scene {
  private opening!: PuzzleOpen;
  private puzzle!: Puzzle;
  private state!: PuzzleState;
  private page!: Phaser.GameObjects.Container;
  private actions: { text: Phaser.GameObjects.Text; run(): void }[]=[];
  private focus=0;
  private feedback='';
  private beam=false;
  private done=false;
  constructor() { super(PUZZLE_SCENE); }
  init(open: PuzzleOpen): void {
    this.opening=open; this.puzzle=puzzles[open.id]!;
    this.state=this.puzzle.restore(puzzleSave(this.registry).entries[open.id]);
    this.focus=0; this.feedback=''; this.beam=false; this.done=false;
  }
  preload(): void {
    const bg=backdrops[this.opening.id]; if (bg && !this.textures.exists(bg)) this.load.image(bg,`${import.meta.env.BASE_URL}assets/backdrops/${bg}.jpg`);
  }
  create(): void {
    const host=this.scene.get(this.opening.host), input=host.input.enabled, keyboard=host.input.keyboard?.enabled;
    host.input.enabled=false; if (host.input.keyboard) { host.input.keyboard.resetKeys(); host.input.keyboard.enabled=false; }
    this.opening.clock.pause('puzzle');
    const bg=backdrops[this.opening.id];
    if (bg && this.textures.exists(bg)) this.add.image(640,360,bg).setDisplaySize(1280,720);
    this.add.rectangle(640,360,1280,720,0x182c26,0.7).setInteractive();
    this.add.rectangle(640,355,1160,626,0xf3e7c9).setStrokeStyle(3,0xb79b68);
    this.add.rectangle(75,355,12,626,0x7a5641);
    this.page=this.add.container(); this.draw(); installAudioUnlock(this);
    const key=(e: KeyboardEvent) => {
      if (e.repeat) return;
      if (['Tab','ArrowRight','ArrowLeft','ArrowUp','ArrowDown',' '].includes(e.key)) e.preventDefault();
      if (e.key==='Escape') this.scene.stop();
      else if (e.key==='Tab' || e.key.startsWith('Arrow')) {
        const d=e.shiftKey || e.key==='ArrowLeft' || e.key==='ArrowUp' ? -1:1;
        this.focus=(this.focus+d+this.actions.length)%this.actions.length; this.highlight();
      } else if (e.key==='Enter' || e.key===' ') this.actions[this.focus]?.run();
      else if (e.key.toLowerCase()==='u') this.undo();
      else if (e.key.toLowerCase()==='r') this.reset();
      else if (e.key.toLowerCase()==='h') this.hint();
      else if (e.key.toLowerCase()==='c') this.check();
    };
    this.input.keyboard?.on('keydown',key);
    this.events.once('shutdown',()=>{
      this.persist(); this.input.keyboard?.off('keydown',key);
      host.input.enabled=input;
      if (host.input.keyboard) { host.input.keyboard.resetKeys(); host.input.keyboard.enabled=keyboard ?? true; }
      this.opening.clock.resume('puzzle'); this.opening.done?.(this.done || this.state.solved);
    });
  }
  update(_time: number, delta: number): void {
    if (this.state.solved || !this.game.hasFocus) return;
    this.state={...this.state,elapsed:this.state.elapsed+delta/1000}; this.persist();
  }
  private persist(): void { storePuzzle(this.registry,this.puzzle.id,this.state); }
  private text(x:number,y:number,text:string,size=18,width=1050): Phaser.GameObjects.Text {
    const t=this.add.text(x,y,text,{fontFamily:FAMILY_BODY,fontSize:`${size}px`,color:'#3d4637',resolution:RENDER_SCALE,wordWrap:{width},lineSpacing:5}); this.page.add(t); return t;
  }
  private button(x:number,y:number,text:string,run:()=>void,width=150,size=18): void {
    const t=this.text(x,y,text,size,width).setPadding(7,5).setBackgroundColor('#e1d1ab').setInteractive({useHandCursor:true});
    const i=this.actions.length; this.actions.push({text:t,run});
    t.on('pointerover',()=>{this.focus=i;this.highlight();}).on('pointerup',run);
  }
  private highlight(): void { this.actions.forEach((a,i)=>a.text.setBackgroundColor(i===this.focus?'#c5d1b0':'#e1d1ab').setColor(i===this.focus?'#213b30':'#3d4637')); }
  private change(i:number): void { this.state=this.puzzle.move(this.state,i); this.feedback='';this.beam=false;this.persist();this.draw(); }
  private undo(): void { this.state=this.puzzle.undo(this.state);this.feedback='';this.beam=false;this.persist();this.draw(); }
  private reset(): void {
    if (this.state.solved) return;
    this.state={...this.puzzle.reset(),elapsed:this.state.elapsed,hints:this.state.hints,undo:[...this.state.undo,[...this.state.cells]]};
    this.feedback='A fresh start. Your hints are still here.';this.beam=false;this.persist();this.draw();
  }
  private hint(): void {
    const resident=companions[this.puzzle.id]!;
    const hint=this.puzzle.hint(this.state,{askResident:true,regard:regardFor(this.registry,resident),wits:getFellow(this.registry)?.skills.wits.level});
    if (hint) { this.state={...this.state,hints:Math.min(3,this.state.hints+1)};this.feedback=hint; }
    else this.feedback=this.state.hints===0?'Take your time. The first nudge comes after three minutes of play.':`A first-step walkthrough needs Friend Regard (40) with ${resident}.`;
    this.persist();this.draw();
  }
  private check(): void {
    if (this.state.solved) return;
    this.beam=true;
    if (completePuzzle(this.registry,this.opening.clock,this.puzzle.id,this.state)) {
      this.state={...this.state,solved:true}; this.done=true; sfxCineChime();
      this.feedback=this.puzzle.id==='PZ-06'?'“I’m eighty-four, they looked hungry.” Bertrand grins.':this.puzzle.id==='PZ-03'?'Volume VI holds Aurélien’s map. Six lanterns, six trails.':'There. Everything settles into place.';
    } else this.feedback=this.puzzle.id==='PZ-01'?'A small spray of water. Something still leaks. No harm done.':this.puzzle.id==='PZ-05'?'The beam hasn’t reached the sea window through the prism yet.':'Not quite yet. Keep trying, or undo a step.';
    this.persist();this.draw();
  }
  private draw(): void {
    this.page.removeAll(true);this.actions=[];
    this.text(104,65,`${this.puzzle.id}  ·  ${this.puzzle.title}`,30).setFontFamily(FAMILY_HEADING);
    this.text(104,112,this.puzzle.instructions,18,1060);
    this.board();
    const hint=this.feedback || (this.state.hints ? this.puzzle.hints[this.state.hints-1]! : 'No rush. The town’s clock is waiting for you.');
    this.text(104,548,hint,18,1050);
    if (!this.state.solved) {
      this.button(104,605,'Undo [U]',()=>this.undo(),110);
      this.button(230,605,'Reset [R]',()=>this.reset(),110);
      this.button(356,605,this.state.hints===0?'Hint [H]':`Ask ${companions[this.puzzle.id]} [H]`,()=>this.hint(),235);
      this.button(620,605,this.puzzle.id==='PZ-01'?'Open main [C]':this.puzzle.id==='PZ-05'?'Light lamp [C]':'Check [C]',()=>this.check(),185);
    }
    this.button(845,605,this.state.solved?'Lovely. Continue →':'I’ll come back later',()=>this.scene.stop(),290);
    this.text(104,676,'Tab / arrows: select   ·   Enter / Space: use   ·   Esc: leave with progress saved',14).setColor('#fff0ce');
    this.focus=Math.min(this.focus,this.actions.length-1);this.highlight();
  }
  private board(): void {
    const c=this.state.cells, id=this.puzzle.id;
    const cell=(i:number,label:string,cols:number,width=100,x=150,y=210)=>this.button(x+i%cols*width,y+Math.floor(i/cols)*58,label,()=>this.change(i),width-16,20);
    if (id==='PZ-01') {
      const glyph: Record<number,string>={0:'·',3:'└',6:'┌',12:'┐',9:'┘',5:'│',10:'─',11:'┴',7:'├',14:'┬',13:'┤'};
      c.forEach((v,i)=>{const x=180+i%5*60,y=210+Math.floor(i/5)*58;if(v)this.button(x,y,glyph[v]!,()=>this.change(i),45,32);else this.text(x+15,y+10,'·',26);});
      this.text(186,505,'↑ Main enters from west',16);this.text(302,183,'↑ Heron',16);this.text(488,273,'→ Basin',16);
      this.text(730,230,'Iron pipes, brass hand-wheels.\n\nEvery end must meet its neighbour.\nEvery piece belongs to the same network.',20,360);
    } else if (id==='PZ-02') {
      c.forEach((v,i)=>cell(i,v?'■ Shut':'□ Open',3,140,180,240));
      this.text(750,240,'Odile’s oven draws through these nine dampers. A press moves a little plus-shaped patch.',22,330);
    } else if (id==='PZ-03') {
      let x=145;
      words.forEach((w,i)=>{
        if(w.column===1){ x=145;this.text(104,205+(w.line-1)*29,`${w.line}.`,16); }
        const y=205+(w.line-1)*29;
        const t=this.text(x,y,w.text,16,1050);const width=t.width;
        t.setInteractive({useHandCursor:true});const index=this.actions.length;
        this.actions.push({text:t,run:()=>this.change(i)}); t.on('pointerover',()=>{this.focus=index;this.highlight();}).on('pointerup',()=>this.change(i)); x+=width+8;
      });
      this.text(104,510,decode(c).toUpperCase() || 'Your message…',18);
    } else if (id==='PZ-04') {
      for(let i=0;i<5;i++)this.text(110+i*127,192,`Stall ${i+1}`,18);
      c.forEach((v,i)=>this.button(104+i%5*127,228+Math.floor(i/5)*65,(Math.floor(i/5)===0?vendors:Math.floor(i/5)===1?awnings:gifts)[v] ?? ['Vendor?','Awning?','Gift?'][Math.floor(i/5)]!,()=>this.change(i),110,17));
      this.text(780,194,requests.join('\n'),16,385);
    } else if (id==='PZ-05') {
      const t=trace(c);
      [...lensGrid].forEach((v,i)=>{
        const x=170+i%5*63,y=210+Math.floor(i/5)*58,m=mirrors.indexOf(i);
        if(m>=0)this.button(x,y,c[m]?'\\':'/',()=>this.change(m),42,30);
        else this.text(x+13,y+7,v==='#'?'▣':v==='P'?'◆':'·',30);
      });
      if(this.beam){const g=this.add.graphics().lineStyle(3,0xe7a933,0.8);this.page.add(g);g.beginPath();g.moveTo(140,351);for(const i of t.path)g.lineTo(194+i%5*63,235+Math.floor(i/5)*58);if(t.exit!==null){const i=t.exit;g.lineTo(194+i%5*63+[0,63,0,-63][t.direction]!,235+Math.floor(i/5)*58+[-58,0,58,0][t.direction]!);}g.strokePath();}
      this.text(350,182,'↑ Sea window',16);this.text(108,335,'Lamp →',16);
      this.text(745,220,'◆ Prism\n▣ Stone pillar\n\nThe light belongs to the sea.\nSend it through the prism before it leaves.',22,350);
    } else if (id==='PZ-06') {
      statements.forEach((s,i)=>this.text(145,215+i*57,s,22,910));
      suspects.forEach((s,i)=>this.button(145+i*250,468,`${c[0]===i?'●':'○'} ${s}`,()=>this.change(i),220,21));
    } else if (id==='PZ-13') {
      const lamps=circuits(c);lamps.forEach((v,i)=>this.text(150+i*145,210,`${'ABCDEF'[i]}  ${v?'☀':'○'}`,30));
      c.forEach((v,i)=>cell(i,`${i+1}: ${v?'ON':'OFF'}\n${wiring[i]}`,3,250,150,300));
      this.text(950,290,'A · Lane\nB · Square\nC · Clock walk\nD · Market west\nE · Market east\nF · Library steps',17,240);
    } else if (id==='PZ-15') {
      this.text(145,214,`${c[0]??'?'} → ${c[1]??'?'}       ${c[2]??'?'} → ${c[3]??'?'}`,32);
      gears.forEach((v,i)=>this.button(145+i%5*185,305+Math.floor(i/5)*75,`${v}${v===8?' (lantern)':''}${c.includes(v)?' ✓':''}`,()=>this.change(i),165,22));
      if(c.length===4)this.text(145,483,`Tooth sums: ${c[0]!+c[1]!} and ${c[2]!+c[3]!}     Speed ratio: ${c[0]!*c[2]!} / ${c[1]!*c[3]!}`,22);
    } else if (id==='PZ-18') {
      sums(c).forEach((n,i)=>this.text(145+i*320,220,`${gaps[i]} ft gap: ${n} ft laid`,22));
      planks.forEach((v,i)=>cell(i,`${v} ft\n${c[i]===-1?'Pile':`${gaps[c[i]!]} ft gap`}`,4,235,145,315));
    }
  }
}
