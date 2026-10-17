import type Phaser from 'phaser';
import { FAMILY_BODY, RENDER_SCALE } from '../util/constants';
import type { Clock } from '../sim/clock';
import { submitMark, marks } from '../scenes/riddles';
import { puzzles } from './catalog';
import { openPuzzle } from './scenes/PuzzleScene';
import { deliverPuzzleItems, puzzleDawn, puzzleFlags, puzzleSave } from './runtime';
/**
 * Where each Spring puzzle is played (its place prompt), from which day, and the flags it waits for. The three a scene
 * opens (§15: PZ-03 in S02, PZ-01 in S04, PZ-15 in S07a) are first played in their scene; their place prompt is the
 * re-entry for a board left unsolved there (`pz03_deferred`, `pz01_deferred`, `pz15_pending`) or, for PZ-15, the later
 * fitting after S07b's borrowed chime (`clock_pending_pinion`). Before the scene the prompt would solve it early, and
 * the clocktower would open (and the Lantern say so) days before Bertrand's chime.
 */
export const PUZZLE_SITES: Readonly<Record<string,{id:string;day:number;requires?:readonly string[]}>> = {
  'old_quarter.fountain_square':{id:'PZ-01',day:5,requires:['s04_done']},
  'market_row.bakery':{id:'PZ-02',day:4},
  'old_quarter.library':{id:'PZ-03',day:2,requires:['s02_done']},
  'market_row.market_hall':{id:'PZ-04',day:12},
  'wharf.lighthouse':{id:'PZ-05',day:16},
  'commons.duck_pond':{id:'PZ-06',day:6},
  'old_quarter.town_hall':{id:'PZ-13',day:8},
  'old_quarter.clocktower':{id:'PZ-15',day:1,requires:['pinion_found','s07_done']},
  'commons.footbridge':{id:'PZ-18',day:15}
};
/** The puzzle a place offers now, if any (its day and flags; unsolved). Pure. */
export function puzzleAt(place: string, day: number, flags: ReadonlySet<string>, solved: (id: string) => boolean): string | null {
  const site=PUZZLE_SITES[place];
  if(!site || day<site.day || (site.requires ?? []).some(f=>!flags.has(f)) || solved(site.id))return null;
  return site.id;
}
interface Interaction {label:string;run():void}
export function puzzleInteraction(scene: Phaser.Scene, clock: Clock, place: string, alternative?: Interaction | null): {label:string;run():void} | null {
  const id=puzzleAt(place,clock.day,puzzleFlags(scene.registry),p=>!!puzzleSave(scene.registry).entries[p]?.solved);
  const site=id ? PUZZLE_SITES[place] : undefined; if(!site)return null;
  const title=puzzles[site.id]!.title;
  return {label:alternative ? `${title} / ${alternative.label}` : title,run:()=>{
    if(clock.paused)return;
    if(!alternative){void openPuzzle(scene,clock,site.id);return;}
    clock.pause('puzzle-choice');scene.input.keyboard?.resetKeys();
    const objects: Phaser.GameObjects.GameObject[]=[];
    let closed=false;
    const finish=(action?:()=>void)=>{
      if(closed)return;closed=true;
      scene.input.keyboard?.off('keydown',key);scene.events.off('shutdown',shutdown);
      objects.forEach(o=>o.destroy());clock.resume('puzzle-choice');action?.();
    };
    const key=(e:KeyboardEvent)=>{
      if(e.repeat)return;
      if(e.key==='1')finish(()=>{void openPuzzle(scene,clock,site.id);});
      else if(e.key==='2')finish(alternative.run);
      else if(e.key==='Escape')finish();
    };
    const shutdown=()=>finish();
    const button=(y:number,label:string,run:()=>void)=>{
      const t=scene.add.text(285,y,label,{fontFamily:FAMILY_BODY,fontSize:'22px',color:'#3d4637',backgroundColor:'#f3e7c9',padding:{x:22,y:16},wordWrap:{width:680},resolution:RENDER_SCALE})
        .setInteractive({useHandCursor:true}).on('pointerup',run).setDepth(10000);
      objects.push(t);scene.cameras.main.ignore(t);
    };
    button(240,`1 · ${title}`,()=>finish(()=>{void openPuzzle(scene,clock,site.id);}));
    button(320,`2 · ${alternative.label}`,()=>finish(alternative.run));
    button(420,'Esc · Another time',()=>finish());
    scene.input.keyboard?.on('keydown',key);scene.events.once('shutdown',shutdown);
  }};
}
let devPending = typeof window==='undefined'?null:new URLSearchParams(window.location.search).get('puzzle')?.toUpperCase();
export function attachPuzzles(scene: Phaser.Scene, clock: Clock): void {
  deliverPuzzleItems(scene.registry);
  const off=clock.onDawn(()=>puzzleDawn(scene.registry,clock));scene.events.once('shutdown',off);
  if(devPending){const id=devPending;devPending=null;scene.time.delayedCall(0,()=>{if(puzzles[id])void openPuzzle(scene,clock,id);});}
  let syncing=false;
  const projects=()=>{
    if(syncing)return;
    syncing=true;
    try {
      if(puzzleFlags(scene.registry).has('project_lighthouse_done') && puzzleSave(scene.registry).entries['PZ-05']?.solved
        && marks(scene.registry).entries['WF-4']?.status==='found')submitMark(scene.registry,clock,'WF-4','lighthouse');
    } finally { syncing=false; }
  };
  scene.registry.events.on('changedata-monde.story.flags',projects);
  scene.events.once('shutdown',()=>scene.registry.events.off('changedata-monde.story.flags',projects));
  projects();
}
