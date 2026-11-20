# Monde server runbook

Operations for monde-mind on Fly.io. For Kasey and for coding agents. All commands use the staging app, `monde-mind-staging`.

## Residents are all speaking written lines

### What it means

The AI is down, so the server stopped calling it. The game switched to offline Quiet Mode:

- Residents speak pre-written lines.
- The dialogue panel says "offline · written lines".
- The HUD dot says "offline". Hover text: "The town's mind is resting, so residents speak written lines. Trying again shortly."

The game keeps working. The server retries about once a minute.

### How you find out

1. The hourly GitHub Actions check "Hourly mind health" fails, and GitHub emails Kasey.
2. If `ALERT_WEBHOOK_URL` is set on Fly (a Slack or Discord incoming webhook), the server posts a message when it switches to written lines, when it switches to the backup key, and when it recovers.
3. The nightly soak fails if more than 10% of turns were written fallbacks. It only runs once the GitHub secrets `MONDE_INVITE_CODE` and `ADMIN_TOKEN` are set.

### Step 1: check health

```bash
curl -s https://monde-mind-staging.fly.dev/v1/health
```

Read `checks.mind`:

| Value | Meaning | Do this |
|---|---|---|
| `ok` | Fine | Nothing |
| `unchecked` | No call has answered since boot | Talk to a resident, or wait a minute |
| `key_rejected` | Anthropic rejected the API key (401 or 403) | Replace the key (below) |
| `no_credit` | The Anthropic account balance is too low | Add credit (below) |
| `error_rate` | More than 20% of calls failed in the last minute | Usually an Anthropic outage; check https://status.anthropic.com |
| `off` | No key is configured at all | Set the key (below) |

`checks.mind_key` is `primary` or `backup`. `backup` means the primary key was rejected or out of credit and the server switched. Replace the primary soon.

### Step 2: read the logs

This needs a Fly login. The browser approval expires within minutes, so approve it right away.

```bash
~/.fly/bin/flyctl auth login
```

```bash
~/.fly/bin/flyctl logs -a monde-mind-staging --no-tail | grep -i anthropic
```

Error lines say "Anthropic rejected the API key" or "Anthropic API call failed", with the status, error type and request id. The key itself is never logged.

### Fix: key_rejected

Create a new key at console.anthropic.com, under API Keys. Then run this. It asks for the key without showing it or saving it in shell history, then restarts the server. If it times out, run it again.

```bash
read -rs -p "Paste the new Anthropic key: " K; echo; printf 'ANTHROPIC_API_KEY=%s\n' "$K" | ~/.fly/bin/flyctl secrets import -a monde-mind-staging; unset K
```

Then re-run the health check until `checks.mind` is `ok`. It may say `unchecked` for a few seconds after the restart.

### Fix: no_credit

Add credit, or raise the limit, in the Anthropic Console under Billing. No restart is needed. The server retries about once a minute and recovers on its own.

### Fix: error_rate

Usually wait it out and watch the Anthropic status page. It recovers by itself. If it lasts more than an hour and Anthropic reports no incident, read the logs for the error type.

### Backup key and alert webhook

The command shape is the same. Replace the variable name:

- `ANTHROPIC_API_KEY_BACKUP` sets the backup key. Make it a separate key, ideally in a separate Anthropic workspace with its own spend limit. Never reuse the primary key.
- `ALERT_WEBHOOK_URL` sets the alert webhook. It must be an https URL.

### Gotcha: stale secrets

Fly once kept an old secret on a running machine after an update. If health still shows the old state a few minutes after you set a secret, list the machines and tell the coding agent.

```bash
~/.fly/bin/flyctl machine list -a monde-mind-staging
```

The fix is to clone the machine and destroy the stale one.

## Other checks

| What | Command or place | Notes |
|---|---|---|
| Server health | `curl -s https://monde-mind-staging.fly.dev/v1/health` | See the table above |
| Costs per world and day | `curl -s -H "Authorization: Bearer $(cat ~/.config/monde/admin_token.txt)" https://monde-mind-staging.fly.dev/admin/costs.json` | Needs `ADMIN_TOKEN`. Send it as an `Authorization: Bearer` header (preferred) or `?token=`. The `/admin` page uses the same auth, so a plain browser visit returns 401 |
| Hourly check | GitHub repo, Actions tab, "Hourly mind health" | Use "Run workflow" to run it now |
| Spending caps | Fly secrets `WORLD_DAILY_BUDGET_USD` and `GLOBAL_DAILY_BUDGET_USD` | Defaults: 0.06 USD per world per day, 10 USD per day across the whole server |

Production will get its own URL at launch (MVP task L-01). This runbook covers staging until then.
