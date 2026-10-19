import { afterEach, expect, it, vi } from 'vitest';
import { AmbienceManager } from '../AmbienceManager';
import { setAudioSettings } from '../audioSettings';
const flush = async () => { for (let n = 0; n < 30; n++) await Promise.resolve(); };
function audio() {
  const sources: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; loop: boolean; loopStart?: number; loopEnd?: number }[] = [];
  const gains: { gain: { value: number; setTargetAtTime: ReturnType<typeof vi.fn> } }[] = [];
  const ctx = { currentTime: 0,
    createBufferSource: () => { const source = { start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), connect: vi.fn(), loop: false }; sources.push(source); return source; },
    createGain: () => { const gain = { gain: { value: 0, setTargetAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() }; gains.push(gain); return gain; },
    decodeAudioData: vi.fn().mockResolvedValue({ numberOfChannels: 2, sampleRate: 10, getChannelData: () => new Float32Array([0, 0.1, 0.2, 0]) }) };
  return { ctx: ctx as unknown as AudioContext, sources, gains };
}
afterEach(() => { vi.unstubAllGlobals(); setAudioSettings({ sfx: 1 }); });
it('silently caches missing HTML fallback files without creating voices or retrying each tick', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('html', { headers: { 'content-type': 'text/html' } }));
  vi.stubGlobal('fetch', fetcher);
  const { ctx, sources } = audio(), manager = new AmbienceManager(ctx, {} as GainNode);
  manager.mix({ surf: 0.2 }); await flush();
  for (let n = 0; n < 20; n++) manager.mix({ surf: 0.2 });
  await flush();
  expect(fetcher).toHaveBeenCalledTimes(2); expect(sources).toHaveLength(0);
  manager.dispose();
});
it('loops available files, crossfades gains, follows SFX settings, and releases nodes on disposal', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/mpeg' } }))));
  const { ctx, sources, gains } = audio(), manager = new AmbienceManager(ctx, {} as GainNode);
  manager.mix({ surf: 0.2 }); await flush();
  expect(sources).toHaveLength(1); expect(sources[0]!.loop).toBe(true);
  expect(sources[0]!.loopStart).toBe(0.1); expect(sources[0]!.loopEnd).toBe(0.3);
  expect(sources[0]!.start).toHaveBeenCalledWith(0, 0.1);
  expect(gains[0]!.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.2, 0, 1);
  gains[0]!.gain.value = 0.2;
  setAudioSettings({ sfx: 0.5 });
  expect(gains[0]!.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.1, 0, 1);
  manager.mix({ market: 0.1 }); await flush();
  expect(gains[0]!.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, 1);
  expect(sources).toHaveLength(2);
  Object.assign(ctx, { currentTime: 9 });
  manager.mix({ market: 0.1 });
  expect(sources[0]!.stop).toHaveBeenCalledOnce();
  manager.dispose();
  for (const source of sources) { expect(source.stop).toHaveBeenCalledOnce(); expect(source.disconnect).toHaveBeenCalledOnce(); }
});
it('never starts a stale load after a district change or disposal', async () => {
  let resolve!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(r => { resolve = r; })));
  const { ctx, sources } = audio(), manager = new AmbienceManager(ctx, {} as GainNode);
  manager.mix({ surf: 0.2 }); manager.mix({}); manager.dispose();
  resolve(new Response(null, { status: 404 })); await flush();
  expect(sources).toHaveLength(0);
});
