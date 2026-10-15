import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { PORTRAIT_SET, REPLY_CHARS, compileScenes, registryFromContent } from '@monde/shared';
import {
  SPRING_SCENE_ID, aiOpenCues, exchangePaths, fillScripted, parseScriptedLibrary, scriptedKey, scriptedTurn,
  type ScriptedExchange, type ScriptedLibrary
} from '../scripted';
import type { TalkInput } from '../types';

const content = resolve(import.meta.dirname, '../../../..', 'content');
const read = (name: string) => readFileSync(resolve(content, name), 'utf8');
const library = parseScriptedLibrary(parse(read('lines/scripted.yaml')));

const compiled = compileScenes(
  readdirSync(resolve(content, 'scenes')).filter(f => f.endsWith('.scene.md')).sort().map(f => ({ file: `content/scenes/${f}`, source: read(`scenes/${f}`) })),
  registryFromContent({
    flagsYaml: read('flags.yaml'),
    residentYamls: readdirSync(resolve(content, 'residents')).filter(f => f.endsWith('.yaml')).sort().map(f => read(`residents/${f}`)),
    placesYaml: read('places/places.yaml')
  })
);
const springCues = aiOpenCues(compiled.scenes).filter(c => SPRING_SCENE_ID.test(c.scene));

const VARS = { name: 'Margo', player: 'Wren' };
const ctx = (turnIndex: number) => ({ conversationId: 'c1', residentId: 'margo', turnIndex, vars: VARS });
const reply = (id: string, text: string, intent: 'kind' = 'kind'): TalkInput => ({ kind: 'choice', choice_id: id, text, intent });

/** Every text the player sees in an exchange: the resident's lines, reacts and farewell, and the Fellow's replies. */
function texts(ex: ScriptedExchange): { who: 'resident' | 'fellow'; text: string }[] {
  return [
    ...ex.farewell.map(l => ({ who: 'resident' as const, text: l.text })),
    ...Object.values(ex.nodes).flatMap(n => [
      ...n.lines.map(l => ({ who: 'resident' as const, text: l.text })),
      ...n.replies.flatMap(r => [{ who: 'fellow' as const, text: r.text }, ...(r.react ? [{ who: 'resident' as const, text: r.react.text }] : [])])
    ])
  ];
}

describe('the written {ai_open} exchanges', () => {
  it('finds exactly the three Spring cues, and each has its exchange with the cue\'s turn count', () => {
    expect(springCues).toEqual([
      { scene: 's02_marks', resident: 'margo', turns: 4 },
      { scene: 's05_first_arrival', resident: 'arrival', turns: 2 },
      { scene: 's08_option', resident: 'sable', turns: 3 }
    ]);
    for (const cue of springCues) {
      const ex = library.find(cue.scene, cue.resident);
      expect(ex, `${cue.scene} ${cue.resident}`).toBeDefined();
      expect(ex!.turns).toBe(cue.turns);
      expect(ex!.key).toBe(scriptedKey(cue.scene, cue.resident));
    }
  });

  it('has no exchange for a cue that no longer exists', () => {
    const cues = new Set(aiOpenCues(compiled.scenes).map(c => scriptedKey(c.scene, c.resident)));
    for (const ex of library.exchanges) expect(cues.has(ex.key), ex.key).toBe(true);
  });

  it('finds nothing for a cue without one', () => {
    expect(library.find('s13_quarry', 'rook')).toBeUndefined();
    expect(library.find('s02_marks', 'sable')).toBeUndefined();
  });

  describe.each(library.exchanges.map(ex => [ex.key, ex] as const))('%s', (_key, ex) => {
    it('reaches a close down every branch, in exactly its turn count of replies', () => {
      const paths = exchangePaths(ex);
      expect(paths.length).toBeGreaterThan(1);
      for (const path of paths) {
        expect(path.picks).toHaveLength(ex.turns);
        expect(path.nodes).toHaveLength(ex.turns + 1);
        expect(ex.nodes[path.nodes.at(-1)!]!.replies).toHaveLength(0);
      }
      // Every node is on some path, and every goodbye aside, every reply goes on.
      const seen = new Set(paths.flatMap(p => p.nodes));
      expect(Object.keys(ex.nodes).sort()).toEqual([...seen].sort());
    });

    it('plays each branch as dialogue turns, wrapping up only at the close', () => {
      for (const path of exchangePaths(ex)) {
        let at: string | null = null;
        let input: TalkInput = { kind: 'open' };
        path.nodes.forEach((node, turnIndex) => {
          const step = scriptedTurn(ex, at, input, ctx(turnIndex));
          expect(step, `${ex.key} ${node} turn ${turnIndex}`).not.toBeNull();
          const { turn } = step!;
          at = step!.at;
          expect(at).toBe(node);
          expect(turn).toMatchObject({ conversation_id: 'c1', resident_id: 'margo', turn_index: turnIndex, fallback: true });
          expect(turn.lines.length).toBeGreaterThanOrEqual(1);
          expect(turn.lines.length).toBeLessThanOrEqual(3);
          for (const line of turn.lines) {
            expect(PORTRAIT_SET as readonly string[]).toContain(line.expr);
            expect(line.text.trim()).not.toBe('');
          }
          const last = turnIndex === ex.turns;
          expect(turn.wrap_up).toBe(last);
          const replies = turn.choices.filter(c => c.id !== 'leave');
          if (last) expect(turn.choices.map(c => c.id)).toEqual(['leave']);
          else {
            expect(replies.length).toBeGreaterThanOrEqual(2);
            expect(replies.length).toBeLessThanOrEqual(3);
            expect(turn.choices.at(-1)).toMatchObject({ id: 'leave', intent: 'leave' });
            expect(replies.filter(r => r.intent === 'leave').length).toBeLessThanOrEqual(1);
            const chosen = replies[path.picks[turnIndex]!]!;
            input = reply(chosen.id, chosen.text, chosen.intent as 'kind');
          }
        });
      }
    });

    it('says goodbye with the farewell wherever the player leaves, and keeps its place', () => {
      for (const node of Object.values(ex.nodes).filter(n => n.replies.length > 0)) {
        const step = scriptedTurn(ex, node.id, { kind: 'choice', choice_id: 'leave', text: 'Leave', intent: 'leave' }, ctx(node.depth + 1));
        expect(step?.at).toBe(node.id);
        expect(step?.turn.wrap_up).toBe(true);
        expect(step?.turn.choices.map(c => c.id)).toEqual(['leave']);
        expect(step?.turn.lines.map(l => l.text)).toEqual(ex.farewell.map(l => fillScripted(l.text, VARS)));
      }
    });

    it('fills every token and leaves no braces', () => {
      for (const { text } of texts(ex)) expect(fillScripted(text, VARS)).not.toMatch(/[{}]/);
    });

    it('keeps replies short and each reply\'s react within the three-line turn', () => {
      for (const node of Object.values(ex.nodes)) {
        for (const r of node.replies) {
          expect(r.text.length).toBeLessThanOrEqual(REPLY_CHARS);
          if (r.next) expect(Number(!!r.react) + ex.nodes[r.next]!.lines.length).toBeLessThanOrEqual(3);
        }
      }
    });
  });

  describe('the engine', () => {
    const margo = library.find('s02_marks', 'margo')!;
    const opener = scriptedTurn(margo, null, { kind: 'open' }, ctx(0))!;

    it('opens on the start node with numbered replies and Leave', () => {
      expect(opener.at).toBe('ask');
      expect(opener.turn.choices.map(c => c.id)).toEqual(['r1', 'r2', 'r3', 'leave']);
      expect(opener.turn.lines[0]!.text).toMatch(/^\(uncaps a pencil/);
    });

    it('leads a reply\'s next node with its react line', () => {
      const step = scriptedTurn(margo, 'ask', reply('r2', opener.turn.choices[1]!.text), ctx(1))!;
      expect(step.at).toBe('book');
      expect(step.turn.lines[0]!.text).toBe(margo.nodes.ask!.replies[1]!.react!.text);
      expect(step.turn.lines).toHaveLength(1 + margo.nodes.book!.lines.length);
    });

    it('finds a reply by its words when the id is missing', () => {
      const step = scriptedTurn(margo, 'ask', reply('x', margo.nodes.ask!.replies[0]!.text), ctx(1))!;
      expect(step.at).toBe('man');
    });

    it('takes free text down the first reply that goes on, with no react', () => {
      const step = scriptedTurn(margo, 'ask', { kind: 'say', text: 'Do you like cats?' }, ctx(1))!;
      expect(step.at).toBe('man');
      expect(step.turn.lines).toHaveLength(margo.nodes.man!.lines.length);
    });

    it('fills {name} and {player}', () => {
      const bertrand = scriptedTurn(margo, 'claim', reply('r1', ''), ctx(3))!;
      expect(bertrand.turn.choices.find(c => c.intent === 'leave' && c.id !== 'leave')?.text).toBe('I should let you get on. Thanks, Margo.');
      const arrival = library.find('s05_first_arrival', 'arrival')!;
      const close = scriptedTurn(arrival, 'ask', reply('r1', ''), ctx(2))!;
      expect(close.turn.lines.map(l => l.text).join(' ')).toContain('Which way is the house, Wren?');
    });

    it('gives up (so ordinary Quiet Mode takes over) when it has no place to continue from', () => {
      expect(scriptedTurn(margo, null, reply('r1', ''), ctx(1))).toBeNull();
      expect(scriptedTurn(margo, null, { kind: 'say', text: 'Hello' }, ctx(1))).toBeNull();
      expect(scriptedTurn(margo, null, { kind: 'choice', choice_id: 'leave', text: 'Leave', intent: 'leave' }, ctx(1))).toBeNull();
      expect(scriptedTurn(margo, 'ask', { kind: 'open' }, ctx(0))).toBeNull();
      expect(scriptedTurn(margo, 'ask', reply('r9', 'Something else entirely'), ctx(1))).toBeNull();
      expect(scriptedTurn(margo, 'close_talk', { kind: 'say', text: 'One more thing' }, ctx(5))).toBeNull();
    });
  });

  describe('keeps to what each resident knows and how they speak', () => {
    const spoken = (key: string) => texts(library.exchanges.find(e => e.key === key)!).filter(t => t.who === 'resident').map(t => t.text);

    it('Margo calls the Charter the claim or the record, never the legend', () => {
      const lines = spoken('s02_marks.margo').join(' ');
      expect(lines).toMatch(/\bthe claim\b/);
      expect(lines).toMatch(/\bthe record\b/);
      expect(lines).not.toMatch(/legend/i);
    });

    it('Margo never claims proof or a fragment, and says she doesn\'t know the lantern pinion', () => {
      const lines = spoken('s02_marks.margo').join(' ');
      expect(lines).toMatch(/never held a fragment/);
      expect(lines).toMatch(/lantern pinion[^.]*\. I know the phrase/);
      expect(lines).toMatch(/I won't guess/);
    });

    it('Sable says nothing of Greyline, the Tollmen or why Pell signed', () => {
      const lines = spoken('s08_option.sable').join(' ');
      expect(lines).not.toMatch(/greyline|tollmen|brick/i);
      expect(lines).toMatch(/I don't know/);
    });

    it('the newcomer knows nothing of the Clause, the Tollmen or the Charter, and names no trade', () => {
      const all = texts(library.find('s05_first_arrival', 'arrival')!).map(t => t.text).join(' ');
      expect(all).not.toMatch(/option|clause|tollmen|charter|greyline|vane|\{arrival/i);
    });
  });
});

describe('parseScriptedLibrary', () => {
  /** A deliberately loose fixture: each case breaks one rule by editing it, so the shape can't be typed tightly. */
  type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const doc = (mutate: (ex: Loose) => void = () => undefined) => {
    const ex: Loose = {
      scene: 's99_test', resident: 'pell', turns: 1, start: 'a',
      farewell: [{ expr: 'neutral', text: 'Bye.' }],
      nodes: {
        a: {
          lines: [{ expr: 'neutral', text: 'Hello.' }],
          replies: [{ text: 'One.', intent: 'kind', next: 'b' }, { text: 'Two.', intent: 'curious', next: 'b' }]
        },
        b: { lines: [{ expr: 'warm', text: 'The end.' }] }
      }
    };
    mutate(ex);
    return { exchanges: [ex] };
  };
  const rejects = (mutate: (ex: Loose) => void, why: RegExp) => expect(() => parseScriptedLibrary(doc(mutate))).toThrow(why);

  it('accepts a small valid exchange and finds it by scene and resident', () => {
    const lib: ScriptedLibrary = parseScriptedLibrary(doc());
    expect(lib.find('s99_test', 'pell')?.nodes.b).toMatchObject({ depth: 1, replies: [] });
    expect(lib.find('s99_test', 'margo')).toBeUndefined();
  });

  it('rejects a shape that isn\'t the schema', () => {
    expect(() => parseScriptedLibrary(null)).toThrow(/exchanges/);
    rejects(ex => { ex.extra = 1; }, /unknown field extra/);
    rejects(ex => { ex.turns = 0; }, /turns/);
    rejects(ex => { ex.start = 'zzz'; }, /start node zzz doesn't exist/);
    rejects(ex => { delete ex.farewell; }, /farewell needs 1–3 lines/);
    rejects(ex => { ex.nodes.a.extra = 1; }, /node a: unknown field extra/);
  });

  it('rejects lines that break the rules', () => {
    rejects(ex => { ex.nodes.b.lines[0].expr = 'thinking'; }, /expr must be one of/);
    rejects(ex => { ex.nodes.b.lines[0].text = ''; }, /needs text/);
    rejects(ex => { ex.nodes.b.lines[0].text = 'Hello {resident:pell}.'; }, /only \{name\} and \{player\}/);
    rejects(ex => { ex.nodes.b.lines = Array(4).fill({ expr: 'warm', text: 'Again.' }); }, /1–3 lines/);
    rejects(ex => { ex.nodes.b.lines[0].text = Array(60).fill('word').join(' '); }, /over 55 words/);
  });

  it('rejects replies that break the rules', () => {
    rejects(ex => { ex.nodes.a.replies.length = 1; }, /needs 2–3 replies/);
    rejects(ex => { ex.nodes.a.replies[0].text = 'x'.repeat(REPLY_CHARS + 1); }, /over 90 characters/);
    rejects(ex => { ex.nodes.a.replies[0].intent = 'shout'; }, /unknown intent/);
    rejects(ex => { ex.nodes.a.replies[1].text = 'one.'; }, /replies repeat/);
    rejects(ex => { ex.nodes.a.replies[0].next = 'nowhere'; }, /goes to nowhere, which doesn't exist/);
    rejects(ex => { delete ex.nodes.a.replies[0].next; }, /needs a next node/);
    rejects(ex => { ex.nodes.a.replies[0] = { text: 'Bye.', intent: 'leave', next: 'b' }; }, /goodbye ends the exchange/);
    rejects(ex => { ex.nodes.a.replies = [{ text: 'Bye.', intent: 'leave' }, { text: 'Goodbye.', intent: 'leave' }]; }, /at most one reply may say goodbye/);
    rejects(ex => { ex.nodes.a.replies[0].react = { expr: 'warm', text: 'Hm.' }; ex.nodes.b.lines = Array(3).fill({ expr: 'warm', text: 'Again.' }); }, /react plus b's 3 lines/);
  });

  it('rejects a graph that loops, skips a turn, strands a node or closes at the wrong depth', () => {
    rejects(ex => { ex.nodes.b.replies = [{ text: 'Back.', intent: 'kind', next: 'a' }, { text: 'Again.', intent: 'joke', next: 'a' }]; }, /reached at depth/);
    rejects(ex => { ex.nodes.c = { lines: [{ expr: 'warm', text: 'Lost.' }] }; }, /node c: is unreachable/);
    rejects(ex => { ex.turns = 2; }, /node b: is a close at depth 1/);
    rejects(ex => { ex.nodes.b.replies = [{ text: 'On.', intent: 'kind', next: 'c' }, { text: 'Further.', intent: 'joke', next: 'c' }]; ex.nodes.c = { lines: [{ expr: 'warm', text: 'Past it.' }] }; }, /has replies at depth 1/);
  });

  it('rejects a repeated exchange', () => {
    const one = doc().exchanges[0];
    expect(() => parseScriptedLibrary({ exchanges: [one, one] })).toThrow(/duplicate exchange/);
  });
});
