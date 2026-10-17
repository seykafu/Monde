import { describe, expect, it } from 'vitest';
import { acceptFavor, canCompleteFavor, expireFavor, instantiateFavor, type FavorProof, type FavorWorld } from '../favorEngine';
const world: FavorWorld = { day: 2, reachablePlace: p => p === 'old_quarter.house', items: new Set(['bun']), places: new Set(['old_quarter.house']), residents: new Map(['a','b'].map(id => [id,{ home: 'old_quarter.house', reachable: true }])), met: () => false,
  leaving: new Map([['a',{ deadline: 4,factors: { town: 10,friends: 5,purpose: 0,roots: 10 } }]]) };
describe('engine-owned favors',() => {
  for (const [template,target] of [['fetch','bun'],['find','bun'],['deliver','b'],['introduce','b'],['help_chore','a'],['last_chance','a']] as const) it(`completes ${template} only with matching evidence and before expiry`,() => {
    const proposed = instantiateFavor({ template,target,text: 'Could you help?' },template,'a',world)!;
    expect(proposed).not.toBeNull(); expect(proposed.reward.regard).toBe(10);
    const f = acceptFavor(proposed,2,[])!;
    const proof: FavorProof = { kind: f.task.kind,place: f.task.place,resident: template === 'deliver' ? 'b' : 'a',item: f.task.item,nearby: ['b'],minutes: 30,found: true };
    expect(canCompleteFavor({ ...f,found: true },3,proof)).toBe(true);
    expect(canCompleteFavor(proposed,3,proof)).toBe(false);
    expect(canCompleteFavor({ ...f,found: true },f.expires_day+1,proof)).toBe(false);
    expect(expireFavor(f,f.expires_day+1).status).toBe('expired');
    if (template === 'find') expect(canCompleteFavor(f,3,proof)).toBe(false);
    if (template === 'introduce') expect(canCompleteFavor(f,3,{ ...proof,nearby: [] })).toBe(false);
    if (template === 'help_chore') expect(canCompleteFavor(f,3,{ ...proof,minutes: 29 })).toBe(false);
  });
  it('rejects unobtainable items, inaccessible people, known introductions, and a chore elsewhere',() => {
    const make = (template: 'fetch'|'deliver'|'introduce'|'help_chore',target: string,w=world) => instantiateFavor({ template,target,text: 'Please.' },'x','a',w);
    expect(make('fetch','invented_watch')).toBeNull(); expect(make('deliver','ghost')).toBeNull();
    expect(make('introduce','b',{ ...world,met: () => true })).toBeNull();
    expect(make('help_chore','elsewhere')).toBeNull();
    expect(make('deliver','b',{ ...world,residents: new Map([...world.residents,['b',{ home: 'old_quarter.house',reachable: false }]]) })).toBeNull();
  });
  it('caps acceptance and never revives a completed favor',() => {
    const f = instantiateFavor({ template: 'fetch',target: 'bun',text: 'Please.' },'x','a',world)!;
    expect(acceptFavor(f,3,Array.from({ length: 6 },(_,i) => ({ ...f,id:String(i),resident_id:String(i),status:'accepted' as const })))).toBeNull();
    expect(acceptFavor({ ...f,status:'completed' },3,[])).toBeNull();
  });
});

it('uses reachable workplaces and routine stops, and rejects owners and recipients with no accessible place', () => {
  const residents = new Map([['a', { home: 'millbrook.home', workplace: 'old_quarter.work', places: ['old_quarter.square'], reachable: true }], ['b', { home: 'offmap.home', reachable: true }]]);
  const w = { ...world, residents, places: new Set(['millbrook.home', 'offmap.home', 'old_quarter.work', 'old_quarter.square']), reachablePlace: (p: string) => p.startsWith('old_quarter.') };
  for (const template of ['help_chore', 'find', 'last_chance'] as const) {
    const f = instantiateFavor({ template, target: template === 'find' ? 'bun' : 'a', text: 'Help?' }, template, 'a', w);
    expect(f?.task.place).toBe('old_quarter.work');
    expect(instantiateFavor({ template, target: template === 'find' ? 'bun' : 'b', text: 'Help?' }, template, 'b', w)).toBeNull();
  }
  expect(instantiateFavor({ template: 'deliver', target: 'b', text: 'Help?' }, 'delivery', 'a', w)).toBeNull();
  expect(instantiateFavor({ template: 'help_chore', target: 'a', text: 'Help?' }, 'chore', 'a', { ...w, reachablePlace: p => p.endsWith('square') })?.task.place).toBe('old_quarter.square');
});
