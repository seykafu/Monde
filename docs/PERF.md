# Q-04 performance capture

MVP targets (`MVP_PLAN.md` Q-04; GDD §19): **60 fps at 1080p with 60 visible residents and lights**, **zone loads < 1,500 ms**, **memory < 1.5 GB**. Completion requires a capture on a mid-range laptop. This harness supplies measurements; passing unit tests is not evidence that those targets pass.

## Browser

```sh
npm run dev
```

Open **http://localhost:5173/?skiptitle=1&perf=1&crowd=60&time=12:00**. Keep the game foregrounded, at 1080p, with the camera still. The harness adds 60 temporary walking actors to the current zone (in addition to its normal residents), waits 1.5 seconds for textures/fades, then records 20 seconds. Look for `[perf]` JSON in the console. The latest report is `window.__perfReport`.

These actors use the resident layer's actor factory, spacing, animation, depth, shadows, labels and drawing routines, and the resident navigation path sampler and walking speed. They walk short out-and-back routes on visible walkable cells. They do not join saved town membership, call the mind service, or use daily plans/social AI. This is a repeatable rendering/movement stress workload, not a simulation of 60 independent conversations. Small interiors may reuse cells; record crowd overlap when interpreting those runs.

The module loads dynamically only in a dev build or with `perf=1`. Dev builds without a crowd parameter expose the controls but do not automatically populate or capture. Ordinary production gameplay does not load the harness or run its per-frame listeners.

In DevTools:

```js
// Tour all four districts and one interior, with 60 extra actors and 20 s per zone.
// Wait for the automatic capture above to finish first.
await window.__perf.tour(60, 20000)

// Manual controls (no simultaneous capture/tour):
window.__perf.zones                  // valid destination ids
window.__perf.zone('market_row')     // normal fade/restart transition
window.__perf.spawn(60)              // replaces the temporary crowd; 0 removes it
// Wait at least 1.5 s after spawning, then:
await window.__perf.capture(20000)
window.__perf.print()
copy(JSON.stringify(window.__perfReport, null, 2))
```

The tour records warm transitions, including a restart into the first district. Repeat with `time=21:00` in the starting URL for lights at night. Do not open overlays, move the camera or change zones during a steady-state capture. Hidden tabs, zone changes, render timeouts and loss of crowd visibility mark captures invalid. `minVisibleCrowd` must be at least 60 for the crowd target; visibility checks are viewport tests, not occlusion tests. Keep the game unobscured and visually inspect the crowd. Camera movement may require respawning it. Navigation/clock/save behavior remains normal: use a disposable test save.

## Packaged desktop (Electron)

Build/package the current client with the existing desktop pipeline:

```sh
npm run desktop:dist
# macOS example: quit any existing Monde process first.
/Applications/Monde.app/Contents/MacOS/Monde --remote-debugging-port=9333
```

Use the equivalent executable path for your package or platform. Open `chrome://inspect/#devices` in Chrome, configure `localhost:9333`, and inspect Monde. In its renderer console run:

```js
location.href = 'app://monde/index.html?skiptitle=1&perf=1&crowd=60&time=12:00'
```

The normal desktop command-line parser does not forward arbitrary query flags; navigate through DevTools/CDP as above. After reload the same automatic capture and `window.__perf` controls work. For CDP automation, discover the renderer with:

```sh
curl http://localhost:9333/json/list
```

Connect to that page's `webSocketDebuggerUrl`, use `Runtime.evaluate` to navigate with the expression above, then evaluate `window.__perfReport` with `returnByValue: true`. For the full tour evaluate `window.__perf.tour(60, 20000)` with `awaitPromise: true` and `returnByValue: true` after the initial capture finishes. Reconnect if navigation replaces your debugging session.

## Reading and saving results

- `fpsMean`: total measured frames / measured seconds, **not** the arithmetic average of instantaneous fps.
- `fpsP5`: fifth percentile of `1000 / frameMs`; 95% of sampled frames have at least this instantaneous fps.
- `frameMsP50/P95/P99`: median/tail render intervals in milliseconds. Percentiles use linear interpolation between sorted ranks (R-7). At 60 fps, a frame is about 16.67 ms.
- `longFramesOver50Ms`: number of intervals strictly greater than 50 ms.
- `frames`, `elapsedMs`, `wallMs`, `requestedMs`: sample count, sum of render intervals, wall duration, requested duration. Sampling ends at the first rendered frame after the window, so it may overshoot. Phaser's game-level post-render timestamps are used, not its clamped simulation delta; they measure render cadence, not GPU presentation completion.
- `crowd`, `minVisibleCrowd`, `valid`, `invalidReasons`: requested extra actors, minimum visible extras across the window, and capture validity. Natural residents add additional load. Empty statistics are `null`, never fabricated zero fps.
- `zoneLoads`: destination, district/interior kind, and milliseconds from transition start (including the 400 ms fade-out) to the first new-zone post-render. Fade-in completion is excluded. Initial entry is explicitly labeled **create-to-first-render**, excludes preload, and must not be used as a full transition/startup result. A synchronous render marker preserves the boundary even if the harness chunk loads later.
- `roster`: the persona cards the client read at boot (212 once the Day-1 census is written, MVP M-03; 24 before) and the milliseconds it took (the compiled `residents.gen.json` parsed, and in a dev build checked against the schema too). A zone builds sprites only for the residents on its board (30–48 on the busy boards at noon with 212), not the whole town.
- `heapStart/heapEnd`: Chromium's optional `performance.memory` used/allocated/limit JS heap bytes, or `null`. These can be coarse and exclude native, texture/GPU and other process memory. **They cannot establish the 1.5 GB total-memory target.** Also record process memory using the OS/browser task manager (for Electron, include its child processes), noting the measurement method and peak during the tour.

Save the JSON with laptop model, CPU/GPU, RAM, OS, browser/Electron version, power mode, display refresh rate, resolution, build revision, day/time/weather, process-memory observations, and whether assets were warm. Report each district plus the interior and any invalid runs. No hardware-target pass/fail is inferred automatically.

## Captures

| Date | Machine | Build | Crowd | fps mean / p5 | frame p95 / p99 | long frames | zone loads | JS heap |
|---|---|---|---|---|---|---|---|---|
| 2026-10-17 | MacBook Pro, M1 Max, 120 Hz, packaged desktop app | ca6b381 | 60 visible | 120 / 108 | 9.2 / 9.5 ms | 0 | 0.51–0.85 s (four districts, the bakery) | ~88 MB |

The M1 Max runs at its display refresh with headroom; the MVP sign-off still needs a mid-range laptop (Q-04).

## First launch (web build)

What a player waits for before the first screen, and what the loading screen (`client/index.html` `#loading`,
`client/src/boot/`) shows meanwhile. Before any code runs the page shows the screen in plain HTML and CSS (the desktop
app's CSP allows no inline script): the title's heading and footer over a dusk, and a bar that shimmers while the code
downloads. Once a scene's preload starts the bar counts real bytes (`boot/loadMeter.ts`, the code's bytes included), and
it fades into the title or the town on their first frame. A later load that takes longer than 250 ms (a district or room
the background fetch hasn't reached) shows the panel alone, "On the way to …". So does New Game, Continue or Load while
the town's code is still on its way (below).

What loads up front:

- **Code:** the title's own, 0.43 MB over the wire: index 88 KB (the title, the save list, the mind client) and phaser
  340 KB. The rest of the game (`client/src/game.ts`: the town and its scenes, the stories, the save runtime, 536 KB,
  and the resident roster, 286 KB) is a dynamic import (`boot/gameCode.ts`) that the title starts as it draws, ahead of
  the town's art. New Game, Continue and Load wait for it if they have to. Past 250 ms the panel reads "On the way to
  Monde" with the bar shimmering (a module's download reports no progress), and the board's load carries on from there
  with the code's bytes counted as done. `?skiptitle`, `?puzzle`, `?scuffle` and `?demo` fetch it at once behind the
  boot screen. `@monde/shared` is marked side-effect free, so the title takes only the schemas it uses (zod is most of
  its 88 KB).
- **Title:** the harbour backdrop, 216 KB, fetched by the title's preload once the code is in: 1.3 s of the title's
  4.1 s on slow 4G. The fifteen music HEAD probes now happen when each track first plays, not at boot.
- **Town:** only the board's own sprites (`world/boardAssets.ts`): the Old Quarter is 52 files and 1.07 MB of the 160
  files and 3.24 MB. The other boards follow in idle time, nearest first (`boot/textureFetch.ts`). The title starts on
  Continue's board, else the Old Quarter and the ferry slip a New Game hops to.
- **Portraits** (94 MB in all) were already lazy. A core or acquainted resident's sheet is now fetched as the player
  walks up to them, so the conversation opens on the art. Ambient residents' still load when a conversation opens: a
  sheet is about 6 MB of texture memory that stays.
- **Music and ambience** load after the first key or click, one track at a time. The title theme (3.8 MB) also waits for
  the town's code and doesn't start once the player is on the way in; otherwise it shares a slow link with the town's
  art. Before that hold, a New Game chosen 1.5 s after the title got its code 1.8 s later (10.2 s instead of 8.4 s).

Measured 2026-10-26 on the M1 Max: Chrome 156 headless at 1280×720, cache off, `vite preview` of the production build,
`?offline`. "Slow 4G" is Lighthouse's profile (150 ms RTT, 1.6 Mbit/s down). The first four rows are medians of 2–3
runs, the rest single runs; the New Game and district rows of the loading-screen column were on the dev server,
throttled after boot. The page marks `monde:first-frame` when the first scene draws. The code split's New Game rows
(and their 74e59e2 numbers, re-measured the same day) throttle from the first byte instead, since the split moves code
after the title and throttling after boot would hide it: press New Game, then "Keep sharing off", and time to the ferry
slip's first frame. In brackets: the same moment counted from opening the page.

| | before (0760d53) | loading screen (74e59e2) | code split |
|---|---|---|---|
| Something on screen (first contentful paint), slow 4G | 7.0 s (blank page) | 0.2 s (loading screen) | 0.2 s |
| Title's first frame, slow 4G | 8.4 s, 1.47 MB | 8.4 s, 1.47 MB | 4.1 s, 0.65 MB |
| Town with `?skiptitle=1`, slow 4G | 25.2 s, 4.49 MB, 165 requests | 13.9 s, 2.34 MB, 57 requests | 14.0 s, 2.34 MB, 58 requests |
| Title / town first frame, no throttling | 0.68 s / 1.74 s | 0.68 s / 1.69 s | 0.49 s / 1.62 s |
| New Game → ferry slip, slow 4G after boot, chosen 1.5 s after the title | 23.7 s | 11.2 s | (not re-measured) |
| New Game → ferry slip, slow 4G after boot, after 15 s on the title | 23.7 s | 2.2 s | (not re-measured) |
| New Game → ferry slip, slow 4G from the first byte, chosen 1.5 s after the title | | 12.2 s (22.2 s) | 14.3 s (19.9 s) |
| New Game → ferry slip, slow 4G from the first byte, after 15 s on the title | | 2.2 s (25.7 s) | 2.2 s (21.5 s) |
| District never visited (the Commons), slow 4G, cold | (all loaded at start) | 4.9 s behind the loading screen | (same path) |
| A district after 20 s of idle fetching | (all loaded at start) | 1.0 s (the 0.4 s fade and the bake) | (same path) |

The split doesn't change how many bytes the town needs, only their order. `?skiptitle` waits as long as before: the link
sits idle for 0.3 s while Phaser runs and asks for the town's chunk, and is busy the rest of the time either way. A New
Game chosen right after the title now waits about 2 s longer from the press, since 0.82 MB of code that used to come
before the title comes after it. It still reaches the ferry slip 2.3 s sooner from opening the page.
