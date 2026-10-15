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
`ai_open` warns in development and continues, as do other unsupported host cues. It does not
invent a canned resident exchange. The production adapter must provide that exchange.

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
