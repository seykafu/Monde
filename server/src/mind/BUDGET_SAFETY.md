# Budget guard and free-text safety (M-12 / M-13)

Apply migration `0009_m12_m13_budget_safety` with the existing migration command before starting the server. It was generated with `npm run db:generate -w @monde/server -- --name m12_m13_budget_safety`.

Environment:

- `WORLD_DAILY_BUDGET_USD`: positive USD target per authoritative in-game world day; default `0.06` (§9.15). Ambient calls stop at 100%, Acquainted plans at 150%, other calls at 200%. Live Core dialogue and its required precheck remain available at the world limit.
- `GLOBAL_DAILY_BUDGET_USD`: nonnegative hard USD limit for a UTC calendar day; default `10` (**GDD-GAP**, no global number specified). Zero disables all charged calls, including Core dialogue.
- `ADMIN_TOKEN`: optional secret. Unset means both `/admin` and `/admin/costs.json` return 404. Use `Authorization: Bearer <token>`; `?token=` is also accepted, but bearer authentication avoids secrets in URLs. No client bundle is served.

The guard reserves a conservative input-byte/output-token cost under a database row lock before each request, including hedges and retries. Successful calls replace their reservation with actual usage; unknown-cost failures retain reservations conservatively. Existing ai_log and world counters also count toward admission. Live calls use the server's world day; background jobs use their trusted source day, since the night claim advances the world before work finishes. The global ceiling checks the reservation before admission. The GDD's world percentages are spend thresholds, so one admitted call may cross a threshold. Reservations left by a process crash remain charged for that day; they do not silently reopen the budget.

The admin view groups new call costs/reservations by world, game day, and kind; it also shows today's global spend, cap, capped worlds, and stored reports. Historical ai_log entries lack game days and cannot be reliably retroactively attributed. Existing entries continue to count toward the global cap. Spend is only displayed to administrators. Players get a Quiet Mode status without a cost warning.

Free text first passes normalized local safety rules. Locally rejected text never calls the model. Other free text receives the tiny structured Haiku precheck required by §9.13, with thinking disabled. A verdict other than fine, a refusal or a malformed result holds the line back; a timeout or an API error lets it through (the local rules have run, and the reply's own validators still apply), as does a server with no model. The check runs beside the dialogue call and the reply's lines are held until it clears, so an unsafe line's reply never reaches the player and isn't recorded; a fine line adds no wait. **GDD-GAP:** 64 output tokens and 750 ms timeout; §9.16's end-to-end first-character p50 0.8 s / p95 1.5 s remain live-eval targets, not proven by unit tests. Safe calls keep the existing byte-stable resident prompt prefix. Rejected input is stored for reporting but redacted from subsequent resident context and summaries.

Safety responses stay in town; self-harm responses point to Priya, friends, and the clinic. **GDD-GAP:** rude/abusive input receives a -1 authored Regard judgment through the existing talk clamps (the independent first-chat bonus can offset it).

Report line immediately replaces the displayed turn, then posts its conversation ID and turn index. The server copies authoritative stored lines and input into `reported_turns`; it does not trust client-supplied text. World-token authorization applies. **GDD-GAP:** ten distinct reports per world per UTC day; repeats within the day are idempotent. Reasons are limited to 500 characters. Reports appear only behind ADMIN_TOKEN and are HTML-escaped. No report-retention interval is specified by §9.13; this change does not delete review evidence automatically.

Migration `0010_report_kinds` (apply it like 0009) gives every report a `kind` (the body contract is `shared/src/reports.ts`); a body without `kind` is a dialogue report, exactly as before:

- `dialogue`: `conversation_id`, `turn_index` (the dialogue panel, and a story scene's live `{ai_line}`).
- `press`: `day` and `story` (the story's index in the stored edition, or `"front"` for the headline and dek), with the story's `event_id` as a cross-check. Only an edition the model wrote (`source: "model"`) is reportable; template editions are authored lines and engine records. The server stores its own title and text.
- `letter`: `letter_id`. Only reflection letters (`letter_<resident>_<day>`, the only letters the server writes, all model-written) that were delivered are reportable; the server stores the writer, day and text.
- `other`: a `ref` and the client's `text`, stored as sent and shown as unverified (nothing uses it yet).

Papers and delivered letters aren't copied into a restored world's snapshot, so press and letter lookups search the world and the worlds it was restored from, nearest first. The ten-a-day limit counts every kind together. `/admin` shows the queue as a table (kind, time, world, item, text, reason) and `/admin/costs.json` lists each report with its kind first and counts by kind.

The client (`client/src/press/report.ts`) puts a small Report on each model-written item of the paper (stamped at print time against the server's copy, so the client's own authored inserts aren't reportable) and on each reflection letter in Letters to the Lantern; letters to the Fellow have no screen yet. A first press arms it, a second hides the item at once behind an authored line in the Lantern's voice (**GDD-GAP:** §9.13 has no confirm step; the paper closes on any other tap). The reported keys go into the save (`friendship.reported`) and are merged into the last save written or loaded (the dawn autosave Continue reopens), so a reload doesn't bring the item back. A failed send keeps it hidden. A story's live `{ai_line}` gets the same Report beside Log (or R twice), which swaps in the cue's authored `{fallback}`. Chatter speech bubbles have no Report: they float over the board and fade on their own.

The regression set covers 45 locally caught red-team inputs. It does not replace §9.16's 300-input live safety evaluation or other release bars.
