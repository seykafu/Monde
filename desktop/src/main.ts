// Monde's desktop shell (GDD §21.1 D17): the same Phaser game in an Electron window for Mac and Windows.
//
// - The built client is served from app://monde/ (protocol.ts) with a strict CSP (security.ts), not file://.
// - The renderer is sandboxed and context-isolated; the preload exposes window.mondeDesktop (ipc.ts), whose
//   save calls land in SaveStore (saves.ts): JSON files under <userData>/saves/.
// - One window, 1280×720 at first, remembering its size, place and fullscreen (windowState.ts). It can't
//   navigate away from the game; links open in the system browser; new windows, webviews, downloads and
//   permission prompts are refused.
// - `npm run desktop:dev` sets MONDE_DEV_SERVER_URL to the Vite dev server (HMR); packaged apps ignore it.
import { app, BrowserWindow, Menu, ipcMain, protocol, screen, session, shell } from 'electron';
import type { IpcMainInvokeEvent, MenuItemConstructorOptions, WebContents } from 'electron';
import * as path from 'node:path';
import { APP_ENTRY, APP_HOST, APP_SCHEME, BACKGROUND, PRODUCT_NAME, WINDOW, isLoopbackHost, mindOrigin, readBuildConfig } from './config';
import { CHANNELS, type DesktopInfo } from './ipc';
import { createAppHandler } from './protocol';
import { SaveStore } from './saves';
import { buildCsp, entryQuery, externalUrl, isGameUrl } from './security';
import { placeWindow, readWindowState, writeWindowState } from './windowState';

/** The Vite dev server's origin in `desktop:dev` (loopback only); null otherwise and always when packaged. */
const devServer = app.isPackaged ? null : loopbackOrigin(process.env.MONDE_DEV_SERVER_URL);

app.setName(PRODUCT_NAME);
// Development runs keep their own saves and settings, away from an installed copy's.
if (!app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), `${PRODUCT_NAME} (dev)`));
app.enableSandbox();
protocol.registerSchemesAsPrivileged([{
  scheme: APP_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true }
}]);

let mainWindow: BrowserWindow | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  // A game quits with its window, on every platform.
  app.on('window-all-closed', () => app.quit());
  app.on('web-contents-created', (_event, contents) => guard(contents));
  app.whenReady().then(start).catch(error => {
    console.error('[desktop] failed to start', error);
    app.exit(1);
  });
}

async function start(): Promise<void> {
  const config = readBuildConfig(path.join(__dirname, 'build-config.json'));
  if (!config) console.warn('[desktop] dist/build-config.json is missing: the game cannot reach monde-mind (Quiet Mode)');
  const mind = config ? mindOrigin(config.mindUrl) : null;
  const gameRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'game')
    : path.resolve(__dirname, '..', '..', 'client', 'dist');
  protocol.handle(APP_SCHEME, createAppHandler({ root: gameRoot, host: APP_HOST, csp: buildCsp(mind ? [mind] : []) }));
  lockDownSession(mind);

  const saves = new SaveStore(path.join(app.getPath('userData'), 'saves'));
  await saves.cleanup();
  registerIpc(saves);

  app.setAboutPanelOptions({ applicationName: PRODUCT_NAME, applicationVersion: app.getVersion() });
  setMenu();
  mainWindow = createWindow();
}

// ── Security ────────────────────────────────────────────────────────────────

const LOCAL_NETWORK = new Set<string>(['local-network-access', 'local-network', 'loopback-network']);

/** Refuse every permission (camera, notifications, the page's own fullscreen…). A build pointed at a server
 * on this machine may still reach it. */
function lockDownSession(mind: string | null): void {
  const localMind = mind !== null && isLoopbackHost(new URL(mind).hostname);
  const allowed = (permission: string) => localMind && LOCAL_NETWORK.has(permission);
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(allowed(permission)));
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => allowed(permission));
  session.defaultSession.on('will-download', event => event.preventDefault());
}

/** Every web contents stays on the game: no webviews, no new windows, no navigation away; links go to the browser. */
function guard(contents: WebContents): void {
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', event => {
    if (isGameUrl(event.url, devServer)) return;
    event.preventDefault();
    openExternal(event.url);
  });
  contents.on('will-redirect', event => {
    if (!isGameUrl(event.url, devServer)) event.preventDefault();
  });
}

function openExternal(url: string): void {
  const safe = externalUrl(url);
  if (safe) void shell.openExternal(safe).catch(() => undefined);
}

/** IPC is answered only for the game window's top frame, on the game's own origin. */
function fromGame(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  return !!frame && frame.parent === null && !!mainWindow && event.sender === mainWindow.webContents && isGameUrl(frame.url, devServer);
}

// ── IPC (window.mondeDesktop) ─────────────────────────────────────────────

function registerIpc(saves: SaveStore): void {
  const handle = (channel: string, answer: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!fromGame(event)) throw new Error('Refused: not the game window');
      return answer(event, ...args);
    });
  };
  handle(CHANNELS.savesList, () => saves.list());
  handle(CHANNELS.savesRead, (_event, slot) => saves.read(slot));
  handle(CHANNELS.savesWrite, (_event, slot, save) => saves.write(slot, save));
  handle(CHANNELS.savesDelete, (_event, slot) => saves.delete(slot));
  handle(CHANNELS.appInfo, (): DesktopInfo => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged
  }));
  handle(CHANNELS.fullscreenGet, event => BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false);
  handle(CHANNELS.fullscreenToggle, event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win ? toggleFullscreen(win) : false;
  });
}

// ── The window ─────────────────────────────────────────────────────────────

/** Native fullscreen: Esc doesn't leave it (Esc is the game's pause key). */
function toggleFullscreen(win: BrowserWindow): boolean {
  const next = !win.isFullScreen();
  win.setFullScreen(next);
  return next;
}

function createWindow(): BrowserWindow {
  const stateFile = path.join(app.getPath('userData'), 'window-state.json');
  const placement = placeWindow(readWindowState(stateFile), screen.getAllDisplays().map(d => d.workArea), WINDOW);
  const win = new BrowserWindow({
    ...placement.bounds,
    useContentSize: placement.useContentSize,
    minWidth: WINDOW.minWidth,
    minHeight: WINDOW.minHeight,
    // Only ever `true`: an explicit `fullscreen: false` makes a Mac window unable to go fullscreen at all.
    ...(placement.fullscreen ? { fullscreen: true } : {}),
    title: PRODUCT_NAME,
    backgroundColor: BACKGROUND,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      // Minimized, the page is hidden: Phaser pauses its loop and MusicManager suspends the music.
      backgroundThrottling: true,
      devTools: !app.isPackaged || app.commandLine.hasSwitch('devtools')
    }
  });

  let shown = false;
  const show = () => {
    if (shown || win.isDestroyed()) return;
    shown = true;
    if (placement.maximized && !placement.fullscreen) win.maximize();
    win.show();
  };
  win.once('ready-to-show', show);
  setTimeout(show, 5000); // a page that never paints still gets its window

  let timer: ReturnType<typeof setTimeout> | undefined;
  const remember = () => {
    if (win.isDestroyed()) return;
    writeWindowState(stateFile, { bounds: win.getNormalBounds(), maximized: win.isMaximized(), fullscreen: win.isFullScreen() });
  };
  const soon = () => { clearTimeout(timer); timer = setTimeout(remember, 500); };
  win.on('resize', soon);
  win.on('move', soon);
  win.on('maximize', soon);
  win.on('unmaximize', soon);
  win.on('enter-full-screen', soon);
  win.on('leave-full-screen', soon);
  win.on('close', () => { clearTimeout(timer); remember(); });
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });

  // F11 everywhere, Ctrl+Cmd+F on a Mac. Esc is left to the game.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return;
    const macCombo = process.platform === 'darwin' && input.control && input.meta && input.code === 'KeyF';
    if (input.key === 'F11' || macCombo) {
      event.preventDefault();
      toggleFullscreen(win);
    }
  });
  void win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => undefined);
  win.webContents.on('render-process-gone', (_event, details) => console.error('[desktop] the game process ended:', details.reason));

  void win.loadURL(devServer ? `${devServer}/${entryQuery(process.argv)}` : `${APP_ENTRY}${entryQuery(process.argv)}`);
  return win;
}

function setMenu(): void {
  const devItems: MenuItemConstructorOptions[] = app.isPackaged
    ? []
    : [{ type: 'separator' }, { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }];
  const fullscreen: MenuItemConstructorOptions = {
    label: 'Toggle Full Screen',
    accelerator: process.platform === 'darwin' ? 'Ctrl+Cmd+F' : 'F11',
    click: () => { if (mainWindow) toggleFullscreen(mainWindow); }
  };
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' },
      { label: 'View', submenu: [fullscreen, ...devItems] },
      { role: 'windowMenu' }
    ]));
  } else {
    // Windows and Linux: no menu bar in a game window (development keeps reload and DevTools).
    Menu.setApplicationMenu(app.isPackaged ? null : Menu.buildFromTemplate([{ label: 'View', submenu: [fullscreen, ...devItems] }]));
  }
}

function loopbackOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') && isLoopbackHost(u.hostname) ? u.origin : null;
  } catch {
    return null;
  }
}
