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
- `puzzleStepDone(registry, project)` exposes the durable puzzle step. Completion Pillars belong to
  the Projects (G-03, `client/src/projects`): they apply `content/projects.yaml`'s `complete` once
  the funds, materials, hours **and** this puzzle step are in. Solving a board does not bypass them.
  A save from before G-03 that already took a bump here keeps its `project:<id>` receipt
  (`legacyProjectReward`), and the Projects never apply it twice.
  Lighthouse completion also attempts the discovered WF-4 through the existing riddle adapter,
  whose existing Project gate makes WF-5 available.

The Projects themselves (funds, materials, volunteer-hours, the opening) are G-03's
(`client/src/projects`): a Project's `puzzle` step reads these boards, and its opening sets the
`project_<id>_done` flag and applies the completion Pillars. Bakery customer throughput, footbridge
collision and map-pin rendering remain consumers of these flags/data.

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

# G-07 · Procedural community work: Mail Round, Library Returns (§15.21)

Two of §8's jobs are now played as boards: the place prompts at `wharf.ticket_booth` (Ada) and `old_quarter.library`
(Margo) open them instead of the plain timed beat. The job still pays exactly what G-09 pays (`completeWork`: coins,
Stamina, game minutes, the capped and diminishing Pillar effect, 10 XP, the `community_work` event), but only once the
saved board is re-checked as won within par. Leaving (Esc) keeps the board and costs nothing.

| Board | Pure logic | Generator (§15.21) | Win |
|---|---|---|---|
| Mail Round | `mailRound.ts`, graphs in `mailMaps.ts` | A district's place graph, built from its board: every door a node, streets join neighbouring doors (relative neighbourhood graph), weighted by the board's own shortest walk in whole steps. k = 4 + ⌊Wits/2⌋ (max 8) addressed doors. Par = exact optimum (Held–Karp) + 15%, rounded up. | Every letter delivered (passing a door counts) within par steps |
| Library Returns | `libraryReturns.ts` | 6–12 books with distinct Dewey-style call numbers, shuffled. Minimum = n − cycles; par = minimum + 1. | Shelf in call-number order within par swaps |

Both are `core.ts` sessions (`puzzle()`), so undo, reset, the hint ladder (nudge after 3 minutes or Wits 3; ask Ada or
Margo; at Friend Regard, the first step of an optimal solution) and the save shape match the authored puzzles.
`work.ts` seeds each day's board from the world seed, the job, the day and how many times the job has been done today,
so a reload gives the same board. It saves progress in `SaveGame.puzzles.entries` under `work:<job>:<day>:<run>:<wits>`
(keeping the Wits level the board was drawn at) and keeps only the current board of each job. `scenes/WorkPuzzleScene.ts`
is the paper shell in PuzzleScene's style: Tab/arrows select, Enter/Space use, U undo, R reset, H hint, Esc leave.
Every map door and book is also clickable. Text follows the text-size setting, and with reduced motion the walk and the
swap happen without their 220 ms tween.

Library Returns has a parity property: every swap flips the permutation's parity, so a sorted shelf always took the
minimum plus an even number of swaps. Par's one spare swap can never be used. Only a perfect re-shelving wins, where
every swap sends one book home.

**Try it (dev build):** `npm run dev`, then open `http://localhost:5173/?skiptitle=1&day=3&work=mail` (or `work=library`)
and close the morning paper; the job's prompt runs once, as pressing E at its place would. In ordinary play, walk to
the ferry ticket booth on the Wharf, or to the library in the Old Quarter, from Day 2 and press E. At the library, the
prompt offers a choice while The Almanac (PZ-03) is unsolved.

**GDD gaps** (marked `GDD-GAP` in code): Wits/2 rounds down; par rounds up to a whole step; the Commons takes no
rounds (three doors, too few for k = 4); a round starts at Ada's booth on the Wharf, or where the walk up from it
enters Market Row or the Old Quarter, and ends at its last door. Empty houses, empty shopfronts and the Fellow's
cottage take no letters. The book count per Wits level is spread over 6–12, and a shuffle is redrawn until it needs at
least ⌈n/2⌉ swaps. Finishing under par gives nothing extra. Not built yet: the Mail Round's chats with residents met
on the route, and Library Returns' rare Founder's Notebook page. Neither the item ids nor the odds are authored.

**Tests:** `__tests__/procedural.test.ts` generates 1,000 instances of each and solves every one within par, in exactly
the optimal steps or minimum swaps. It checks the Held–Karp optimum against a brute force over every letter order, the
minimum swaps against a breadth-first search, and that generation is deterministic per seed. It also covers the
boards' state transitions. `__tests__/work.test.ts` covers seeding, reloads, held Wits, pruning, the re-check and the
scene's keys, mouse, hints, reduced motion and text size. `economy/__tests__/workPuzzles.test.ts` checks that the flow
pays only for a won board. The QA bot (`qa/springBot.ts`) plays each board with the solver's moves before it is paid.
