// Compile-time check only (tsconfig.json includes it; the build doesn't): the preload's window.mondeDesktop
// must be what the client expects (client/src/save/storage.ts). If the client's DesktopSaveBridge changes, this
// stops compiling until ipc.ts and preload.ts follow.
import type { DesktopSaveBridge } from '../../../client/src/save/storage';
import type { DesktopSaves, MondeDesktopApi } from '../ipc';

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export const savesMatchClient: Same<DesktopSaves, DesktopSaveBridge> = true;
export const apiFitsWindow = (api: MondeDesktopApi): NonNullable<Window['mondeDesktop']> => api;
