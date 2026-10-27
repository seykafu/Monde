import { describe, expect, it } from 'vitest';
import { FetchQueue } from '../fetchQueue';

const item = (key: string) => ({ key });
const keys = (items: { key: string }[]) => items.map(i => i.key);

describe('fetch queue', () => {
  it('takes the most wanted first, then the first asked', () => {
    const q = new FetchQueue<{ key: string }>();
    q.push(item('board:a'), 'idle');
    q.push(item('board:b'), 'idle');
    q.push(item('portrait:pell'), 'soon');
    q.push(item('portrait:ines'), 'now');
    expect(keys(q.take(3))).toEqual(['portrait:ines', 'portrait:pell', 'board:a']);
    expect(keys(q.take(3))).toEqual(['board:b']);
    expect(q.size).toBe(0);
  });

  it('raises a queued item asked for again more urgently, never lowers it', () => {
    const q = new FetchQueue<{ key: string }>();
    q.push(item('a'), 'idle');
    q.push(item('b'), 'soon');
    q.push(item('a'), 'now');
    q.push(item('b'), 'idle');
    expect(keys(q.take(2))).toEqual(['a', 'b']);
  });

  it('holds idle items back when asked, and hands out none for no room', () => {
    const q = new FetchQueue<{ key: string }>();
    q.push(item('board'), 'idle');
    q.push(item('portrait'), 'soon');
    expect(keys(q.take(0))).toEqual([]);
    expect(keys(q.take(5, false))).toEqual(['portrait']);
    expect(q.has('board')).toBe(true);
    expect(keys(q.take(5))).toEqual(['board']);
  });

  it('drops one item, or the whole idle list for a new order', () => {
    const q = new FetchQueue<{ key: string }>();
    for (const k of ['a', 'b', 'c']) q.push(item(k), 'idle');
    q.push(item('p'), 'now');
    expect(q.remove('b')).toBe(true);
    expect(q.remove('b')).toBe(false);
    q.clear('idle');
    expect(keys(q.take(5))).toEqual(['p']);
    q.push(item('c'), 'idle');
    q.push(item('a'), 'idle');
    expect(keys(q.take(5))).toEqual(['c', 'a']);
  });
});
