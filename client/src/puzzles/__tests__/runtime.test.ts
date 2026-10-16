import { describe, expect, it } from 'vitest';
import { baseSkills, emptyEventLog, emptyFriendship, Inventory, SaveGame, migrateSave } from '@monde/shared';
import { createTownState, type TownState } from '../../town/pillars';
import { getFellow, setFellow } from '../../fellow/state';
import { collect } from '../../save/collect';
import { restore } from '../../save/restore';
import { Clock } from '../../sim/clock';
import { dailyWeather } from '../../sim/weather';
import { emptyQuietState } from '../../mind/quietMode';
import { pendingRegard } from '../../mind/events';
import { puzzles } from '../catalog';
import { codes, words } from '../PZ-03';
import { solution } from '../PZ-01';
import { completePuzzle, emptyPuzzles, puzzleSave, storePuzzle, puzzleStepDone, syncPuzzleProjects, puzzleDawn, deliverPuzzleItems, PUZZLES_KEY } from '../runtime';
function registry() {
  const data = new Map<string, unknown>();
  const r={get:(k:string)=>data.get(k),set:(k:string,v:unknown)=>data.set(k,v),remove:(k:string)=>data.delete(k)};
  r.set('monde.town',createTownState()); r.set('monde.friendship',emptyFriendship()); r.set('monde.events',emptyEventLog());
  setFellow(r,{profile:null,look:null,skills:baseSkills()}); return r;
}
const clock = new Clock({day:6,minute:600});
const solve = (r:ReturnType<typeof registry>,id:string,cells:number[])=>completePuzzle(r,clock,id,{...puzzles[id]!.reset(),cells});
describe('puzzle effects and saves',()=>{
  it('rejects fabricated outcomes; solved flags, Wits, Pillars and Regard apply once across reloads',()=>{
    const r=registry(), original=r.get('monde.town') as TownState;
    expect(solve(r,'PZ-06',[0])).toBe(false);expect(puzzleSave(r).rewarded).toEqual([]);
    expect(solve(r,'PZ-06',[1])).toBe(true);
    expect((r.get('monde.town') as TownState).pillars.spirit).toBe(original.pillars.spirit+1);
    expect(getFellow(r)?.skills.wits.xp).toBe(40);
    expect(r.get('monde.story.flags')).toMatchObject({pz06_solved:true});
    const log=r.get('monde.events') as ReturnType<typeof emptyEventLog>;
    expect(log.rejected).toEqual([]);expect(pendingRegard(log,'bertrand')).toBe(5);
    r.set(PUZZLES_KEY,JSON.parse(JSON.stringify(puzzleSave(r))));solve(r,'PZ-06',[1]);
    expect(getFellow(r)?.skills.wits.xp).toBe(40);expect(pendingRegard(r.get('monde.events') as typeof log,'bertrand')).toBe(5);
    // Pending events are added to the mirror by regardFor; never write the same bonus into both.
    expect((r.get('monde.friendship') as ReturnType<typeof emptyFriendship>).regard.bertrand).toBeUndefined();
  });
  it('defers project Pillars until the Project is complete and never grants them twice',()=>{
    const r=registry();solve(r,'PZ-01',solution);expect(puzzleStepDone(r,'fountain')).toBe(true);
    expect((r.get('monde.town') as TownState).pillars.charm).toBe(25);
    r.set('monde.story.flags',{project_fountain_done:true});syncPuzzleProjects(r);syncPuzzleProjects(r);
    expect((r.get('monde.town') as TownState).pillars).toMatchObject({charm:31,spirit:24});
    expect(puzzleSave(r).rewarded.filter(v=>v==='project:fountain')).toHaveLength(1);
  });
  it('retains the map reward when the bag is full and delivers it once when there is room',()=>{
    const r=registry();r.set('monde.inventory',{slots:Array.from({length:24},()=>({item:'bun',count:20}))});
    const c=codes.map(([line,column])=>words.findIndex(w=>w.line===line && w.column===column));
    solve(r,'PZ-03',c);expect(puzzleSave(r).pendingItems).toEqual(['aureliens_map']);
    const bag=Inventory.parse(r.get('monde.inventory'));bag.slots[0]=null;r.set('monde.inventory',bag);
    deliverPuzzleItems(r);deliverPuzzleItems(r);solve(r,'PZ-03',c);
    expect(Inventory.parse(r.get('monde.inventory')).slots.filter(s=>s?.item==='aureliens_map')).toHaveLength(1);
    expect(puzzleSave(r).pendingItems).toEqual([]);
    expect((r.get('monde.riddles') as {pinned:string[]}).pinned).toEqual(['OQ-1','MR-1','WF-1','MB-1','CM-1','SH-1']);
  });
  it('awards clock and footbridge effects, weekly income, and first-market Regard at their actual triggers',()=>{
    const r=registry();solve(r,'PZ-15',[10,30,8,32]);solve(r,'PZ-18',[0,2,2,1,0,1,2]);
    expect(r.get('monde.story.flags')).toMatchObject({clock_running:true,pinion_fitted:true,project_footbridge_done:true});
    expect((r.get('monde.town') as TownState).pillars.charm).toBe(31);
    const later=new Clock({day:13,minute:600});puzzleDawn(r,later);puzzleDawn(r,later);
    expect((r.get('monde.town') as TownState).pillars.spirit).toBe(23);
    solve(r,'PZ-04',[0,1,2,3,4,0,1,2,3,4,0,1,2,3,4]);
    r.set('monde.story.flags',{project_market_hall_done:true});const saturday=new Clock({day:19,minute:600});
    puzzleDawn(r,saturday);puzzleDawn(r,saturday);
    const events=r.get('monde.events') as ReturnType<typeof emptyEventLog>;
    expect(pendingRegard(events,'nell')).toBe(3);expect(pendingRegard(events,'kasimir')).toBe(8);
  });
  it('collects and restores partial boards, undo, hints and reward receipts without a schema bump',()=>{
    const r=registry(),p=puzzles['PZ-02']!,partial={...p.move(p.reset(),3),elapsed:190,hints:1};storePuzzle(r,p.id,partial);
    const save=collect({clock,town:r.get('monde.town') as TownState,player:{zone:'market_row',x:1,y:1,facing:0},weather:{seed:1,override:null,daily:dailyWeather(1,6)},
      story_flags:{},quiet:emptyQuietState(),client_events:emptyEventLog(),player_name:'Fellow',playtime:190,fellow:{profile:null,look:null},skills:baseSkills(),puzzles:puzzleSave(r)},'manual','Puzzle');
    const loaded=restore(JSON.parse(JSON.stringify(save)));expect(loaded.puzzles?.entries[p.id]).toEqual(partial);
    expect(p.undo(p.restore(loaded.puzzles?.entries[p.id])).cells).toEqual(p.reset().cells);
    const {puzzles:_p,...old}=save;expect(migrateSave(old).puzzles).toEqual(emptyPuzzles());expect(save.schema_version).toBe(3);
    expect(SaveGame.parse(save).puzzles).toEqual(puzzleSave(r));
  });
});
