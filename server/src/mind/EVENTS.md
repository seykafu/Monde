# M-06: client events

Send world-token-authenticated `POST /v1/worlds/:w/events {events: ClientEvent[]}`.
The shared Zod contract is `shared/src/events.ts`; batches contain at most 500 events.
Every element carries a stable client-generated `id`, `day`, and `minute`.
The response is `{accepted: string[], duplicates: string[], rejected: {id, reason}[], regard: Record<residentId, number>}`.
Malformed envelopes get 400; malformed elements get individual rejections. All successful effects and receipts
commit together. Retrying an ID never reapplies it, even with a changed payload. Rejections do not consume IDs.

For offline sync send the same array as `client_events` in `POST /v1/worlds/:w/night`.
The response's `ingestion` field has the same shape. Ingestion commits with the day claim, before tiers,
encounters, reflections and plans. Events must be on or before the requested night; new events on retries
of a completed night are rejected. Duplicate receipts still acknowledge previous successes.
The older `events?: TownEvent[]` night field remains scheduled/town prompt facts only.
Dawn also returns `regard: Record<residentId, number>`; replace the local mirror with these authoritative values.

## Adapting the current client log

- Persist an ID once when enqueueing; don't generate a new ID for each HTTP attempt.
- Map `type: memory` to `kind: scripted_memory`, `resident_id` to `resident`,
  `data.text/importance/place` to those fields, and `data.scene/cue` to `scene_id/cue_key`.
  Send resolved first-person text and concrete resident IDs (resolve the dynamic arrival alias).
- Map `type: regard` similarly to `scripted_regard`, with `data.delta`.
  Cue identity is world + kind + scene_id + cue_key, independent of the event ID.
- Map world events to `town_event` with `participants`, `place`, and the exact authored importance:
  scuffle 7, project_open 6, sweeping 2. The GDD mentions a table but supplies only these values.
- Send `flags` with the full current bare-name flag array and a persisted, monotonically increasing
  `revision` (start at 1). Full snapshots repair a missed delta, represent removals, and sort/deduplicate
  before storage. Older/equal revisions under new IDs are rejected; retries with the original ID are duplicates.
  Preserve the revision with local saves; server snapshots preserve it and receipt history when branching.
- Remove acknowledged accepted/duplicate IDs from the queue. Inspect rejected records; don't silently
  discard unknown residents, invalid payloads or unsupported placeholders. An obsolete flags snapshot may be
  superseded by the latest revision. Split longer logs across /events requests before calling night.
- `dream_stage {resident, stage}` (the Journal's Quests, client/src/quests): a stage of the resident's dream is done,
  `stage` counting the stages done. The client checks the stage's conditions (shared/src/dreams.ts; Quiet Mode too);
  the server raises `ResidentState.dream.stage` to it (never lowers it, never past the card's stages), so the prompt's
  dream stage moves on, and writes the resident a memory of the help (importance 5, GDD-GAP). Receipts dedupe per
  resident and stage. Its Regard comes as a `scripted_regard` cue (`dream` / `<resident>:<stage>`).
- A dream stage's Favor (`dream_<resident>_<stage>_<window>`) is rebuilt on `favor_choice` from its id, the card and
  `offered_day` (favorFeasibility.ts restoreDreamFavor), as Quiet Mode's chores are.
- Gift and community_work are implemented (G-09). Gifts use catalog tags and card preferences, with a
  resident/day receipt as well as the event-id receipt, and apply Regard outside the talk ledger.
  Community work validates the task, opening day, time and place, then writes a town event and witnessed memories.
- Invalid economy events produce explicit rejections with no
  receipts or effects. Shared-meal events validate the meal tag, grant +2 Regard outside the talk ledger,
  and deduplicate by event id; they do not consume the daily gift allowance.

## Engine behavior and design gaps

Witnesses use stored plans for the event's day, otherwise the same routine template used by encounters.
Active blocks are start-inclusive/end-exclusive; sleep and nap do not witness. Participants get one `did`
memory regardless of location; other witnesses get one `saw`, linked to the event. No participant gets both.
Importance is validated against the authored type value, never chosen by the client.

GDD-GAP: sight distance and live server positions are not specified. The MVP uses a 6-tile Euclidean distance
between authored zone place doors, only within one zone. Exact-place matches work without mapped coordinates;
offmap places never confer sight. This approximates presence, not live pathing or wall occlusion.
GDD-GAP: event/scripted memory valence is unauthored, so use 0 until reflection interprets it.
GDD-GAP: scripted Regard has no per-cue bound; shared friendship rules clamp the delta to ±100 and
the result to −100..100. Scripted changes do not touch the daily talk ledger.
GDD-GAP: request/flag limits are operational bounds, not authored game rules.

World story flags now feed `loadResidentPrefix` for both prewarm and dialogue, and `NightWorld.flags` for
reflection, plan and encounter prompts. Existing engine evaluators handle canon `while:` conditions and
secret reveals. Sorted flags and unchanged prompt templates preserve byte-stable blocks 1–3 for unchanged state.
No new retrieval algorithm is needed: the linked witnessed memory already enters the top-eight scorer.
