# G-05 integration notes

`content/riddles.json` is the single runtime source for 25 Spring riddles: OQ/MR/WF 1–5,
CM 1–4, and Tib 01–06. Shared Zod schemas load it on client and server. Plaques,
accepted lists and authored ladders are transcribed from GDD §14. Example fields:

```json
{
  "id": "OQ-1", "chain": "OQ", "district": "old_quarter",
  "title": "The Retired Voice",
  "mark": "on the backplate of the player's own door knocker, Lamplighter's Cottage.",
  "accepted": ["bell", "old bell", "chapel bell", "church bell", "st brigids bell", "brigids bell"],
  "startDay": 1, "previous": null, "prerequisites": [],
  "normalization": "fold-articles-punctuation-number-words",
  "rewards": { "namedXp": 20, "foundXp": 40, "charm": 1, "spirit": 0,
    "coins": 0, "regard": 0, "flags": [], "items": [] },
  "fragment": null
}
```

Entries also carry the full `inscription`, three `hints`, `answerLocation`,
`worldConditions` (verbatim access rules), and explicit `gaps`.
Only completed fifth Marks yield fragments. CM-4 does **not** award Fragment V.
WF-4 and WF-5 require `project_lighthouse_done`. Clocktower restart rewards remain
with the existing PZ-15/story flow; finding the pinion does not restart the clock.

Matching folds accents, case, punctuation, articles and grammatical number-word
runs. It compares whole answers. Fuzzy acceptance is deliberately restricted to
reviewed one-edit nonwords, avoiding valid wrong words such as scale/stale/scare.
There is no general dictionary dependency. This restriction is documented in §14.2.

Hint 1 appears after 60 game minutes; hint 2 requires Margo/Bertrand/Tib or 10
Stamina at the cottage; hint 3 requires those residents at Regard 40+ or one
chain-specific Notebook page. Payment only occurs for a successful transition.
GDD-GAP: Tib's ladders and exact duel days are unauthored; null slots cannot be
invented. The conversation offers the next unfinished Spring duel. His pity hints
cannot be supplied until their text is authored.

Save schema remains version 3. The optional/defaulted `riddles` section stores
entries (found/solved, discovery time, level, attempts, solve method), selected
Mark, last Journal tab, pinned answers and chain headlines. Absent entries are
locked. Capture/load/reset use `monde.riddles`; solved entries never pay twice.

The Phaser adapter lives in `scenes/riddles.ts`. Wits uses `gainXp`, Charm/Spirit
use `applyPillarDelta`, flags use the live FlagStore, coins use the wallet, and
Tib Regard/chain memories use the existing idempotent ClientEvent queue. Pinion
items remain in the story ledger until the item owner registers the typed
`monde.riddle.rewardConsumer`. Headlines appear in Today and the following Dawn
Report. GDD-GAP: chain memory importance is 6, matching a landmark opening.

`scenes/markInteraction.ts` isolates board integration. It accepts `MarkSite {
id, zone, at: [x,y] }` through `zone.marks`, or `mark` on loaded `town.props`.
Until those exist, its only stub is the canonical cottage door for OQ-1. It
never invents other coordinates. Reading a new Mark can solve the preceding
found Mark at full XP, subject to `worldRules.ts`. Already recorded plaques live
in the Journal so the prompt does not block doorway/sleep interactions.

`monde.riddle.worldFacts` is a typed `Partial<WorldRiddleFacts>` adapter for tide,
weather/wind, ferry days, borrowed tools and the clocktower step counter. Inventory,
Regard, flags and current time are read from their live owners. Missing facts fail
closed. GDD-GAP: borrowed-tool item ids and the Notebook ids
`founders_notebook_<chain>` need their item/object owners. Final physical answer
objects (e.g. step 78) can call `submitMark(..., 'found')` only after checking
`canFindAnswer`; no nonexistent stair/tide mechanics are simulated here.
Typed answers remain usable and record their destination in the Journal. `pinned`
is a saved hook for the future map UI; there is no map UI in this change.

The server looks up answers from its own records. Only inscription and unlocked
safe hints enter dynamic prompt block 4; blocks 1–3 are untouched. The detector
handles normalized phrases, numeric words, spaced letters, reversal, selected
synonyms and explicitly signalled anagrams. A strict authored-line allowlist
also blocks arbitrary semantic/partial/encoded answers and higher ladder hints.
All streaming is suppressed for riddle turns. Rejected replies regenerate once,
then use the highest nonleaking authored hint at/below the level, else the existing
stumped line. Choices and effects on accepted riddle turns are replaced with
neutral engine-owned values. Ordinary conversations remain unrestricted by riddles.
Unknown riddle IDs fail closed with HTTP 400.

`riddleRedTeam.test.ts` sends 50 adversarial fake-model asks through the real
stream/retry/validation pipeline, including leaks in lines, choices and memories.
`tools/riddle-red-team-live.ts` is opt-in staging-only, requires WORLD_URL,
WORLD_ID and WORLD_TOKEN, prints no credentials/responses, and is not run by CI.

No new dependencies, commits or pushes. Browser visual inspection is still needed;
the Journal uses the existing PeopleScene book and keyboard entry rather than a
new renderer or DOM form.

## Changed-file manifest

Created:
- `content/riddles.json`, `shared/src/riddles.ts`
- `client/src/riddles/engine.ts`, `worldRules.ts`, `__tests__/engine.test.ts`, `__tests__/adapter.test.ts`, this README
- `client/src/scenes/riddles.ts`, `markInteraction.ts`, `MarkPages.ts`
- `server/src/mind/__tests__/riddleRedTeam.test.ts`
- `tools/riddle-red-team-live.ts`

Modified for G-05 (some also contain concurrent economy changes):
- `shared/src/index.ts`, `shared/src/save.ts`
- `client/src/save/collect.ts`, `restore.ts`, `runtime.ts`, `__tests__/save.test.ts`
- `client/src/scenes/PeopleScene.ts`, `DialogueScene.ts`, `ZoneScene.ts`, `TownLedgerScene.ts`, `story/attach.ts`
- `client/src/story/host.ts`
- `server/src/mind/riddles.ts`, `promptBuilder.ts`, `validate.ts`, `context.ts`, `dialogue.ts`, `fallback.ts`, `routes.ts`
- `server/src/mind/__tests__/validate.test.ts`, `talk.test.ts`
- `tools/lint-content.ts`, `docs/MONDE_GDD.md`

The zone adapter now supplies live weather/wind and ferry-day status; only object-specific
facts (tide, borrowed tools, stair counter) need external providers.

## Verification (2026-10-15)

- `npm run typecheck`: passed.
- `npm test`: 105 files, 1,393 tests passed, including 50 fake-model adversarial cases.
- `npm run lint`: passed, zero errors.
- Content lint: zero errors/warnings via `node --import tsx tools/lint-content.ts`.
- Scenes: 37 compiled, zero errors/warnings via `node --import tsx tools/compile-scenes.ts`.
- `npm run verify:puzzles`: all passed.
- Client Vite build and server tsup build: passed.
- Normal content/scenes/build scripts hit tsx IPC `EPERM`; the above direct equivalents ran successfully.
- `npm run smoke:server`: binding 0.0.0.0:8097 was denied by the sandbox. Equivalent Fastify injection returned 200 for `/v1/health` and `/v1/version`, with a valid prompt-version hash.
- Optional live red-team script was not run; browser visual inspection was not available.
- The real Mark accessor was still absent at the final integration check; no protected zone/render files were edited.
