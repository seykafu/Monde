// The preload: window.mondeDesktop for the game (client/src/save/storage.ts reads `saves`). It runs sandboxed
// with context isolation, so the page gets only these functions, each one a single IPC call that the main
// process validates; never ipcRenderer, Node or the filesystem.
import { contextBridge, ipcRenderer } from 'electron';
import type { Channels, MondeDesktopApi } from './ipc';

// A sandboxed preload can't require local files: the names are restated here and the type keeps them in step.
const CH: Channels = {
  savesList: 'monde:saves:list',
  savesRead: 'monde:saves:read',
  savesWrite: 'monde:saves:write',
  savesDelete: 'monde:saves:delete',
  appInfo: 'monde:app:info',
  fullscreenGet: 'monde:fullscreen:get',
  fullscreenToggle: 'monde:fullscreen:toggle'
};

const api: MondeDesktopApi = {
  platform: process.platform,
  saves: {
    list: () => ipcRenderer.invoke(CH.savesList),
    read: slot => ipcRenderer.invoke(CH.savesRead, slot),
    write: (slot, save) => ipcRenderer.invoke(CH.savesWrite, slot, save),
    delete: slot => ipcRenderer.invoke(CH.savesDelete, slot)
  },
  info: () => ipcRenderer.invoke(CH.appInfo),
  fullscreen: {
    get: () => ipcRenderer.invoke(CH.fullscreenGet),
    toggle: () => ipcRenderer.invoke(CH.fullscreenToggle)
  }
};

contextBridge.exposeInMainWorld('mondeDesktop', api);
