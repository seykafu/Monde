// Is the town's mind reachable, and does the player know (GDD §9.14 Quiet Mode)? Pure: no Phaser, no DOM.
//
// Quiet Mode is a complete game, but it shouldn't be a silent one: when residents speak written lines because there
// is no invite code, the player chose Offline, or the server can't be reached, the HUD shows an Offline dot and the
// dialogue panel a small "offline · written lines" marker. While the server is unreachable the HUD retries gently
// (Reconnect), and the dot itself retries on a click.

/**
 *   online       a world exists and the client isn't cooling off after a failure
 *   connecting   an invite is set but the world hasn't been created yet
 *   unreachable  a network failure or a server error: cooling off, then retried
 *   no_invite    no invite code, or the server refused the one given
 *   offline      the player chose Offline (`?offline`, `--offline`)
 */
export type MindStatus = 'online' | 'connecting' | 'unreachable' | 'no_invite' | 'offline';

export interface MindSnapshot {
  offline: boolean;
  hasSession: boolean;
  hasInvite: boolean;
  inviteRejected: boolean;
  coolingOff: boolean;
}

export function mindStatus(s: MindSnapshot): MindStatus {
  if (s.offline) return 'offline';
  if (s.coolingOff) return 'unreachable';
  if (s.hasSession) return 'online';
  if (!s.hasInvite || s.inviteRejected) return 'no_invite';
  return 'connecting';
}

/** Residents are speaking written lines (Quiet Mode) in this state. */
export const isQuiet = (status: MindStatus): boolean => status === 'unreachable' || status === 'no_invite' || status === 'offline';

/** The HUD's word beside the dot: nothing while online (the green dot says it). */
export function statusLabel(status: MindStatus): string {
  switch (status) {
    case 'online': return '';
    case 'connecting': return 'connecting';
    default: return 'offline';
  }
}

/** A sentence for Settings and the dot's hover: what's going on and what to do. */
export function statusDetail(status: MindStatus): string {
  switch (status) {
    case 'online': return 'Online: residents are speaking for themselves.';
    case 'connecting': return 'Joining the town…';
    case 'unreachable': return "Offline: can't reach the town's mind, so residents speak written lines. Retrying.";
    case 'no_invite': return 'Offline: no invite code, so residents speak written lines. Add one in Settings.';
    case 'offline': return 'Offline by choice: residents speak written lines.';
  }
}

/** The marker on a dialogue panel whose lines are written ones, or null when they're live. */
export const OFFLINE_MARKER = 'offline · written lines';

/**
 * The dialogue panel's marker for a turn. `source` is where the turn came from (the client's own Quiet Mode, or the
 * server); `reason` is set when talk() fell back to Quiet Mode; `serverError` is the code of a server `error` event
 * (the server answers `unavailable` when it has no model at all, which is Quiet Mode by another road).
 */
export function offlineMarker(source: 'server' | 'quiet', reason?: string | null, serverError?: string | null): string | null {
  if (source === 'quiet' && reason) return OFFLINE_MARKER;
  if (source === 'server' && serverError === 'unavailable') return OFFLINE_MARKER;
  return null;
}

/** Invite codes as `--invite=` accepts them (desktop/src/security.ts). */
export const INVITE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const validInvite = (code: string): boolean => INVITE_PATTERN.test(code.trim());

/** "SPRING-1234" → "SP•••••••34": enough to recognise, not enough to copy off a screenshot. */
export function maskInvite(code: string | null): string {
  if (!code) return 'not set';
  if (code.length <= 4) return '•'.repeat(code.length);
  return `${code.slice(0, 2)}${'•'.repeat(code.length - 4)}${code.slice(-2)}`;
}

/**
 * GDD-GAP: §9.14 says Quiet Mode starts on "no connection" but not how it ends. The client cools off for 60 s after a
 * failure (api.ts); the HUD then retries at 15 s, 30 s and every 60 s after that, and resets once it's back.
 */
export const RECONNECT_DELAYS_MS: readonly number[] = [15_000, 30_000, 60_000];

export class Reconnect {
  private attempts = 0;
  private nextAt: number | null = null;

  /** Call every frame with the time and status; true when it's time to try the server again. */
  due(now: number, status: MindStatus): boolean {
    if (status !== 'unreachable') { this.attempts = 0; this.nextAt = null; return false; }
    this.nextAt ??= now + RECONNECT_DELAYS_MS[0]!;
    if (now < this.nextAt) return false;
    this.attempts += 1;
    this.nextAt = now + RECONNECT_DELAYS_MS[Math.min(this.attempts, RECONNECT_DELAYS_MS.length - 1)]!;
    return true;
  }
}
