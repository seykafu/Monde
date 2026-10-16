/** Registry adapter: rewards are keyed by puzzle, independently of scene replay. */
import { gainXp, emptyRiddles, type SaveGame, type Item } from '@monde/shared';
import type { RegistryLike } from '../fellow/state';
import { ensureFellow, setFellow } from '../fellow/state';
import { emptyEventLog, enqueue } from '../mind/events';
import { addItem } from '../economy/inventory';
import { Inventory } from '@monde/shared';
import { applyPillarDelta, type TownState, type Pillar } from '../town/pillars';
import type { StorySession } from '../story/session';
import type { Clock } from '../sim/clock';
import { puzzles } from './catalog';
import type { PuzzleState } from './core';
export const PUZZLES_KEY = 'monde.puzzles';
export type PuzzleSave = SaveGame['puzzles'];
export const emptyPuzzles = (): PuzzleSave => ({ entries: {}, rewarded: [], pendingItems: [], solvedDays: {}, weekly: {} });
export const puzzleSave = (r: RegistryLike): PuzzleSave => (r.get(PUZZLES_KEY) as PuzzleSave | undefined) ?? emptyPuzzles();
export const storySession = (r: RegistryLike): StorySession | undefined => {
  const held=r.get('monde.story.session') as {clock:Clock;session:StorySession} | undefined;
  return held?.clock === r.get('monde.clock') ? held?.session : undefined;
};
export const puzzleFlags = (r: RegistryLike): ReadonlySet<string> => storySession(r)?.flags.snapshot() ?? new Set(Object.entries((r.get('monde.story.flags') ?? {}) as Record<string, unknown>).filter(([,v])=>v===true).map(([k])=>k));
export function storePuzzle(r: RegistryLike, id: string, state: PuzzleState): void {
  const save=puzzleSave(r); r.set(PUZZLES_KEY,{...save,entries:{...save.entries,[id]:state}});
}
function flag(r: RegistryLike, name: string): void {
  const session=storySession(r);
  if (session) { session.flags.set(name); r.set('monde.story.flags',session.snapshot()); }
  else r.set('monde.story.flags',{...(r.get('monde.story.flags') as object ?? {}),[name]:true});
}
function pillar(r: RegistryLike, key: string, name: Pillar, amount: number): void {
  const town=r.get('monde.town') as TownState | undefined;
  if (town) r.set('monde.town',applyPillarDelta(town,name,amount,'project',key));
}
function regard(r: RegistryLike, clock: Pick<Clock,'day'|'minute'>, key: string, resident: string, delta: number): void {
  const log=(r.get('monde.events') as ReturnType<typeof emptyEventLog> | undefined) ?? emptyEventLog();
  r.set('monde.events',enqueue(log,{kind:'scripted_regard',id:`puzzle:${key}:${resident}`,day:clock.day,minute:Math.floor(clock.minute),resident,scene_id:'puzzles',cue_key:`${key}:${resident}`,delta}).log);

}
// GDD-GAP: §15.1 promises Wits XP but gives no amount. Use 40, the authored world-found Mark award (§14.3).
export const PUZZLE_XP = 40;
// GDD-GAP: map item economy metadata is unauthored; a unique, valueless quest item.
export const MAP_ITEM: Item = {id:'aureliens_map',name:'Aurélien’s map',description:'Six lanterns mark the first plaque of each trail.',tags:['quest','map'],stack:1,stamina:0,price:0};
export function deliverPuzzleItems(r: RegistryLike): void {
  const save=puzzleSave(r); let bag=Inventory.parse(r.get('monde.inventory') ?? {});
  const pending=save.pendingItems.filter(id=>{
    if (id!==MAP_ITEM.id) return true;
    const next=addItem(bag,MAP_ITEM); if (!next) return true; bag=next; return false;
  });
  r.set('monde.inventory',bag); r.set(PUZZLES_KEY,{...save,pendingItems:pending});
}
/** A solved board is checked again here; UI and dev hooks cannot claim an arbitrary outcome. */
export function completePuzzle(r: RegistryLike, clock: Pick<Clock,'day'|'minute'>, id: string, state: PuzzleState): boolean {
  const p=puzzles[id]; if (!p || !p.win(state)) return false;
  storePuzzle(r,id,{...state,solved:true});
  const save=puzzleSave(r);
  if (save.rewarded.includes(id)) { deliverPuzzleItems(r); return true; }
  const next={...save,rewarded:[...save.rewarded,id],solvedDays:{...save.solvedDays,[id]:clock.day}};
  r.set(PUZZLES_KEY,next);
  flag(r,`${id.replace('-','').toLowerCase()}_solved`);
  const cleared=id==='PZ-01'?['pz01_deferred']:id==='PZ-03'?['pz03_deferred']:id==='PZ-15'?['pz15_pending','clock_pending_pinion']:[];
  for(const name of cleared) {
    const session=storySession(r);
    if(session){session.flags.unset(name);r.set('monde.story.flags',session.snapshot());}
    else {const flags={...(r.get('monde.story.flags') as Record<string,unknown> ?? {})};delete flags[name];r.set('monde.story.flags',flags);}
  }
  const fellow=ensureFellow(r); setFellow(r,{...fellow,skills:gainXp(fellow.skills,'wits',PUZZLE_XP)});
  switch(id) {
    case 'PZ-02': flag(r,'bakery_ovens_fixed'); regard(r,clock,id,'odile',5); break;
    case 'PZ-03': {
      regard(r,clock,id,'margo',5);
      const marks=(r.get('monde.riddles') as SaveGame['riddles'] | undefined) ?? emptyRiddles();
      r.set('monde.riddles',{...marks,pinned:[...new Set([...marks.pinned,'OQ-1','MR-1','WF-1','MB-1','CM-1','SH-1'])]});
      r.set(PUZZLES_KEY,{...puzzleSave(r),pendingItems:[...puzzleSave(r).pendingItems,MAP_ITEM.id]}); break;
    }
    case 'PZ-06': pillar(r,id,'spirit',1); regard(r,clock,id,'bertrand',5); break;
    case 'PZ-15': flag(r,'clock_running'); flag(r,'pinion_fitted'); pillar(r,id,'charm',5); regard(r,clock,id,'bertrand',15); break;
    case 'PZ-18': flag(r,'project_footbridge_done'); pillar(r,id,'charm',1); regard(r,clock,id,'kasimir',5); break;
  }
  deliverPuzzleItems(r); return true;
}
/** The Projects (client/src/projects) read these durable steps; solving a board never completes funds, materials or hours. */
export const PROJECT_PUZZLES: Readonly<Record<string,string>> = {fountain:'PZ-01',bakery_ovens:'PZ-02',market_hall:'PZ-04',lighthouse:'PZ-05',streetlights:'PZ-13'};
export const puzzleStepDone = (r: RegistryLike, project: string) => !!puzzleSave(r).entries[PROJECT_PUZZLES[project] ?? '']?.solved;
/** Weekly puzzle effects and the first Saturday's market Regard. Call after the town's dawn pass. */
export function puzzleDawn(r: RegistryLike, clock: Pick<Clock,'day'|'minute'|'time'>): void {
  const save=puzzleSave(r), flags=puzzleFlags(r);
  for (const [id,name] of [['PZ-02','prosperity'],['PZ-15','spirit']] as const) {
    const solved=save.solvedDays[id]; if (!solved || id==='PZ-02' && flags.has('bakery_closed')) continue;
    const last=save.weekly[id] ?? solved;
    if (clock.day-last>=7) { pillar(r,id,name,Math.floor((clock.day-last)/7)); save.weekly[id]=last+7*Math.floor((clock.day-last)/7); }
  }
  if (save.entries['PZ-04']?.solved && flags.has('project_market_hall_done') && clock.time.weekday==='Sat' && !save.rewarded.includes('first_market')) {
    for (const resident of ['nell','kasimir','june','odile','teo']) regard(r,clock,'first_market',resident,3);
    save.rewarded.push('first_market');
  }
  r.set(PUZZLES_KEY,save); deliverPuzzleItems(r);
}

/**
 * The completion Pillars belong to the Projects (G-03: client/src/projects applies content/projects.yaml's `complete`
 * when a Project opens, and only once its funds, materials, hours and this puzzle step are all in). Saves from before
 * G-03 recorded any bump they gave here as `project:<id>` in `rewarded`; the Projects runtime reads that receipt.
 */
export const legacyProjectReward = (r: RegistryLike, project: string): boolean => puzzleSave(r).rewarded.includes(`project:${project}`);
