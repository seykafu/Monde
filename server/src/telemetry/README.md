# Q-06 telemetry

The title's first Settings visit asks once; sharing defaults off. The same toggle is available from pause Settings. A separate random installation ID and consent choice live in guarded localStorage. Desktop storage is independent. The queue keeps at most 200 events, sends 25 at a time every 30 seconds and at dawn, and drops a batch after three failed attempts. Opt-out clears unsent events and aborts the current request (already received data cannot be recalled). Survey cards are claimed once per installation, including skips; restoring an old save does not repeat them.

Apply the generated `0008_q06_telemetry.sql` with the normal server migration command. POST `/v1/telemetry` accepts a random installation ID alone. When `world_id` is supplied its world bearer token is required. Strict schemas reject unknown fields at every level, and the route has a 64 KiB body limit, 25-event batch limit, and bounded process-local 12-batch/minute/install limiter. UUID event receipts make retries idempotent; survey rows are committed in the same transaction. These operational limits are GDD gaps, not new game rules.

Export with:

```
DATABASE_URL=... npx tsx tools/export-telemetry.ts /path/to/private/output
```

This writes `events.csv`, `survey-answers.csv`, and `summary.json`. CSVs include installation ID, nullable world ID, event ID, and timestamps. The summary states denominators and limitations: opt-in coverage, missed events, dawn-only Appeal sampling, unfinished puzzles, and late opt-ins excluded from retention. Offline playthroughs share an installation cohort. AI log summaries are joined by world ID, with no duplicate AI events or raw AI text exported. Existing logs do not identify first attempts or exact in-game billing days, so those statistics are labeled proxies, not the exact §3 criteria. Confirmed safety incidents need the separate incident process. Spreadsheet formula prefixes in free-text CSV cells are escaped.

## L-02 privacy disclosure needed

Explain voluntary opt-in, default-off behavior, how to opt out, local choice/ID/queue storage, the event categories and milestone surveys, and that skipped questions are allowed. Explain that the optional Spring note is transmitted verbatim and may contain personal information; ask players to omit it. No player names, invite codes, dialogue text, or other typed input is collected by this feature.

The installation ID is pseudonymous and persistent. World IDs allow correlation with existing server AI logs (including pre-consent logs in an operator export); do not promise absolute anonymity or imply those existing logs are governed by this toggle. HTTP infrastructure may separately log IP addresses. Disclose the actual hosting/processors, purpose, access controls, retention/deletion policy, and contact/request procedure before release. This implementation does not invent a retention period or automatically delete already received data on opt-out. Exported notes and linked world IDs must be treated as restricted playtest data, not published as anonymous raw records.
