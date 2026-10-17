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
- `heapStart/heapEnd`: Chromium's optional `performance.memory` used/allocated/limit JS heap bytes, or `null`. These can be coarse and exclude native, texture/GPU and other process memory. **They cannot establish the 1.5 GB total-memory target.** Also record process memory using the OS/browser task manager (for Electron, include its child processes), noting the measurement method and peak during the tour.

Save the JSON with laptop model, CPU/GPU, RAM, OS, browser/Electron version, power mode, display refresh rate, resolution, build revision, day/time/weather, process-memory observations, and whether assets were warm. Report each district plus the interior and any invalid runs. No hardware-target pass/fail is inferred automatically.

## Captures

| Date | Machine | Build | Crowd | fps mean / p5 | frame p95 / p99 | long frames | zone loads | JS heap |
|---|---|---|---|---|---|---|---|---|
| 2026-10-17 | MacBook Pro, M1 Max, 120 Hz, packaged desktop app | ca6b381 | 60 visible | 120 / 108 | 9.2 / 9.5 ms | 0 | 0.51–0.85 s (four districts, the bakery) | ~88 MB |

The M1 Max runs at its display refresh with headroom; the MVP sign-off still needs a mid-range laptop (Q-04).
