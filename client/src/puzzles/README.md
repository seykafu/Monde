# G-06 · Spring puzzles

`PZ-01.ts` … `PZ-18.ts` are pure modules. Each exposes state creation/reset, legal moves, move, undo,
win, authored hints, serialization and validation on restore. `core.ts` supplies the common session
machinery. No pure module imports Phaser or DOM APIs.

All nine boards use the paper overlay in `scenes/PuzzleScene.ts`, with a distinct board renderer per
puzzle. It uses the available scene-location backdrop art; the lens, pond and footbridge draw their
boards without borrowing unrelated festival art. Keyboard: Tab/arrows to select, Enter/Space to use,
U undo, R reset, H hint, C check, Escape leave. Buttons also accept mouse input. Successful checks
play `Sfx.sfxCineChime`. Leaving preserves progress and returns the actual solved/deferred result.

| Puzzle | Board and logic | Normal trigger | Live Python cross-check |
|---|---|---|---|
| PZ-01 · Under the Square | `PZ-01.ts`, pipe ports, connected network, no leaks | S04 cue; Fountain Square D5+ | Enumerate orientations with boundary/adjacency pruning; one connected solution, same 25 port masks; start rotated clockwise |
| PZ-02 · The Old Lady’s Flues | `PZ-02.ts`, 3×3 plus toggles | Bakery D4+ | All 512 press sets; unique zero-based indices 3, 5, 6, 7 |
| PZ-03 · The Almanac | `PZ-03.ts`, word selection from all ten lines | S02 cue; Library D2+ | Exact page and line.word coordinates; “my map sleeps in the sixth book of tides” |
| PZ-04 · Market Day | `PZ-04.ts`, 15 assignment cards and request clues | Market Hall D12+ | All arrangements after fixed-stall pruning; unique vendors Nell/Kasimir/June/Odile/Teo, awnings white/blue/yellow/red/green, gifts herring/kites/songs/jam/cuttings |
| PZ-05 · The Lens | `PZ-05.ts`, mirror toggles, beam trace, blockers/loops/prism/exit | Lighthouse D16+ | All 32 mirror settings; unique /, \\, /, \\, / |
| PZ-06 · Who Fed the Ducks? | `PZ-06.ts`, statements and suspect selection | Duck pond D6+ | All four suspects; Bertrand alone leaves exactly one false statement |
| PZ-13 · Lamplight | `PZ-13.ts`, breakers and six circuit lamps | Town Hall D8+ | All 64 switch settings; unique breakers 1, 2, 3, 5 |
| PZ-15 · The Founder’s Gears | `PZ-15.ts`, four distinct gear selections | S07a cue; Clocktower after `pinion_found` | All distinct four-gear trains; unique unordered mesh pair (8→32, 10→30) |
| PZ-18 · Planks for the Footbridge | `PZ-18.ts`, individual offcuts assigned to gaps | Commons footbridge D15+ | All 3⁷ assignments; unique length partition (2+5), (4+5), (3+3+5) |

`?puzzle=PZ-01` (substitute any supported ID) skips the title and opens that puzzle once. It uses the
same checks and reward path as ordinary play; it does not allow the player to select success.
`story/host.ts` calls the real puzzle presenter; the remaining Scuffle placeholder is unchanged.
`interaction.ts` adds place prompts. Where a Favor or economy interaction also exists, a small
choice preserves access to both. ZoneScene changes are limited to the import, attachment and prompt.

## Saves and hints

`SaveGame.puzzles` defaults to empty on read, keeping schema version 3. It stores each board, undo
history, active real seconds, unlocked hint count, solved state, reward receipts, pending items,
solve days and weekly-effect receipts. Collect/restore/runtime include it; New Game clears it.
A full bag retains the map reward for delivery on a subsequent visit rather than losing it.

The first authored hint unlocks at 180 active seconds (or immediately with Wits 3's existing perk).
The next button explicitly asks the associated resident; the third needs Friend Regard ≥40.
The panel displays authored text directly and sends no puzzle solution or locked hint to an AI call.
Reset keeps elapsed time and hints; undo can undo a reset. Background/unfocused time does not count.

## Rewards and integration contracts

`runtime.ts` revalidates every solved board and deduplicates its rewards independently of story cue
replay. Wits uses `gainXp`; items use the economy inventory operation; Regard goes through the
existing `scripted_regard` event queue (without also adding to the friendship mirror). Pillars use
`applyPillarDelta`.

- Every solution writes its exact `pzNN_solved` flag. Existing deferred/pending flags are cleared.
- PZ-02: `bakery_ovens_fixed`, Odile +5, weekly Prosperity +1 while the bakery is open.
- PZ-03: map item, six durable chain-start pins, Margo +5.
- PZ-06: Spirit +1, Bertrand +5; Duck Duty becomes available at the pond using §8's costs/effect.
- PZ-15: `clock_running`, `pinion_fitted`, Charm +5, Bertrand +15, weekly Spirit +1. S07's authored
  Spirit +4 remains a distinct scene effect.
- PZ-18: `project_footbridge_done`, Charm +1, Kasimir +5.
- PZ-04: all five vendors +3 on the first Saturday after the market Project is complete.
- `puzzleStepDone(registry, project)` exposes the durable puzzle step. `syncPuzzleProjects` only
  awards the specified completion Pillars when **both** the board is solved and the existing
  `project_<id>_done` flag is set. Solving a board does not bypass Project funds/materials/hours.
  Lighthouse completion also attempts the discovered WF-4 through the existing riddle adapter,
  whose existing Project gate makes WF-5 available.

The repository's story host still records Project unlocks without implementing funding/materials/
volunteer-hours. This change supplies their puzzle steps and completion-flag consumer; it does not
implement the whole Project system. World/render files owned by the other agent were not changed:
physical fountain gathering, bakery customer throughput, lighthouse beams, footbridge collision,
and map-pin rendering remain consumers of these flags/data, rather than new renderer changes here.

## GDD gaps and constraints

- §15.1 gives no Wits XP amount: provisional **40**, matching a world-found Mark (§14.3), marked
  `GDD-GAP` in code.
- PZ-05 has no starting mirror arrangement: all `/`, marked `GDD-GAP`.
- Python's PZ-15 solver requires **both meshes to reduce speed** (`a<b`, `c<d`), omitted by the GDD
  prose. The TS rules and player instructions preserve the verifier's constraint.
- Map economy metadata is unauthored: unique, valueless quest item, marked `GDD-GAP`.
- Duck Duty uses the existing provisional 10 work XP convention. The server's fixed six-job catalogue
  does not include it; its action is recorded via a scripted memory for Bertrand, using importance 2
  (the existing sweeping importance), rather than sending an invalid community-task event.
- Weekly bakery effects recognize `bakery_closed`; the existing Project rule says the repaired
  bakery will not close. No new closure simulation is introduced.

## Verification

`tools/verify_puzzles.py --json` exports facts computed by the existing solvers for these nine puzzles,
not a second hand-maintained solution list. Normal invocation still runs all twenty puzzles and the
arithmetic riddles. `__tests__/verifier.test.ts` runs the JSON export and independently solves or
checks each TS instance. `runtime.test.ts` covers reward deduplication, Project gating, delayed map
delivery, weekly rewards and save migration. `panel.test.ts` exercises keyboard actions, leaving,
real outcome checks and independent puzzle/story clock holds with a headless Phaser display adapter.
These tests do not replace an in-browser visual review.

Validation on this shared working tree (2026-10-15):

- All **43 puzzle tests** passed (28 verifier/core, 5 rewards/save, 10 panel lifecycle).
- Latest `npm test`: **1448 passed, 6 failed**, across 108 passing and 3 failing files. All client tests
  passed, including story host and save runtime. Remaining failures are in server night processing
  (4), snapshot timing (1), and the concurrent press job (1); no server files were edited here.
- `npm run typecheck` passed earlier. The last run passed shared/client and then failed at
  `server/src/mind/__tests__/press.test.ts:49` (TS2554, expected 2–3 arguments, got 1), in concurrent work.
- `npm run lint`: **0 errors**.
- `npm run verify:puzzles`: **all checks passed**.
- `npm run scenes` and `npm run build` hit the sandbox's `tsx` IPC `EPERM`. Equivalent commands passed:
  `node --import tsx tools/compile-scenes.ts` (37 scenes, zero errors/warnings),
  `cd client && node ../node_modules/vite/bin/vite.js build`, and `npm run build -w @monde/server`.
- No dependencies added; no commits or pushes. No browser visual review was available; panel checks
  exercise input and lifecycle with a headless display adapter.
