// The contract between the main process and the preload (window.mondeDesktop). No Electron imports: the main
// process imports the channel names, the preload restates them under the `Channels` type (a sandboxed preload
// can't require local files), and __typecheck__/bridge.ts checks `saves` against the client's DesktopSaveBridge
// (client/src/save/storage.ts).

export const CHANNELS = {
  savesList: 'monde:saves:list',
  savesRead: 'monde:saves:read',
  savesWrite: 'monde:saves:write',
  savesDelete: 'monde:saves:delete',
  appInfo: 'monde:app:info',
  fullscreenGet: 'monde:fullscreen:get',
  fullscreenToggle: 'monde:fullscreen:toggle'
} as const;
export type Channels = typeof CHANNELS;

/** One save file. `save` is whatever JSON the game wrote; the client migrates and validates it on read. */
export interface SaveFileEntry { slot: string; save: unknown }

/** Exactly the client's DesktopSaveBridge: scoped save operations, never filesystem access. */
export interface DesktopSaves {
  list(): Promise<SaveFileEntry[]>;
  read(slot: string): Promise<unknown | null>;
  write(slot: string, save: unknown): Promise<void>;
  delete(slot: string): Promise<void>;
}

export interface DesktopInfo {
  /** The app's version (desktop/package.json). */
  version: string;
  electron: string;
  chrome: string;
  platform: string;
  arch: string;
  packaged: boolean;
}

/** window.mondeDesktop. */
export interface MondeDesktopApi {
  /** process.platform: 'darwin', 'win32' or 'linux'. */
  platform: string;
  saves: DesktopSaves;
  info(): Promise<DesktopInfo>;
  /**
   * Native fullscreen (F11, or Ctrl+Cmd+F on a Mac, also work). The page's own Fullscreen API is refused on
   * desktop (Esc would leave it, and Esc belongs to the game); Electron leaves that promise pending, so use this.
   */
  fullscreen: {
    get(): Promise<boolean>;
    /** Resolves with the new state. */
    toggle(): Promise<boolean>;
  };
}
