# Budget guard and free-text safety (M-12 / M-13)

Apply migration `0009_m12_m13_budget_safety` with the existing migration command before starting the server. It was generated with `npm run db:generate -w @monde/server -- --name m12_m13_budget_safety`.

Environment:

- `WORLD_DAILY_BUDGET_USD`: positive USD target per authoritative in-game world day; default `0.06` (§9.15). Ambient calls stop at 100%, Acquainted plans at 150%, other calls at 200%. Live Core dialogue and its required precheck remain available at the world limit.
- `GLOBAL_DAILY_BUDGET_USD`: nonnegative hard USD limit for a UTC calendar day; default `10` (**GDD-GAP**, no global number specified). Zero disables all charged calls, including Core dialogue.
- `ADMIN_TOKEN`: optional secret. Unset means both `/admin` and `/admin/costs.json` return 404. Use `Authorization: Bearer <token>`; `?token=` is also accepted, but bearer authentication avoids secrets in URLs. No client bundle is served.

The guard reserves a conservative input-byte/output-token cost under a database row lock before each request, including hedges and retries. Successful calls replace their reservation with actual usage; unknown-cost failures retain reservations conservatively. Existing ai_log and world counters also count toward admission. Live calls use the server's world day; background jobs use their trusted source day, since the night claim advances the world before work finishes. The global ceiling checks the reservation before admission. The GDD's world percentages are spend thresholds, so one admitted call may cross a threshold. Reservations left by a process crash remain charged for that day; they do not silently reopen the budget.

The admin view groups new call costs/reservations by world, game day, and kind; it also shows today's global spend, cap, capped worlds, and stored reports. Historical ai_log entries lack game days and cannot be reliably retroactively attributed. Existing entries continue to count toward the global cap. Spend is only displayed to administrators. Players get a Quiet Mode status without a cost warning.

Free text first passes normalized local safety rules. Locally rejected text never calls the model. Other free text receives the tiny structured Haiku precheck required by §9.13, with thinking disabled. A malformed result, refusal, timeout, or unavailable model fails closed. The check runs before dialogue so unsafe input never reaches the resident. **GDD-GAP:** 64 output tokens and 750 ms timeout; §9.16's end-to-end first-character p50 0.8 s / p95 1.5 s remain live-eval targets, not proven by unit tests. Safe calls keep the existing byte-stable resident prompt prefix. Rejected input is stored for reporting but redacted from subsequent resident context and summaries.

Safety responses stay in town; self-harm responses point to Priya, friends, and the clinic. **GDD-GAP:** rude/abusive input receives a -1 authored Regard judgment through the existing talk clamps (the independent first-chat bonus can offset it).

Report line immediately replaces the displayed turn, then posts its conversation ID and turn index. The server copies authoritative stored lines and input into `reported_turns`; it does not trust client-supplied text. World-token authorization applies. **GDD-GAP:** ten distinct reports per world per UTC day; repeats within the day are idempotent. Reasons are limited to 500 characters. Reports appear only behind ADMIN_TOKEN and are HTML-escaped. No report-retention interval is specified by §9.13; this change does not delete review evidence automatically.

The regression set covers 45 locally caught red-team inputs. It does not replace §9.16's 300-input live safety evaluation or other release bars.
