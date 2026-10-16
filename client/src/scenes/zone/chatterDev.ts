/**
 * Dev builds only: start an exchange or a greeting between two residents on demand, to see the bubbles.
 *
 *   window.__chatter.start('nell', 'moss')            an exchange (live if the mind is reachable and the rules allow,
 *   window.__chatter.start('nell', 'moss', 'live')    or forced live / 'authored')
 *   window.__chatter.greet('odile', 'june')           a passing greeting
 *   window.__chatter.state()                          what's on screen; .list() who's on this board; .release()
 *   ?chatter=nell,moss                                start one as the board opens
 *
 * The two are stood side by side a couple of tiles from the player (their routines held) until the exchange ends; E
 * beside them joins it. No Phaser here: the resident layer is the host.
 */
import type { ChatterMode } from './chatterRules';

type Vec = { x: number; y: number };

export interface ChatterDevHost {
  readonly zoneId: string;
  readonly walkability: readonly (readonly boolean[])[];
  player(): Vec | null;
  residents(): { id: string; name: string; x: number | null; y: number | null; place: string | null; spot: string | null; visible: boolean }[];
  stage(id: string, at: Vec | null): void;
  staged(): string[];
  startChatter(a: string, b: string, mode?: ChatterMode): boolean;
  greet(a: string, b: string): boolean;
  readout(): unknown;
}

/** Two open cells side by side near the player (above them first, so the bubbles are in clear view), or null. */
export function meetingCells(walk: readonly (readonly boolean[])[], player: Vec): [Vec, Vec] | null {
  const open = (x: number, y: number) => walk[y]?.[x] === true;
  const px = Math.floor(player.x), py = Math.floor(player.y);
  const offsets: [number, number][] = [];
  for (let r = 2; r <= 5; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) === r) offsets.push([dx, dy]);
  }
  offsets.sort((p, q) => (p[1] < 0 ? 0 : 1) - (q[1] < 0 ? 0 : 1) || Math.hypot(...p) - Math.hypot(...q));
  for (const [dx, dy] of offsets) {
    const x = px + dx, y = py + dy;
    if (open(x, y) && open(x + 1, y) && !(x + 1 === px && y === py)) return [{ x: x + 0.5, y: y + 0.5 }, { x: x + 1.5, y: y + 0.5 }];
  }
  return null;
}

declare global { interface Window { __chatter?: Record<string, unknown> } }

/** Install `window.__chatter` (and act on `?chatter=a,b`). Returns the uninstall. */
export function installChatterDev(host: ChatterDevHost, query: URLSearchParams): () => void {
  if (typeof window === 'undefined') return () => {};
  const stand = (a: string, b: string): boolean => {
    const p = host.player();
    const cells = p && meetingCells(host.walkability, p);
    if (!cells) return false;
    host.stage(a, cells[0]);
    host.stage(b, cells[1]);
    return true;
  };
  const later = (fn: () => void) => window.setTimeout(fn, 450); // let them fade in where they stand first
  const api = {
    start(a: string, b: string, mode?: ChatterMode): boolean {
      if (!stand(a, b)) return false;
      later(() => { if (!host.startChatter(a, b, mode)) console.warn(`[chatter] couldn't start ${a} + ${b}`); });
      return true;
    },
    greet(a: string, b: string): boolean {
      if (!stand(a, b)) return false;
      later(() => { if (!host.greet(a, b)) console.warn(`[chatter] couldn't greet ${a} + ${b}`); });
      return true;
    },
    release(): void { for (const id of host.staged()) host.stage(id, null); },
    state: () => host.readout(),
    list: () => host.residents(),
    zone: host.zoneId,
  };
  window.__chatter = api;
  const pair = query.get('chatter')?.split(',').map(s => s.trim()).filter(Boolean);
  let timer = 0;
  if (pair?.length === 2) timer = window.setTimeout(() => api.start(pair[0]!, pair[1]!), 1500);
  return () => { window.clearTimeout(timer); if (window.__chatter === api) delete window.__chatter; };
}
