import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { puzzles } from '../catalog';
import { indices } from '../core';
import { orientations, connected, solution, rotate } from '../PZ-01';
import { codes, lines, words, decode } from '../PZ-03';
import { vendors, awnings, gifts, constraints } from '../PZ-04';
import { suspects } from '../PZ-06';
import { gears } from '../PZ-15';
import { planks } from '../PZ-18';
const exported = JSON.parse(execFileSync('python3', [fileURLToPath(new URL('../../../../tools/verify_puzzles.py', import.meta.url)), '--json'], { encoding: 'utf8' })) as { facts: Record<string, unknown>; failures: string[] };
const facts = exported.facts;
const wins = (id: string, c: number[]) => puzzles[id]!.win({ ...puzzles[id]!.reset(), cells: c });
function permutations(a: number[]): number[][] { return a.length ? a.flatMap((v,i)=>permutations(a.filter((_,j)=>i!==j)).map(p=>[v,...p])) : [[]]; }
function assignments(n: number, radix: number): number[][] { return indices(radix**n).map(mask=>indices(n).map(i=>Math.floor(mask/radix**i)%radix)); }
describe('Spring puzzles match the live Python verifier', () => {
  it('Python assertions still pass',()=>expect(exported.failures).toEqual([]));
  it('PZ-01 has exactly the same connected, leak-free network and rotated start',()=>{
    const found: number[][] = [], c: number[] = [];
    function visit(i: number) {
      if (i===25) { if (connected(c)) found.push([...c]); return; }
      for (const v of orientations(i)) {
        if (i<5 && !!(v&1)!==(i===2)) continue;
        if (i>=20 && (v&4)) continue;
        if (i%5===0 && !!(v&8)!==(i===20)) continue;
        if (i%5===4 && !!(v&2)!==(i===9)) continue;
        if (i>=5 && !!(v&1)!==!!(c[i-5]!&4)) continue;
        if (i%5 && !!(v&8)!==!!(c[i-1]!&2)) continue;
        c[i]=v; visit(i+1);
      }
    }
    visit(0); expect(found).toEqual(facts['PZ-01']); expect(found).toEqual([solution]);
    expect(puzzles['PZ-01']!.reset().cells).toEqual(solution.map(rotate));
  });
  it('PZ-02 has the same unique press set across all 512 possibilities',()=>{
    const p=puzzles['PZ-02']!;
    const found=assignments(9,2).flatMap(bits=>{ const presses=indices(9).filter(i=>bits[i]); return p.win(presses.reduce(p.move,p.reset()))?[presses]:[]; });
    expect(found).toEqual(facts['PZ-02']);
  });
  it('PZ-03 uses the exact page, word coordinates and decoded message',()=>{
    const cells=codes.map(([r,c])=>words.findIndex(w=>w.line===r && w.column===c));
    expect({ lines,codes,message:decode(cells) }).toEqual(facts['PZ-03']); expect(wins('PZ-03',cells)).toBe(true);
    expect(wins('PZ-03',cells.slice(1))).toBe(false);
  });
  it('PZ-04 uniquely satisfies every request',()=>{
    const found: string[][][] = [], perms=permutations(indices(5));
    for (const v of perms.filter(v=>v[0]===0 && v[1]===1)) for (const a of perms) for (const g of perms)
      if (constraints([...v,...a,...g])) found.push([v.map(i=>vendors[i]!),a.map(i=>awnings[i]!),g.map(i=>gifts[i]!)]);
    expect(found).toEqual(facts['PZ-04']); expect(wins('PZ-04',Array<number>(15).fill(0))).toBe(false);
  });
  it('PZ-05 has the same unique route through the prism among all 32 mirror settings',()=>{
    expect(assignments(5,2).filter(c=>wins('PZ-05',c)).map(c=>c.map(v=>v?'\\':'/'))).toEqual(facts['PZ-05']);
  });
  it('PZ-06 identifies the same sole culprit with exactly one fibber',()=>{
    expect(indices(4).filter(i=>wins('PZ-06',[i])).map(i=>suspects[i])).toEqual(facts['PZ-06']);
  });
  it('PZ-13 uniquely lights all six circuits among all 64 breaker settings',()=>{
    expect(assignments(6,2).filter(c=>wins('PZ-13',c)).map(c=>indices(6).filter(i=>c[i]).map(i=>i+1))).toEqual(facts['PZ-13']);
  });
  it('PZ-15 has exactly the same gear train, up to mesh order',()=>{
    const found = new Set<string>();
    for (const a of gears) for (const b of gears) for (const c of gears) for (const d of gears) {
      if (wins('PZ-15',[a,b,c,d])) found.add(JSON.stringify([[a,b],[c,d]].sort((x,y)=>x[0]!-y[0]!)));
    }
    expect([...found].map(s=>JSON.parse(s))).toEqual(facts['PZ-15']);
  });
  it('PZ-18 has the same unique partition, treating equal lengths as interchangeable',()=>{
    const found=new Set(assignments(7,3).filter(c=>wins('PZ-18',c)).map(c=>JSON.stringify(indices(3).map(g=>planks.filter((_,i)=>c[i]===g).sort((a,b)=>a-b)))));
    expect([...found].map(s=>JSON.parse(s))).toEqual(facts['PZ-18']);
  });
});
for (const p of Object.values(puzzles)) describe(p.id,()=>{
  it('preserves partial progress, undo and hint time through serialization',()=>{
    const initial=p.reset(), moved=p.move(initial,p.legalMoves(initial)[0]!);
    expect(moved).not.toEqual(initial); expect(p.undo(moved).cells).toEqual(initial.cells);
    const timed={...moved,elapsed:181,hints:1}; expect(p.restore(p.serialize(timed))).toEqual(timed);
    expect(p.restore('{bad')).toEqual(initial); expect(p.restore({...initial,cells:[NaN]})).toEqual(initial);
    expect(p.move(initial,999)).toBe(initial);
  });
  it('gates authored hints by real play, resident request and Friend Regard',()=>{
    const s=p.reset(); expect(p.hint(s)).toBeNull(); expect(p.hint({...s,elapsed:180})).toBe(p.hints[0]);
    expect(p.hint({...s,hints:1})).toBeNull(); expect(p.hint({...s,hints:1},{askResident:true})).toBe(p.hints[1]);
    expect(p.hint({...s,hints:2},{askResident:true,regard:39})).toBeNull();
    expect(p.hint({...s,hints:2},{askResident:true,regard:40})).toBe(p.hints[2]);
  });
});
