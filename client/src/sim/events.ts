// A tiny typed event bus (pure: no Phaser). Town-level events that later systems subscribe to, such as
// the dialogue UI (M-05) listening for `talk-requested`.

export interface TalkRequest {
  residentId: string;
  /** The zone the player and resident are in. */
  zone: string;
  day: number;
  minute: number;
}

export interface TownEvents {
  /** The player pressed E beside a resident (W-05). The dialogue UI is a later task (M-05). */
  'talk-requested': TalkRequest;
}

export class TypedEmitter<E extends object> {
  private readonly handlers = new Map<keyof E, Set<(payload: never) => void>>();

  on<K extends keyof E>(type: K, handler: (payload: E[K]) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) { set = new Set(); this.handlers.set(type, set); }
    set.add(handler as (payload: never) => void);
    return () => { set.delete(handler as (payload: never) => void); };
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    for (const handler of this.handlers.get(type) ?? []) (handler as (payload: E[K]) => void)(payload);
  }
}
