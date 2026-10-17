import { loadAccessibility } from '../accessibility/preferences';
import { ChatReply, type ChatBody, type ReportBody } from '@monde/shared';
// monde-mind client (GDD §9.10, §9.14, §19.4; MVP M-05). No Phaser; the network and storage are injected so
// the bootstrap and the stream run under vitest with fakes.
//
// Session bootstrap: the first run makes a device id (a UUID) and keeps it. With an invite code (`?invite=`,
// remembered in localStorage) the client creates a world on the server and keeps {device_id, world_id, token}.
// No invite, `?offline`, or an unreachable server: the game runs in Quiet Mode and never calls the server.
// Every storage access is wrapped: private mode or blocked storage just means nothing is remembered.
//
// talk() POSTs and reads the text/event-stream answer with fetch + a stream reader (EventSource can't POST).
// Any failure (network, HTTP error, a stream that ends without its `turn`, a stall) becomes a Quiet Mode turn
// from the caller's `fallback`, so a conversation never dead-ends.
import { readSse } from './sse';
import { parseTalkEvent } from './talkStream';
import { PrewarmGate, type PrewarmTier } from './prewarm';
import { parseDawnPackage, type DawnPackage, type NightRequest } from './dawn';
import { EventIngestionResult, PlayerProfile as PlayerProfileSchema, type ClientEvent } from '@monde/shared';
import type { PostOutcome } from './events';
import type { LineDelta, PlayerProfile, TalkRequest, TalkTurn } from './types';
import { mindStatus, type MindStatus } from './connection';

export const DEFAULT_MIND_URL = 'https://monde-mind-staging.fly.dev';
export const STORAGE_KEYS = {
  device: 'monde.mind.device',
  session: 'monde.mind.session',
  invite: 'monde.mind.invite',
  player: 'monde.player',
  /** "1" once the server has the stored profile (or refused it); anything else means send it on the next connect. */
  playerSynced: 'monde.player.synced'
} as const;

/**
 * GDD-GAP: §9.10 bounds the model (thinking at 2.5 s, fallback by 6 s, both on the server) but not the
 * network around it. The client gives the response headers 8 s (6 s plus slack for the trip), allows 10 s of
 * silence between events (the server can be quiet for up to 6 s per attempt), and caps a turn at 30 s (two
 * attempts of 12 s plus persistence).
 */
export const TALK_TIMEOUTS = { headersMs: 8000, idleMs: 10000, totalMs: 30000 } as const;
/** GDD-GAP: creating a world or patching the player gets the same 8 s as a talk's headers. */
export const REQUEST_TIMEOUT_MS = 8000;
/**
 * GDD-GAP: §9.14 starts Quiet Mode on "no connection" or an error rate over 20% for 60 s. The client has one
 * player's view, so a network failure or a stall puts it in Quiet Mode for 60 s before it tries again.
 */
export const OFFLINE_COOLDOWN_MS = 60_000;
/** Before the Fellowship application (S01) is filled in, residents call the player "Fellow" (server player.ts). */
export const DEFAULT_PLAYER_NAME = 'Fellow';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface Session {
  device_id: string;
  world_id: string;
  token: string;
  branch_id?: string;
  /** The server the world lives on: a different VITE_MIND_URL starts a new world. */
  base_url: string;
}

export interface MindOptions {
  baseUrl: string;
  /** From `?invite=`; falls back to the remembered one. */
  inviteCode?: string | null;
  /** A build's own invite (VITE_MIND_INVITE, personal test builds only): used when none is given or remembered. */
  defaultInvite?: string | null;
  /** The player chose Offline (`?offline`): never call the server. */
  offline?: boolean;
  storage: StorageLike | null;
  fetch: typeof fetch;
  randomUUID: () => string;
  now?: () => number;
  log?: (level: 'info' | 'warn', message: string, detail?: unknown) => void;
}

export interface TalkHandlers {
  /** Abort to abandon the turn (the conversation closed): talk() then resolves null. */
  signal?: AbortSignal;
  onLineDelta?: (delta: LineDelta) => void;
  onThinking?: (text: string) => void;
  onError?: (error: { code: string; message: string }) => void;
  /** A Quiet Mode turn, used whenever the server can't supply one. */
  fallback: () => TalkTurn;
}

/** The night's answer as the client uses it. */
export interface NightPosted {
  status: number;
  /** The server's ingestion of the night's `client_events` (absent when none were sent or the answer had none). */
  ingestion?: EventIngestionResult;
}

export interface TalkResult {
  turn: TalkTurn;
  /** 'server': the server's turn (which may itself be an authored fallback); 'quiet': the client's own. */
  source: 'server' | 'quiet';
  /** Why the client used Quiet Mode. */
  reason?: string;
}

/** A RFC 4122 v4 UUID. crypto.randomUUID only exists in secure contexts (not a LAN dev URL), so fall back. */
export function uuid(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (typeof c?.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const isSession = (v: unknown): v is Session => {
  const s = v as Partial<Session> | null;
  return !!s && typeof s === 'object' && typeof s.device_id === 'string' && typeof s.world_id === 'string'
    && typeof s.token === 'string' && typeof s.base_url === 'string';
};

class AbortedByCaller extends Error {}

export class MindClient {
  readonly baseUrl: string;
  readonly deviceId: string;
  readonly prewarmGate = new PrewarmGate();
  private inviteCode: string | null;
  private session: Session | null = null;
  private pending: Promise<Session | null> | null = null;
  private offlineUntil = 0;
  private chosenOffline = false;
  get offline(): boolean { return !!this.opts.offline || this.chosenOffline; }
  private networkGate = new AbortController();
  setOffline(value: boolean): void {
    this.chosenOffline = value;
    if (value) this.networkGate.abort();
    else if (this.networkGate.signal.aborted) this.networkGate = new AbortController();
  }
  private requestFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    if (this.offline) return Promise.reject(new Error('Offline by choice'));
    const signal = init.signal ? AbortSignal.any([init.signal, this.networkGate.signal]) : this.networkGate.signal;
    return this.opts.fetch(input, { ...init, signal });
  }
  private inviteRejected = false;
  private profile: PlayerProfile | null = null;
  private profileSynced = true;
  private syncing: Promise<boolean> | null = null;
  private readonly now: () => number;

  constructor(private readonly opts: MindOptions) {
    this.chosenOffline = loadAccessibility(opts.storage ?? null).offline;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.now = opts.now ?? (() => Date.now());
    this.deviceId = this.read(STORAGE_KEYS.device) ?? opts.randomUUID();
    this.write(STORAGE_KEYS.device, this.deviceId);
    const given = opts.inviteCode?.trim() || null;
    if (given) this.write(STORAGE_KEYS.invite, given);
    this.inviteCode = given ?? this.read(STORAGE_KEYS.invite) ?? (opts.defaultInvite?.trim() || null);
    const stored = this.readJson(STORAGE_KEYS.session);
    if (isSession(stored) && stored.base_url === this.baseUrl && stored.device_id === this.deviceId) this.session = stored;
    const profile = PlayerProfileSchema.safeParse(this.readJson(STORAGE_KEYS.player));
    if (profile.success) {
      this.profile = profile.data;
      this.profileSynced = this.read(STORAGE_KEYS.playerSynced) === '1';
    }
  }

  /** Bounded, fully validated ambient exchange. Caller owns the authored offline fallback. */
  async chat(body: ChatBody, signal?: AbortSignal): Promise<ChatReply | null> {
    if (!this.enabled || this.now() < this.offlineUntil || signal?.aborted) return null;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    // GDD-GAP: two server attempts (12 s) plus transport slack; includes reading the JSON body.
    const timer = setTimeout(abort, 16000);
    try {
      const res = await this.authed('/chat', { method: 'POST', body: JSON.stringify(body), signal: controller.signal });
      if (!res?.ok) return null;
      const parsed = ChatReply.safeParse(await res.json());
      if (!parsed.success || parsed.data.lines.some((l, i) => l.speaker !== (i % 2 ? body.b : body.a))) return null;
      return parsed.data;
    } catch { return null; }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }

  /** The server will be tried for the next turn (a session exists and the client isn't cooling off). */
  get online(): boolean { return !this.offline && this.session !== null && this.now() >= this.offlineUntil; }
  /** Could the client reach a world at all (offline flag, no invite and no session mean never). */
  get enabled(): boolean { return !this.offline && (this.session !== null || (this.inviteCode !== null && !this.inviteRejected)); }
  get worldId(): string | null { return this.session?.world_id ?? null; }
  /** What Quiet Mode lines call the player. */
  get playerName(): string { return this.profile?.name ?? DEFAULT_PLAYER_NAME; }
  /** The stored Fellowship application, if one was signed on this device. */
  get player(): PlayerProfile | null { return this.profile ? { ...this.profile } : null; }
  /** The server has the stored application (or there is none to send). */
  get playerSynced(): boolean { return this.profileSynced; }

  /** Where things stand with the server, for the HUD dot and Settings (mind/connection.ts). */
  private budgetQuiet = false;
  get status(): MindStatus {
    if (this.offline) return 'offline';
    if (this.budgetQuiet) return 'budget';
    return mindStatus({
      offline: !!this.offline, hasSession: this.session !== null, hasInvite: this.inviteCode !== null,
      inviteRejected: this.inviteRejected, coolingOff: this.now() < this.offlineUntil
    });
  }
  /** The invite code in use (from `?invite=`, `--invite=` or Settings), if any. */
  get invite(): string | null { return this.inviteCode; }

  /**
   * Set or clear the invite code (Settings on the title screen), remember it, and try to join at once if there's
   * no world yet. Resolves with the status that leaves. Never rejects.
   */
  async setInvite(code: string | null): Promise<MindStatus> {
    const given = code?.trim() || null;
    if (given) this.write(STORAGE_KEYS.invite, given);
    else this.remove(STORAGE_KEYS.invite);
    this.inviteCode = given;
    this.inviteRejected = false;
    this.offlineUntil = 0;
    if (given && !this.session && !this.offline) {
      await this.ensureWorld();
      if (this.session && !this.profileSynced) void this.syncPlayer();
    }
    return this.status;
  }

  /** Try the server now instead of waiting out the cooldown (the HUD's gentle retry). Never rejects. */
  async reconnect(): Promise<MindStatus> {
    if (this.offline) return this.status;
    this.offlineUntil = 0;
    if (!this.session) {
      await this.ensureWorld();
      return this.status;
    }
    try {
      const res = await this.fetchWithin(`${this.baseUrl}/v1/health`, { method: 'GET' }, REQUEST_TIMEOUT_MS);
      await res.body?.cancel().catch(() => undefined);
      if (!res.ok) this.offlineUntil = this.now() + OFFLINE_COOLDOWN_MS;
      else if (!this.profileSynced) void this.syncPlayer();
    } catch (error) {
      this.wentOffline('reconnect', error);
    }
    return this.status;
  }

  /** The session, creating the world on first run. Null means Quiet Mode. Never rejects. */
  ensureWorld(): Promise<Session | null> {
    if (this.offline) return Promise.resolve(null);
    if (this.session) return Promise.resolve(this.session);
    if (!this.inviteCode || this.inviteRejected || this.now() < this.offlineUntil) return Promise.resolve(null);
    this.pending ??= this.createWorld().finally(() => { this.pending = null; });
    return this.pending;
  }

  /**
   * Save the Fellowship application (§11.1) locally and send it to the server. True if the server took it.
   * Offline (or without a world) it stays marked unsent and goes on the next connect (syncPlayer).
   */
  async setPlayer(profile: PlayerProfile): Promise<boolean> {
    this.profile = { ...profile };
    this.write(STORAGE_KEYS.player, JSON.stringify(this.profile));
    this.markSynced(false);
    return this.syncPlayer();
  }

  /**
   * Send the stored application if the server doesn't have it yet. Never rejects; true once the server has it.
   * A 4xx (a name the server's filter refuses) isn't retried: the local profile stands and the server keeps its own.
   */
  syncPlayer(): Promise<boolean> {
    if (this.profileSynced || !this.profile) return Promise.resolve(this.profileSynced);
    if (this.offline) return Promise.resolve(false);
    this.syncing ??= this.sendPlayer().finally(() => { this.syncing = null; });
    return this.syncing;
  }

  private async sendPlayer(): Promise<boolean> {
    const profile = this.profile;
    if (!profile) return true;
    try {
      const res = await this.authed(`/player`, { method: 'PATCH', body: JSON.stringify(profile) }, REQUEST_TIMEOUT_MS);
      if (!res) return false;
      if (res.ok) { if (this.profile === profile) this.markSynced(true); return true; }
      this.log('warn', `player profile rejected (${res.status})`, await res.text().catch(() => ''));
      if (res.status >= 400 && res.status < 500 && this.profile === profile) this.markSynced(true);
      return false;
    } catch (error) {
      this.wentOffline('player profile', error);
      return false;
    }
  }

  private markSynced(synced: boolean): void {
    this.profileSynced = synced;
    this.write(STORAGE_KEYS.playerSynced, synced ? '1' : '0');
  }

  async closeTalk(resident_id: string, conversation_id: string, day: number, minute: number): Promise<void> {
    if (!this.online) return;
    try { await this.authed('/talk/close', { method: 'POST', body: JSON.stringify({ resident_id, conversation_id, day, minute }) }, REQUEST_TIMEOUT_MS); }
    catch { /* Last successful turn is the server's fallback activity time. */ }
  }

  // TODO W-06: server snapshot/restore endpoints and Tigris persistence are a separate task.
  async createSnapshot(day: number, minute: number, label: string): Promise<{
    world_id: string | null; branch_id: string | null; snapshot_id: string | null;
  }> {
    const link = { world_id: this.worldId, branch_id: this.session?.branch_id ?? null, snapshot_id: null as string | null };
    if (!this.online) return link;
    try {
      const res = await this.authed('/snapshots', { method: 'POST', body: JSON.stringify({ day, minute, label }) }, REQUEST_TIMEOUT_MS);
      if (!res?.ok) return link; // 404 during rollout is expected; never prevents a local save.
      const body = await res.json() as { snapshot_id?: unknown; branch_id?: unknown };
      if (typeof body.snapshot_id === 'string') link.snapshot_id = body.snapshot_id;
      if (typeof body.branch_id === 'string') link.branch_id = body.branch_id;
    } catch { /* Offline: local engine state remains playable. */ }
    return link;
  }

  async restoreSnapshot(link: { world_id: string | null; snapshot_id: string | null }): Promise<boolean> {
    if (this.offline || !this.session || !link.world_id || !link.snapshot_id) return false;
    try {
      const res = await this.fetchWithin(`${this.baseUrl}/v1/worlds/${encodeURIComponent(link.world_id)}/snapshots/${encodeURIComponent(link.snapshot_id)}/restore`, {
        method: 'POST', headers: { authorization: `Bearer ${this.session.token}`, 'content-type': 'application/json' }, body: '{}'
      }, REQUEST_TIMEOUT_MS);
      if (!res.ok) return false;
      const body = await res.json() as { world_id?: unknown; token?: unknown; branch_id?: unknown };
      if (typeof body.world_id !== 'string' || typeof body.token !== 'string' || typeof body.branch_id !== 'string') return false;
      this.session = { ...this.session, world_id: body.world_id, token: body.token, branch_id: body.branch_id };
      this.offlineUntil = 0;
      this.write(STORAGE_KEYS.session, JSON.stringify(this.session));
      return true;
    } catch { return false; }
  }

  /** Warm the resident's prompt cache (§9.10 step 1). Fire and forget: never rejects. */
  async prewarm(residentId: string, day?: number): Promise<void> {
    try {
      const res = await this.authed('/prewarm', { method: 'POST', body: JSON.stringify(day ? { resident_id: residentId, day } : { resident_id: residentId }) }, REQUEST_TIMEOUT_MS);
      if (res && !res.ok) this.log('warn', `prewarm ${residentId}: HTTP ${res.status}`);
      if (res?.ok) { const data = await res.json() as { reason?: string }; if (data.reason === 'budget') this.budgetQuiet = true; }
      else if (res) await res.body?.cancel().catch(() => undefined);
    } catch (error) {
      this.log('info', `prewarm ${residentId} failed`, error);
    }
  }

  /**
   * The player came within range of a resident: prewarm at most once per resident per 4 in-game hours, and an Ambient
   * resident only while the day's Ambient prewarms last (prewarm.ts).
   */
  prewarmNear(residentId: string, day: number, minute: number, tier: PrewarmTier = 'core'): void {
    if (!this.enabled || this.now() < this.offlineUntil) return;
    if (!this.prewarmGate.allow(residentId, day, minute, tier)) return;
    void this.prewarm(residentId, day);
  }

  /**
   * POST the night (§19.4; mind/dawn.ts). The HTTP status (409: already passed) and, when the body carried
   * `client_events`, the server's ingestion of them; null without a server. Never rejects.
   */
  async postNight(body: NightRequest): Promise<NightPosted | null> {
    if (!this.enabled || this.now() < this.offlineUntil) return null;
    try {
      const res = await this.authed('/night', { method: 'POST', body: JSON.stringify(body) }, REQUEST_TIMEOUT_MS);
      if (!res) return null;
      if (!res.ok && res.status !== 409) {
        this.log('warn', `night ${body.day}: HTTP ${res.status}`, await res.text().catch(() => ''));
        return { status: res.status };
      }
      const answer = await res.json().catch(() => null) as { ingestion?: unknown } | null;
      const ingestion = EventIngestionResult.safeParse(answer?.ingestion);
      return { status: res.status, ...(ingestion.success ? { ingestion: ingestion.data } : {}) };
    } catch (error) {
      this.wentOffline('night', error);
      return null;
    }
  }

  /**
   * POST /v1/worlds/:w/events (M-06; server/src/mind/EVENTS.md): one batch of ClientEvents. `ok` with the ingestion
   * result (accepted / duplicates / rejected ids and the town's Regard), else the HTTP status, or null when there's no
   * server to ask (Quiet Mode, no world, cooling off after a failure, the network). Never rejects.
   */
  async postEvents(events: readonly ClientEvent[]): Promise<PostOutcome> {
    if (!this.enabled || this.now() < this.offlineUntil) return { ok: false, status: null };
    try {
      const res = await this.authed('/events', { method: 'POST', body: JSON.stringify({ events }) }, REQUEST_TIMEOUT_MS);
      if (!res) return { ok: false, status: null };
      if (!res.ok) {
        this.log('warn', `events: HTTP ${res.status}`, await res.text().catch(() => ''));
        return { ok: false, status: res.status };
      }
      const result = EventIngestionResult.safeParse(await res.json().catch(() => null));
      if (!result.success) { this.log('warn', 'events: not an ingestion result'); return { ok: false, status: res.status }; }
      return { ok: true, result: result.data };
    } catch (error) {
      this.wentOffline('events', error);
      return { ok: false, status: null };
    }
  }

  /** GET the dawn package for `day` (§19.4), or null without a server or a usable answer. Never rejects. */
  async getDawn(day: number): Promise<DawnPackage | null> {
    if (!this.enabled || this.now() < this.offlineUntil) return null;
    try {
      const res = await this.authed(`/dawn/${day}`, { method: 'GET' }, REQUEST_TIMEOUT_MS);
      if (!res) return null;
      if (!res.ok) { this.log('warn', `dawn ${day}: HTTP ${res.status}`, await res.text().catch(() => '')); return null; }
      const pkg = parseDawnPackage(await res.json());
      if (!pkg) this.log('warn', `dawn ${day}: not a dawn package`);
      return pkg;
    } catch (error) {
      this.wentOffline('dawn', error);
      return null;
    }
  }

  /**
   * One dialogue turn. Streams deltas and the thinking beat to the handlers and resolves with the final turn:
   * the server's, or the handlers' Quiet Mode fallback when the server can't be used. Resolves null only when
   * the caller aborted.
   */
  async talk(request: TalkRequest, h: TalkHandlers): Promise<TalkResult | null> {
    const quiet = (reason: string): TalkResult => ({ turn: h.fallback(), source: 'quiet', reason });
    if (h.signal?.aborted) return null;
    if (!this.online && !(await this.ensureWorld())) return quiet(this.offline ? 'offline' : 'no world');
    if (this.now() < this.offlineUntil) return quiet('cooling off after a network failure');

    const controller = new AbortController();
    const onAbort = () => controller.abort(new AbortedByCaller());
    h.signal?.addEventListener('abort', onAbort, { once: true });
    let stalled: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = (ms: number, why: string) => {
      clearTimeout(timer);
      timer = setTimeout(() => { stalled = why; controller.abort(); }, ms);
    };
    const total = setTimeout(() => { stalled = 'turn took too long'; controller.abort(); }, TALK_TIMEOUTS.totalMs);
    try {
      arm(TALK_TIMEOUTS.headersMs, 'no response');
      const res = await this.authed('/talk', {
        method: 'POST', body: JSON.stringify(request), signal: controller.signal, headers: { accept: 'text/event-stream' }
      });
      if (!res) return quiet('no world');
      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => '');
        this.log('warn', `talk: HTTP ${res.status}`, detail);
        return quiet(`HTTP ${res.status}`);
      }
      // Assigned in the event callback; the cast keeps TypeScript from narrowing it to null.
      let turn = null as TalkTurn | null;
      arm(TALK_TIMEOUTS.idleMs, 'stream stalled');
      await readSse(res.body, event => {
        arm(TALK_TIMEOUTS.idleMs, 'stream stalled');
        const e = parseTalkEvent(event);
        if (!e) { this.log('warn', `talk: ignored event ${event.event}`, event.data); return; }
        if (e.type === 'line_delta') h.onLineDelta?.(e.data);
        else if (e.type === 'thinking') h.onThinking?.(e.data.text);
        else if (e.type === 'error') { if (e.data.code === 'budget') this.budgetQuiet = true; this.log('info', `talk: server fell back (${e.data.code})`, e.data.message); h.onError?.(e.data); }
        else turn = e.data;
      });
      if (!turn) return quiet('stream ended without a turn');
      // Back in touch: send an application that couldn't go earlier.
      if (!this.profileSynced) void this.syncPlayer();
      if (!turn.fallback) this.budgetQuiet = false;
      return { turn, source: 'server' };
    } catch (error) {
      if (h.signal?.aborted) return null;
      this.wentOffline(stalled ?? 'talk', error);
      return quiet(stalled ?? 'network error');
    } finally {
      clearTimeout(timer);
      clearTimeout(total);
      h.signal?.removeEventListener('abort', onAbort);
    }
  }

  async reportTurn(conversationId: string, turnIndex: number, reason = 'Report line'): Promise<boolean> {
    return this.postReport({ conversation_id: conversationId, turn_index: turnIndex, reason });
  }

  /** §9.13 Report on any generated item (shared/src/reports.ts): a paper story or front, a letter. True when recorded. */
  async report(body: ReportBody): Promise<boolean> {
    return this.postReport(body);
  }

  private async postReport(body: object): Promise<boolean> {
    try {
      const response = await this.authed('/reports', { method: 'POST', body: JSON.stringify(body) }, REQUEST_TIMEOUT_MS);
      return response?.ok ?? false;
    } catch { return false; }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async createWorld(): Promise<Session | null> {
    try {
      const res = await this.fetchWithin(`${this.baseUrl}/v1/worlds`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ device_id: this.deviceId, invite_code: this.inviteCode })
      }, REQUEST_TIMEOUT_MS);
      if (!res.ok) {
        if (res.status === 403 || res.status === 400) this.inviteRejected = true;
        this.log('warn', `world not created (HTTP ${res.status}); playing in Quiet Mode`, await res.text().catch(() => ''));
        if (res.status >= 500) this.offlineUntil = this.now() + OFFLINE_COOLDOWN_MS;
        return null;
      }
      const body = await res.json() as { world_id?: unknown; token?: unknown };
      if (typeof body.world_id !== 'string' || typeof body.token !== 'string') {
        this.log('warn', 'world response without world_id/token; playing in Quiet Mode', body);
        return null;
      }
      this.session = { device_id: this.deviceId, world_id: body.world_id, token: body.token, base_url: this.baseUrl };
      this.write(STORAGE_KEYS.session, JSON.stringify(this.session));
      this.log('info', `world ${body.world_id} created`);
      // A new world doesn't know the player yet: send the application once this call has returned.
      if (this.profile) { this.markSynced(false); queueMicrotask(() => { void this.syncPlayer(); }); }
      return this.session;
    } catch (error) {
      this.wentOffline('create world', error);
      return null;
    }
  }

  /**
   * An authorized request to /v1/worlds/:w<path>. A 401 means the world is gone (a staging reset, a new
   * token secret): forget it, make a new one if the invite allows, and try once more. Null without a world.
   */
  private async authed(path: string, init: RequestInit, timeoutMs?: number): Promise<Response | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const session = await this.ensureWorld();
      if (!session || this.offline) return null;
      const headers = { ...(init.headers as Record<string, string> | undefined), 'content-type': 'application/json', authorization: `Bearer ${session.token}` };
      const url = `${this.baseUrl}/v1/worlds/${session.world_id}${path}`;
      const res = timeoutMs ? await this.fetchWithin(url, { ...init, headers }, timeoutMs) : await this.requestFetch(url, { ...init, headers });
      if (res.status !== 401 || attempt > 0) return res;
      this.log('warn', `world ${session.world_id} was refused (401); starting a new one`);
      this.session = null;
      this.remove(STORAGE_KEYS.session);
    }
    return null;
  }

  private async fetchWithin(url: string, init: RequestInit, ms: number): Promise<Response> {
    if (this.offline) throw new Error('Offline by choice');
    const controller = new AbortController();
    const outer = init.signal;
    const onAbort = () => controller.abort();
    outer?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      return await this.requestFetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onAbort);
    }
  }

  private wentOffline(what: string, error: unknown): void {
    if (error instanceof AbortedByCaller || this.offline) return;
    this.offlineUntil = this.now() + OFFLINE_COOLDOWN_MS;
    this.log('warn', `${what}: server unreachable; Quiet Mode for ${OFFLINE_COOLDOWN_MS / 1000} s`, error instanceof Error ? error.message : error);
  }

  private log(level: 'info' | 'warn', message: string, detail?: unknown): void {
    if (this.opts.log) { this.opts.log(level, message, detail); return; }
    const out = level === 'warn' ? console.warn : console.info;
    if (detail === undefined || detail === '') out(`[mind] ${message}`);
    else out(`[mind] ${message}`, detail);
  }

  private read(key: string): string | null {
    try { return this.opts.storage?.getItem(key) ?? null; } catch { return null; }
  }
  private readJson(key: string): unknown {
    const text = this.read(key);
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
  }
  private write(key: string, value: string): void {
    try { this.opts.storage?.setItem(key, value); } catch { /* private mode, quota, blocked storage */ }
  }
  private remove(key: string): void {
    try { this.opts.storage?.removeItem(key); } catch { /* as above */ }
  }
}

// ── The game's client ───────────────────────────────────────────────────────

/** Where the server is and how to join it, from the build and the page URL. */
export function mindConfig(search = typeof window !== 'undefined' ? window.location.search : ''): Pick<MindOptions, 'baseUrl' | 'inviteCode' | 'defaultInvite' | 'offline'> {
  const query = new URLSearchParams(search);
  const env = (import.meta.env?.VITE_MIND_URL as string | undefined)?.trim();
  // Personal test builds can carry their owner's invite so they're online from the first launch. Never set it
  // for a build that's shared: anyone with the build could join with it.
  const invite = (import.meta.env?.VITE_MIND_INVITE as string | undefined)?.trim();
  return { baseUrl: env || DEFAULT_MIND_URL, inviteCode: query.get('invite'), defaultInvite: invite || null, offline: query.has('offline') };
}

/** localStorage, or null where touching it throws (sandboxed iframes, blocked cookies). */
export function browserStorage(): StorageLike | null {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}

let shared: MindClient | null = null;
/** The one client for the game. */
export function getMind(): MindClient {
  shared ??= new MindClient({ ...mindConfig(), storage: browserStorage(), fetch: (input, init) => fetch(input, init), randomUUID: uuid });
  return shared;
}
