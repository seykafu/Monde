# Monde desktop (`@monde/desktop`)

The same Phaser game, packaged with Electron for Mac and Windows (GDD §21.1, decision D17). The web build
stays for demos and playtests on itch.io. Steam comes later; see the end of this file.

## Commands (from the repository root)

| Command | What it does |
|---|---|
| `npm run desktop:dev` | Starts the client's Vite dev server, `tsc --watch` on `desktop/src`, and Electron pointed at Vite. Client edits hot-reload in the window. Main process or preload edits restart Electron. Closing the window or Ctrl+C stops everything. Extra arguments go to Electron: `npm run desktop:dev -- --invite=CODE`. |
| `npm run desktop:build` | Builds the client (`client/dist`) and compiles the main process and preload (`desktop/dist`). |
| `npm run desktop:dist` | Runs `desktop:build`, then electron-builder. On a Mac it makes `Monde-<version>-mac-arm64.dmg` and `Monde-<version>-mac-x64.dmg` in `desktop/release/`. On Windows it makes `Monde-<version>-win-x64-setup.exe` (NSIS). Builds are unsigned for now. |
| `npm run desktop:dist -- --mac --universal` | One universal Mac app instead of two (about twice the size; the better fit for Steam). |
| `npm run desktop:compile` | Compiles `desktop/` only. CI runs this; CI never packages. |
| `npm run icon -w @monde/desktop` | Regenerates the placeholder icon (needs Pillow). |

The packaged app runs from `desktop/release/mac-arm64/Monde.app` (or `mac/` for Intel) without installing
the dmg. To launch it with a server invite: `open desktop/release/mac-arm64/Monde.app --args --invite=CODE`.

Launch flags: `--invite=CODE` joins monde-mind with an invite (the game remembers it), `--offline` plays in
Quiet Mode, and `--devtools` allows DevTools in a packaged build.

## How it fits together

```
desktop/src/
  main.ts         app lifecycle, the window, the menu, IPC handlers, the security lockdown
  protocol.ts     app://monde/ → the built client (Request → Response; GET/HEAD, byte ranges, CSP header)
  security.ts     the CSP, the navigation and external-link rules, launch-flag → URL query
  saves.ts        SaveStore: <userData>/saves/*.json, atomic writes, one .bak per slot
  windowState.ts  size, position, maximized and fullscreen, kept between runs
  config.ts       constants and dist/build-config.json (the monde-mind URL)
  ipc.ts          the IPC channel names and the window.mondeDesktop types
  preload.ts      contextBridge → window.mondeDesktop
```

Everything except `main.ts` and `preload.ts` is plain Node and is unit-tested under vitest (`src/__tests__`).
`src/__typecheck__/bridge.ts` checks at compile time that `window.mondeDesktop.saves` matches the client's
`DesktopSaveBridge` (`client/src/save/storage.ts`).

**Serving the game.** The game is served from a privileged custom scheme, `app://monde/`, not `file://`. The
scheme is `standard` and `secure`, so the page has a real origin (`app://monde`) and runs in a secure context.
Vite's `base: "./"` and `import.meta.env.BASE_URL` resolve as they do on itch.io, so one client build works
for both. `fetch()` of JSON and YAML, module scripts, Web Audio, localStorage and IndexedDB all work. A missing
file returns 404, never an HTML fallback, which `MusicManager`'s probe relies on. In a packaged app the
client sits outside `app.asar` as loose files in `Resources/game/` (`client/dist`, minus source maps).

**Security.** The renderer runs with `contextIsolation`, `sandbox` and no `nodeIntegration`. The page gets only
`window.mondeDesktop`, and each of its functions is a single IPC call. The main process answers these calls
only for the game window's top frame on the game's origin. Every response carries this CSP:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:;
connect-src 'self' data: blob: <monde-mind origin>; worker-src 'self' blob:;
object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

The window can't navigate away from the game. `http(s)` and `mailto` links open in the system browser. New
windows, webviews, downloads and all permission requests are refused, including the page's own Fullscreen
API: Esc is the game's pause key, and Esc must never throw the player out of fullscreen. Electron leaves a
refused `requestFullscreen()` pending rather than rejecting it, so desktop code should call
`mondeDesktop.fullscreen.toggle()` instead. Packaged builds also
flip Electron fuses: no `ELECTRON_RUN_AS_NODE`, no `NODE_OPTIONS`, no `--inspect`, and the app loads only from
`app.asar`.

**The server.** The client bundle talks to `VITE_MIND_URL`, or to the client's `DEFAULT_MIND_URL` (staging)
if that isn't set. `desktop:build` writes the same URL to `desktop/dist/build-config.json`, and the CSP's
`connect-src` allows exactly that origin. To build against another server, run
`VITE_MIND_URL=https://… npm run desktop:dist`. The server allows the desktop origin `app://monde` for CORS
(`server/src/app.ts`).

**The bridge** (`window.mondeDesktop`):

```ts
platform: 'darwin' | 'win32' | 'linux'
saves: { list(), read(slot), write(slot, save), delete(slot) }   // = DesktopSaveBridge
info(): Promise<{ version, electron, chrome, platform, arch, packaged }>
fullscreen: { get(): Promise<boolean>, toggle(): Promise<boolean> }
```

The player can also toggle fullscreen with F11 on any platform, or Ctrl+Cmd+F (View menu) on a Mac. This is
native fullscreen, so Esc doesn't leave it. The window opens at 1280×720 (minimum 960×540). It remembers its
size, position, maximized and fullscreen state, and it moves itself back on screen if a monitor is gone. Only
one copy runs at a time. When the window is minimized, the page is hidden, so Phaser pauses and the music
suspends (the client already does both on `visibilitychange`).

## Where saves live

Each slot is one JSON file: `manual-1.json`, `dawn-2.json`, `checkpoint-campaign_season.json`. The `:` in a
slot id becomes `-` in the file name, because Windows doesn't allow `:`.

| OS | Saves folder |
|---|---|
| macOS | `~/Library/Application Support/Monde/saves/` |
| Windows | `%APPDATA%\Monde\saves\` |
| Linux | `~/.config/Monde/saves/` |

Development runs (`desktop:dev`, or the unpackaged app) use a separate `Monde (dev)` folder, so testing never
touches an installed copy's saves.

Each write goes to a flushed temp file. The previous good save becomes `<slot>.json.bak`, and then the temp
file is renamed over the slot. A crash leaves either the old save or the new one, never half of one. A damaged
slot is read from its `.bak`. Slot ids are validated (`kind:key`, with lowercase letters, digits and
underscores only), so a slot id can't name any other path. Saves over 16 MiB are refused. Deleting a slot
removes its `.bak` too. The uninstaller keeps the saves folder. `window-state.json` sits beside `saves/`.

## The icon

`build/icon.png` (1024×1024) is a placeholder made by `scripts/make-icon.py`. It is a crop of the clock tower
and heron fountain from `art_sources/style_bible_v2/fountain_lantern_night.png`, placed on Apple's icon grid.
electron-builder turns it into the `.icns` and `.ico` at package time. To swap it, replace `build/icon.png`
with any 1024×1024 PNG. For hand-tuned per-platform files, add `build/icon.icns` and `build/icon.ico` and point
`mac.icon` and `win.icon` at them in `electron-builder.yml`. On Windows, a full-bleed square without the Mac
margin usually looks better.

## Signing and notarization (later)

Unsigned builds work for testing. A Mac downloaded from the internet will refuse an unsigned build until the
user right-clicks the app and chooses Open. Windows SmartScreen will warn.

**Mac (Developer ID + notarytool).**

1. Join the Apple Developer Program. Create a **Developer ID Application** certificate and export it as a
   `.p12`.
2. In `electron-builder.yml`, under `mac`, remove `identity: "-"`, set `hardenedRuntime: true`, and add
   `notarize: true`. electron-builder's default entitlements already allow Electron's JIT. Add
   `build/entitlements.mac.plist` only if something needs more.
3. Build with the certificate and an App Store Connect API key in the environment:
   `CSC_LINK=/path/DeveloperID.p12 CSC_KEY_PASSWORD=… APPLE_API_KEY=/path/AuthKey_XXXX.p8
   APPLE_API_KEY_ID=XXXX APPLE_API_ISSUER=<issuer uuid> npm run desktop:dist`.
   (`APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID` also works.) electron-builder signs the app,
   submits it with `notarytool`, and staples the ticket.
4. Check it: `spctl -a -vvv -t install desktop/release/mac-arm64/Monde.app` and
   `xcrun stapler validate desktop/release/Monde-<version>-mac-arm64.dmg`.
5. Once signing works, consider turning on the `enableEmbeddedAsarIntegrityValidation` fuse. It is off for
   now because it couldn't be tested on Windows here.

**Windows (code-signing certificate).**

1. Get an OV or EV code-signing certificate. Since 2023 the private key must live on a hardware token or in a
   cloud HSM. Azure Trusted Signing is the cheapest route, and electron-builder supports it through
   `win.azureSignOptions`. A `.pfx` works through `CSC_LINK` and `CSC_KEY_PASSWORD` (or
   `WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD`), and other HSMs work through a custom `win.signtoolOptions.sign` script.
2. Build on Windows (or a `windows-latest` CI runner) with `npm run desktop:dist`. Sign every release with the
   same certificate, so SmartScreen reputation builds up.

## Steam (later)

- **Builds.** Upload the unpacked apps, not the installers: `desktop/release/win-unpacked/` and the `.app`
  (prefer a universal Mac build, since Steam doesn't split Mac depots by CPU). Upload through SteamPipe
  (`steamcmd` and an `app_build` VDF), one depot per OS. Sign both first.
- **Steamworks.** Achievements, the overlay and rich presence need a native Steamworks binding (for example
  `steamworks.js`, which also has a helper for Electron's overlay). That will mean turning `npmRebuild` back
  on and adding the binding to this workspace. Don't add it until Steam is scheduled.
- **Steam Cloud.** Steam Auto-Cloud can sync the saves folder as is: root `WinAppDataRoaming`, subdirectory
  `Monde/saves`, pattern `*.json`, with root overrides for macOS (`MacAppSupport`) and Linux
  (`LinuxXdgConfigHome`). The file names are the same on every OS, so saves move between Mac and Windows.
  Don't sync the rest of the userData folder. The monde-mind device id and world token live in the page's
  localStorage there, and sharing a world across machines needs its own design first.
