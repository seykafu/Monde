# Story core (G-10)

This directory is pure TypeScript. Supply compiled scenes (the values of `scenes` in
`scenes.gen.json`), a `FlagStore`, and a `StoryHost` to `StoryDirector`. Call `refresh()` on
zone/place entry and minute ticks. Drive `next()` until it yields a line or choice; acknowledge
lines with `next()` and submit choices with `choose(index)`. `progress` yields control between
instructions; `end` closes the current scene; `null` means no scene is eligible. Do not call
`next`/`choose` concurrently while a host operation is pending.

The host provides fresh `StoryContext` values. Time uses the simulation's game day and minutes
0–1560: 01:00 after midnight is 1500 on the preceding game day, not 60. Windows include their
start and exclude their end (an explicitly marked GDD gap). Calendar IDs determine competing
scene priority; prerequisites still come from authored triggers, so S07a can play early.
Only S10a/b and S11 summon from another place (§13.3). `enter(header, summoned)` handles the
confirmation and travel; returning false defers. The host must publish the new place before
returning. Sleeping and Scuffles defer starts.

`StoryHandlers` maps every host cue name to its exact typed argument. Async handlers resolve
when their activity ends. Publish puzzle/riddle/scuffle outcomes into `context().values` before
resolving. Regard tier gates, Pillar clamps, inventory, projects and election rules belong to
the relevant host systems. Header music/backdrop are dispatched before the first body op.
Stage business and retained expressions accompany each `StoryLine`.

AI handlers return lines from the live resident or the resident's Quiet Mode line library.
The host owns conversational interaction, turn caps, timeouts and selection of `auto` speakers.
A missing, empty, or rejected `ai_line` response uses the authored fallback. An unsupported
`ai_open` warns in development and continues, as do other unsupported host cues. The core does not
invent a canned resident exchange; the production adapter provides it (below).

Memory cues pass substituted first-person text and importance unchanged, alongside game day,
minute, place and scene/cue identity. The host must write a `kind: "scripted"` episodic memory,
resolve resident aliases (including `arrival`), and supply IDs, participants and valence through
its memory adapter. The core does not invent unspecified memory metadata or truncate authored
text. S02:133 and S08:59 currently exceed §9.6's 200-character limit (218 and 210 characters).

Flags, branching, choices, local jumps, insert calls/returns and scene handoffs execute internally.
`fallback` is folded by the compiler. Header `sets` is a manifest, never a blanket grant of flags.
Completion IDs persist even for scenes without a conventional done flag; authored done flags also
prevent alternative variants firing. `goto_scene` bypasses location/time gating but respects the
called-from restriction and remaining trigger expression. `load_checkpoint` ends the runtime
when supported; after the step resolves, restore the loaded director/world save.

Save `director.serialize()` alongside the host's world state. An active scene restarts on load,
including entry presentation, with its written flags reset to their entry values. Unrelated flags
and completed scenes survive. Host effects may execute again during a restarted scene: use
`CueContext.scene` and `key` for idempotent durable mutations (coins/items/Regard/memories) in the
host save; presentation and interactive handoffs should replay. This module does not roll back
or serialize the rest of the game world. Restore only when no host handoff is pending.

The minute-by-minute Spring tests visit the relevant places, answer every AI cue, and select the
first or last option. Both traverse 13 scene parts representing all ten beats, on Days
1/2/3/5/8/10/14/18/25. Additional tests cover the empty-boat re-arm and early repaired clock.
Calendar-only system events (e.g. Day 21's newspaper disclosure) are outside this interpreter.

## The host in the game (G-10 part 2)

`host.ts` (pure) builds the `StoryContext` from the live game (clock, zone, `placeAt` the player's position,
the town engine's Pillars/Appeal/census, the `monde.fellow` application) and maps every cue: Regard is mirrored
in a ledger and queued in the offline event log, Pillars go through the town engine, coins/items/Projects/riddles
are ledger placeholders, memories are `kind: "scripted"` offline events, checkpoints go to the save system.
Durable effects are idempotent per `scene|cue key`. `encodeStory` keeps the director and ledger inside the save's
`story_flags` record (flags as `true`, the rest under `$story`), so the save schema is unchanged.
`session.ts` owns one game's director (Spring scenes S01–S10; `?story=all` for every scene), summons with a
30-minute cooldown after "Not yet", and dev `play(id)`. `live.ts` asks /talk for one `{ai_line}` within 6 s.
The Phaser side is `scenes/StoryScene.ts` (the VN presenter) and `scenes/story/attach.ts` (zone, place and
minute triggers, the New Game opening at 09:50 on the ferry slip, `?scene=<id>` and `window.__story`).

### `{ai_open}` in Quiet Mode (offline exchanges)

Each Spring `{ai_open}` cue has a written, branching exchange in `content/lines/scripted.yaml` (schema in its header,
engine in `mind/scripted.ts`, found by scene id + resident). `StoryScene.aiOpen` looks it up when the cue fires:
a resident with a persona card opens the dialogue panel as before, with the exchange passed in `DialogueOpen.scripted`;
the panel's Quiet Mode path (offline, no world, or a server that fails) then plays it instead of small talk, and a live
turn still comes from the model whenever the server answers. A speaker with no card (the S05 `arrival`) has no agent
to open the panel on, so the exchange plays in the story panel itself, replies as choices. A cue without an exchange
behaves as before. `tools/lint-content.ts` fails when a Spring cue has none or its `turns` disagree.
