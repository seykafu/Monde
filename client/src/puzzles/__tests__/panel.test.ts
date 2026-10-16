import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { Clock } from '../../sim/clock';
import { PuzzleScene } from '../scenes/PuzzleScene';
import { puzzles } from '../catalog';
import { puzzleSave } from '../runtime';
import { createTownState } from '../../town/pillars';
vi.mock('phaser',()=>({default:{Scene:class {}}}));
vi.mock('../../scenes/friendship',()=>({regardFor:()=>40}));
vi.mock('../../audio/Sfx',()=>({sfxCineChime:vi.fn(),installAudioUnlock:vi.fn()}));
function panel(id:string) {
  const data=new Map<string,unknown>(), events=new EventEmitter(), keyboard=new EventEmitter();
  const registry={get:(k:string)=>data.get(k),set:(k:string,v:unknown)=>data.set(k,v),remove:(k:string)=>data.delete(k)};
  registry.set('monde.town',createTownState());
  const nodes: {text:string;x:number;y:number;width:number;height:number}[]=[];
  // A fluent display stub keeps lifecycle tests independent of DOM/canvas and the other agent's zones.
  const display=(x=0,y=0,text='')=>{
    const e=new EventEmitter();
    const raw={x,y,text,width:text.length*8,height:24,on:e.on.bind(e),emit:e.emit.bind(e)};
    nodes.push(raw);
    const obj: object=new Proxy(raw,{get:(target,key)=> key in target ? Reflect.get(target,key) : (..._args:unknown[])=>obj});
    return obj;
  };
  const host={input:{enabled:true,keyboard:{enabled:true,resetKeys:vi.fn()}}};
  const clock=new Clock({day:6,minute:600}),done=vi.fn();
  const scene=new PuzzleScene();
  Object.assign(scene,{registry,events,input:{keyboard},game:{hasFocus:true},textures:{exists:()=>false},
    add:{text:display,rectangle:()=>display(),container:()=>display(),graphics:()=>display()},
    scene:{get:()=>host,stop:()=>events.emit('shutdown')}});
  scene.init({id,host:'Zone',clock,done});scene.create();
  const press=(key:string)=>keyboard.emit('keydown',{key,repeat:false,preventDefault:()=>undefined});
  return {scene,clock,host,registry,done,press,nodes};
}
for(const id of Object.keys(puzzles))it(`${id}: keyboard use, undo, leave and reopen preserve the board and release only the puzzle clock hold`,()=>{
  const h=panel(id), initial=puzzles[id]!.reset().cells;
  expect(h.clock.paused).toBe(true);expect(h.host.input.enabled).toBe(false);
  h.press('Enter');expect(puzzleSave(h.registry).entries[id]?.cells).not.toEqual(initial);
  h.press('u');expect(puzzleSave(h.registry).entries[id]?.cells).toEqual(initial);
  h.press('Enter');h.scene.update(1000,1000);
  h.clock.pause('story');h.press('Escape');
  expect(h.done).toHaveBeenCalledWith(false);expect(h.host.input.enabled).toBe(true);
  expect(h.clock.paused).toBe(true);h.clock.resume('story');expect(h.clock.paused).toBe(false);
  expect(puzzleSave(h.registry).entries[id]?.elapsed).toBe(1);
  expect(puzzles[id]!.restore(puzzleSave(h.registry).entries[id]).cells).not.toEqual(initial);
});
it('a real solved board returns true; a wrong answer cannot choose success',()=>{
  const h=panel('PZ-06');h.press('c');expect(h.done).not.toHaveBeenCalled();
  h.press('ArrowRight');h.press('Enter');h.press('c');h.press('Escape');
  expect(h.done).toHaveBeenCalledWith(true);expect(puzzleSave(h.registry).entries['PZ-06']?.solved).toBe(true);
});
