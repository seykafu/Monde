# Monde MVP: Implementation Plan ("Spring in Monde")

**Version** 0.1 · **Date** 2026-10-14 · **Owner** Kasey · **Plan author** Claude Opus 5.5 (orchestrator)
**Source of truth for design:** [`docs/MONDE_GDD.md`](MONDE_GDD.md). This plan decides *what we build first
and in what order*. Section references (§) point at the GDD.

---

## 1. Summary

Ship **"Spring in Monde"**: the first 25 days of the game (Spring, Acts I–II up to the Bloom Fair) as a
**free, invite-only web playtest on itch.io in about 12 weeks**, then open it to the public if it clears
the bars in §3.

It contains the full core loop (Projects, riddles, puzzles, Scuffles, community work, the Dawn Report,
arrivals and departures) in four districts, with **live Haiku residents**, the most important and
riskiest part of Monde. The election is out of scope, but the MVP ends with a **Spring Straw Poll** at
the Bloom Fair that runs the real voter model (§10.3): "if the town voted today…". That gives players
an ending and lets us test the election math early.

| Number | Target |
|---|---|
| Time to closed playtest | 12 weeks (13 to a public go/no-go) |
| Playable span | Days 1–25, about 7–9 hours (25 days × 15 real minutes, plus paused time in dialogue and puzzles) |
| Districts | Old Quarter, Market Row, the Wharf, the Commons, plus ~10 interiors |
| Live residents | All 210 simulated; 112 live in the open districts, and the rest visit on their routines |
| Scenes / riddles / puzzles | S01–S10 · 25 Marks + 6 Tib riddles · 9 puzzles + 2 procedural |
| AI cost target | ≤ $0.09 per in-game day (stretch $0.06), so ≤ $2.25 per finished Spring |
| Playtest cash budget | ≈ $1,000 (API + hosting), detailed in §9 |

---

## 2. Why this MVP

The game has one big bet: **AI residents make a cozy town worth living in.** Everything else (the
diorama renderer, combat, the art pipeline) is either already proven in Ravage or standard work. So the
MVP is built to answer these questions, in this order:

1. Do players *want* to talk to the residents, and keep wanting to?
2. Can we run them fast, safely and cheaply enough?
3. Does watching the town come back feel good?
4. Are the riddles and puzzles fair and satisfying?

Days 1–25 answer all four without building Millbrook, Station Hill, Briar Woods, the campaign or 75
more days of scripts. If the answers are good, the rest of the game is mostly content on top of systems
that already work.

**Alternative considered:** a compressed full arc (all 100 days squeezed into 30, with the election).
It tests the ending, but needs nearly every system and zone, roughly doubles the timeline, and dilutes
the AI test. Rejected for the first ship; the Straw Poll covers the election math.

---

## 3. Success criteria (the playtest must show)

| # | Hypothesis | Metric | Bar |
|---|---|---|---|
| H1 | Residents are the content | Finishers who'd "talk again" to at least 3 named residents (end survey) | ≥ 60% |
| H1 | | Conversations per in-game day (median) | ≥ 6 |
| H1 | | Players who reach Day 10 / Day 25 | ≥ 55% / ≥ 30% of starters |
| H2 | It's affordable and fast | AI cost per in-game day (fleet mean) | ≤ $0.09 |
| H2 | | Dialogue first character, p50 / p95 | ≤ 0.8 s / ≤ 1.5 s |
| H2 | | Shipped safety incidents (reported and confirmed) | 0 |
| H2 | | Model output passing validation first time | ≥ 99.5% |
| H3 | The town coming back feels good | "I could see the town change" (survey, agree) | ≥ 70% |
| H3 | | Players reaching Appeal 35 by Day 10 | ≥ 60% |
| H4 | Riddles and puzzles are fair | Marks solved using at most hint 2 | ≥ 80% |
| H4 | | Puzzles abandoned (opened, never solved) | < 15% |
| H5 | The election model is plausible | Straw Poll results spread across players (not all landslides) | std dev of player share ≥ 8 pts |

**Go / no-go for a public build (week 13):** H1 and H2 must pass. H3–H5 can be partial if there's a
clear fix.

---

## 4. Scope

### 4.1 In

| Area | In the MVP |
|---|---|
| **Districts** | Old Quarter, Market Row, The Wharf, The Commons (opens D6). Interiors: player cottage, bakery, pub, café, library, mayor's office, Lantern office, clock shop, clocktower stair, boathouse, lighthouse lantern room. |
| **Story** | S01–S10 (§13.3): The Ferry → Monde's Marks → Tolls → Water Again → First Arrival → The Man in the Good Coat → Quarter Chime → The Option + Pell's Confession → Bloom Fair. Then the **Spring Straw Poll** and an End-of-Spring report. |
| **Core residents** | Pell, Margo, Tib, Odile, Bertrand, Roz, Sable, Nell, Kasimir, June, Teo, Augusta, Vane (visits Tue/Thu/Sat), Rook (watches; S03), Bastien. Featured: Bru, Nettie, Moss, Ada. |
| **Everyone else** | All 192 generated Day-1 residents are simulated. Millbrook and Station Hill residents walk into the open districts on their routines (shopping, the pub, the market), so they can be met. Their home districts are closed: "road works on the Millbrook road." |
| **AI layer (§9)** | Persona cards, memory, plans, reflections, live dialogue (streaming), gossip (summary mode; live only within earshot as a stretch goal), Favors (fetch, deliver, find, introduce, help_chore, last_chance), the Dawn Report, letters, guardrails, the free-text pre-check, Report line, Quiet Mode, the budget guard, cost logging. |
| **Town systems (§6)** | Pillars, Appeal with Momentum, arrivals (ferry days) and departures (Stay, Leaving Notice, Last Chance), the Option Clause gauge, the Town Fund, housing (the 17 vacant homes in the open districts). |
| **Projects** | `fountain`, `bakery_ovens`, `streetlights`, `community_garden`, `market_hall`, `homes`, `lighthouse` (stretch). Clocktower restart via the OQ chain + PZ-15. |
| **Riddles (§14)** | OQ-1–5, MR-1–5, WF-1–5 (WF-4/5 only if `lighthouse` ships), CM-1–4; Tib's T-01–T-06. |
| **Puzzles (§15)** | PZ-01, 02, 03, 04, 06, 13, 15, 18, plus PZ-05 with the lighthouse. Procedural: Mail Round, Library Returns. |
| **Scuffles (§7)** | `sc_bakery_tutorial`, `sc_market_saturday`, `sc_bins_raccoons`; the Tollmen level system; allies Augusta, Kasimir, Nell. |
| **Player (§11)** | The Fellowship form (character creation, all four backgrounds), skills, Stamina, meals, coins, inventory, gifts, 6 community-work tasks, the cottage (no upgrades). |
| **Friendship (§9.11)** | Hearts for Regard with the earning table and daily cap, model-judged replies, heart feedback in dialogue; NPC↔NPC labels (Acquaintances → Close friends, Rivals, Enemies), encounters in summary mode, emotes, the People page, Dawn Report milestones (D16). |
| **Romance** | The ladder up to Courting (§9.11). Weddings come later. |
| **Platform** | Web build (desktop Chrome, Edge, Firefox, Safari) on itch.io. Mouse and keyboard. 3 save slots. |

### 4.2 Out (for later milestones)

Millbrook, Station Hill and Briar Woods as playable zones · S11–S23 · the campaign, debate and election
(the Straw Poll stands in) · Projects beyond the list above · PZ-07–12, 14, 16, 17, 19, 20 · the MB, SH and
LN riddle chains · weddings · Greyline and the evidence chain · Steam, desktop wrapper, controller ·
localization · pgvector memory (keyword retrieval is enough) · Batch API for arrivals (live calls with a
buffer are fine at MVP volume).

---

## 5. Architecture for the MVP

The MVP is the GDD's architecture (§9.2, §19), trimmed:

```
client/  Phaser 3 + TS + Vite   (Ravage render + combat ported; new world/sim/town/mind/story)
server/  monde-mind on Fly.io   (Fastify + TS; one region, iad; Postgres + Upstash Redis + Tigris)
shared/  zod schemas            (PersonaCard, Plan, DialogueTurn, Reflection, Memory, TownEvent, Favor)
content/ YAML + script .md      (cards, places, archetypes, line library, scenes S01–S10)
tools/   verify_puzzles.py, card linter, script compiler
```

- **Model:** `claude-haiku-5-5`, called with the settings in §9.17 (no sampling params, no prefill,
  structured outputs, thinking disabled for dialogue).
- **Auth:** an anonymous device key plus an **invite code** for the closed playtest. The server refuses
  to create new worlds past the invite cap.
- **Cost controls from day one:** the per-world budget guard (§9.15), a **global daily spend cap**
  (everything goes to Quiet Mode when it's hit), an Anthropic workspace with a monthly spend limit, and
  `ai_log` on every call.

---

## 6. How the work runs

| Role | Who | Does |
|---|---|---|
| Creative director | **Kasey** | Approves scope, the style bible, card spot-checks and copy; plays every gate build; decides open questions |
| Orchestrator and reviewer | **Claude Opus 5.5** | Turns these tasks into focused Codex tasks, reviews every change (typecheck, tests, capture screenshots), owns the AI layer's prompts, validators and evals |
| Heavy implementation | **GPT-6 Astra via Codex** (`/codex:rescue`) | Most engine, client and server tasks below. Each task has named files and acceptance criteria. |
| Integration-heavy implementation | **Claude Opus 5.5** subagents | The prompt builder, reflection/plan jobs, the voter model, cross-cutting fixes |
| Art | **GPT-6 image generation** through the Codex CLI | Everything in §7 Phase A, through the Ravage-style `scripts/art/` pipeline |
| Writing | **Claude Sonnet 5.5** | Extracting cards and scenes into `content/`, Quiet Mode tuning, Dawn Report templates, store and survey copy |
| Runtime | **Claude Haiku 5.5** | Residents, the press, arrival personas |

**Loop per task:** Opus writes the Codex task → Codex implements → Opus reviews (diff, `tsc`, `vitest`,
capture screenshots for anything visual) → fixes → commit and push to `main` (trunk-based, auto-push).
**CI on every push** (GitHub Actions): typecheck, lint, vitest, `verify_puzzles.py`, the script
compiler, the card linter, and a production build. A red CI blocks the next task in that area.

**Gates:** every 2–3 weeks there's a playable build Kasey plays (G1–G6 below). Nothing moves to the
next phase until its gate passes.

---

## 7. Phases and tasks

Owners: **CX** = Codex (GPT-6 Astra) · **OP** = Opus · **SN** = Sonnet · **IMG** = GPT-6 images ·
**K** = Kasey. "Dep" = depends on.

### Phase K: Before week 1 (Kasey, about 1 hour)

| ID | Task | Why |
|---|---|---|
| K-01 | Create an Anthropic API **workspace** for Monde with a **monthly spend limit** ($300 during dev, raised to $1,000 for the playtest), and keep the key ready to paste into Fly secrets | Server-side only; the key never goes in the client |
| K-02 | `fly auth login` (the CLI is installed at `~/.fly/bin/flyctl` but logged out) and confirm billing on the org | Staging deploy in week 1 |
| K-03 | Create the itch.io project as a **restricted/draft** page; install `butler` | Upload pipeline |
| K-04 | Decide the **music source**: commission, license a pack, or reuse Ravage-era tracks you own | Week 8 audio pass |
| K-05 | Approve this plan's scope (or tell me what to change) | Everything below |

### Phase F: Foundation (weeks 1–2)

| ID | Task | Owner | Dep | Done when |
|---|---|---|---|---|
| F-01 | Scaffold npm workspaces `client/ server/ shared/ content/`; TS strict, ESLint, vitest; `.claude/launch.json` dev configs | CX | none | `npm run dev` serves a blank Phaser scene; `npm test` runs |
| F-02 | Port Ravage `render/` (Projection, ObliqueProjection, keystone, depth, sun, BloomPipeline, elevation, pick) **with its tests** | CX | F-01 | Ravage's render tests pass in Monde |
| F-03 | Port Ravage `combat/` core with tests (Grid, Initiative, Actions, Stances, Damage, AI, Victory) | CX | F-01 | Tests pass; no Phaser imports in `combat/` |
| F-04 | Port Ravage UI, audio and asset basics: Button, Panel, fitText, voice blip, Music, Sfx, manifest + procedural fallbacks, StoryScene typewriter | CX | F-01 | A test scene shows a paged VN line with a blip |
| F-05 | `shared/` zod schemas from §9 (PersonaCard incl. `portrait_expressions` and `beliefs`, ResidentState, Plan, DialogueTurn, Reflection, Memory, TownEvent, Favor) with JSON Schema export for structured outputs | OP | F-01 | Schemas compile; JSON Schema snapshots committed |
| F-06 | CI workflow (typecheck, lint, vitest, `verify_puzzles.py`, build) | CX | F-01 | Green on `main` |
| F-07 | `server/` Fastify skeleton, `fly.toml`, Postgres + Upstash Redis + Tigris provisioned, migrations tool, `/v1/health`; staging app `monde-mind-staging` | CX | F-01, K-02 | `curl …/v1/health` returns OK from Fly |
| F-08 | Content tooling: the script compiler for §13.1 (S01 only to start), the persona card linter, place registry as YAML | OP | F-05 | CI compiles S01 and lints Pell's card |

**Gate G1 (end of week 2):** CI green; the diorama renders an Old Quarter test map; staging health is live.

### Phase W: A walkable town (weeks 2–4)

| ID | Task | Owner | Dep | Done when |
|---|---|---|---|---|
| W-01 | Zone format: Tiled JSON with elevation, collision, place markers, doors and zone-edge links; loader into the diorama | CX | F-02 | A Tiled map renders with elevation and passes Ravage's playability invariants |
| W-02 | Player controller: 8-way movement, collision, interact prompt, camera follow, zone transitions with fade | CX | W-01 | Walk between two test zones |
| W-03 | Greybox the 4 districts + 11 interiors with **every MVP place id** from §9.5 | CX | W-01 | A test asserts every MVP place id exists in a map |
| W-04 | Clock (§5.3), sun shadows following the clock, night lighting, weather states + overlays, daily tide and wind tables | CX | W-01 | A full day/night cycle in 15 real minutes; rain and fog overlays |
| W-05 | Nav grid + A* + zone graph; NPC actors; **routine executor** (plans → movement; off-screen abstraction at 1 Hz) | CX | W-03, W-04 | 30 placeholder NPCs follow template routines through a whole day without getting stuck |
| W-06 | Local save slots + dawn autosave (client state) | CX | W-05 | Save, quit, reload mid-day and everything is where it was |
| W-07 | Character creation as the Fellowship form; paper-doll sprite composer (placeholder layers) | CX | W-02 | All fields from §11.1; the sprite updates live |

**Gate G2 (end of week 4):** Kasey walks all four districts at day and night, watches the town go about
its day, and makes a character.

### Phase M: Living residents (weeks 3–7), the critical path

| ID | Task | Owner | Dep | Done when |
|---|---|---|---|---|
| M-01 | DB schema (worlds, residents, relationships, memories, events, plans, favors, letters, dialogue_turns, ai_log, snapshots) and **world creation from the Day-1 template** | CX | F-07, F-05 | `POST /v1/worlds` clones the template in < 2 s |
| M-02 | Move the MVP core and featured cards from §12.2/§12.4 into `content/residents/*.yaml`; the linter passes | SN → OP review | F-08 | 19 cards lint-clean, reciprocal relationships verified |
| M-03 | **Generate the 192 Day-1 residents** with Haiku from the Appendix A quotas (portrait-first, A.3 prompt); curation sheet; Kasey spot-checks 30 | OP + SN, K | M-02, A-05 (tags) | 192 cards lint-clean; Kasey signs off the sample |
| M-04 | **Prompt builder**: World Bible, persona, beliefs and dynamic blocks; byte-stable serialization; `cache_control` breakpoints; prompt versioning | OP | F-05 | A unit test proves blocks 1–3 are byte-identical across turns; cache reads appear in staging logs |
| M-05 | **Dialogue**: WebSocket streaming, structured output, the 5-step validation pipeline (§9.13), deadlines and fallbacks, effect clamps; client VN dialogue scene with streaming typewriter, choices, "Say something…", Gift, Report line | OP (server) + CX (client) | M-01, M-04, F-04 | Talk to Pell on staging; first character ≤ 1.5 s; a forced bad output falls back cleanly |
| M-06 | Memory: client event batching, witnessing, retrieval scoring (§9.6), end-of-conversation summaries | CX | M-01 | Residents mention yesterday's event in conversation (manual test script) |
| M-07 | **Reflections and plans**: evening reflection → next-day plan, LOD tiers, the night pass with its 4 s budget, template fallback | OP | M-04, W-05 | 3 in-game days run with live plans; the night pass is always ≤ 4 s |
| M-08 | Gossip in summary mode + propagation | CX | M-06 | A Scuffle on Market Row is known at the Wharf within 2 days |
| M-09 | Favors (6 templates) + feasibility checks + Journal tab | CX | M-07 | 20 generated Favors in a soak test are all completable |
| M-10 | Dawn Report: press job + newsprint UI (§6.6) | CX + SN | M-06 | The front page reflects yesterday's real events |
| M-11 | **Quiet Mode**: Appendix B line library, picker with no-repeat windows, template routines and Favors, offline event log + sync | CX | M-05, M-07 | Unplug the network on Day 3 and play to Day 5 without a dead end |
| M-12 | Budget guard (per world + global cap), `ai_log`, and an `/admin` cost page | CX | M-05 | Hitting the cap flips a world to Quiet Mode; cost per world-day is visible |
| M-13 | Free-text pre-check, Report line review queue | OP | M-05 | Red-team inputs are handled in-world |
| M-14 | Prewarm on proximity (§9.10) | CX | M-04 | Cache read on the first turn in ≥ 80% of conversations |

**Gate G3 (end of week 7):** Days 1–5 playable with live residents. Eval v0: persona score ≥ 4.0,
validation ≥ 99%, p95 ≤ 2 s. First real cost per in-game day measured.

### Phase G: The gameplay loop (weeks 4–9)

| ID | Task | Owner | Dep | Done when |
|---|---|---|---|---|
| G-01 | Town engine: Pillars, drift, community-work cap, Appeal + Momentum (§6.1–6.2); Town Ledger UI | CX | W-06 | Unit tests reproduce the Day-1 numbers in §6.2 |
| G-02 | Migration: Stay, Leaving Notice, Last Chance, arrivals on ferry days, arrival persona generation with a buffer, library portrait assignment | CX + OP | G-01, M-03 | A 25-day mock soak produces plausible arrivals and departures |
| G-03 | Projects framework (Fund, materials, VH, volunteers working on site, puzzle hooks, opening ceremony) + the MVP Projects | CX | G-01, M-09 | Every MVP Project completes in a scripted test |
| G-04 | Option Clause gauge, trigger and consequences (§6.5) | CX | G-02 | A forced census drop triggers the Wharf setback |
| G-05 | Riddle system: Marks, Journal, answer normalization and fuzzy match, hint ladder, **AI hint guard** (§14.2); OQ, MR, WF, CM content | CX, OP review | M-05 | A hint-guard test: 50 adversarial asks never leak an answer |
| G-06 | Puzzles PZ-01, 02, 03, 04, 06, 13, 15, 18 (+05): **one Codex task per puzzle**, with puzzle logic ported to TS and checked against `verify_puzzles.py` | CX | F-04 | Each puzzle's TS test matches the Python verifier |
| G-07 | Procedural puzzles: Mail Round, Library Returns (§15.21) | CX | W-05 | 1,000 generated instances all solvable |
| G-08 | Scuffles on town boards: tools triangle, stances, items, Talk Down, allies; the three MVP Scuffles; Tollmen level (§7) | CX | F-03, M-07 | The tutorial plays end to end; Tollmen level responds to wins |
| G-09 | Community work (6 tasks), Stamina, meals, coins, inventory, gifts | CX | G-01 | All six tasks pay and apply capped effects |
| G-10 | **Story runtime**: triggers, flags, `{ai_open}` and `{ai_line}` handoffs, memory writes; compile S01–S10 | CX + OP | F-08, M-05 | All ten scenes compile and play in order on a scripted run |
| G-11 | **Spring finale**: Bloom Fair (S10) → **Spring Straw Poll** (the §10.3 model with Day 25 data and a "Spring" framing) → End-of-Spring report screen → "To be continued" | OP (model) + CX (UI) + SN (copy) | G-10, G-01 | Soak runs give a spread of poll results (H5) |
| G-12 | Romance ladder to Courting + birthdays (light) | CX | M-07 | A seeded couple reaches Courting in a 25-day soak |
| G-13 | **Friendship** (§9.11.1–9.11.3, D16): `shared` friendship rules (hearts, labels, earning caps, neglect, drift); the reply rubric in the World Bible; daily cap and first-chat bonus on the server; applied Regard in the `turn` event; NPC↔NPC encounters from plans in the night pass (model-judged for Core/Acquainted pairs, rule for Ambient); heart feedback on the name plate; emotes; the People page | OP (server) + CX (client) | M-07, M-05 | A 25-day soak forms friendships and at least one rivalry among Core residents; talking well to one resident every day reaches Friend (4♥) by Day 10, and no resident gains more than +6 Regard a day from talk |

**Gate G4 (end of week 9):** Days 1–25 are playable start to finish, online and in Quiet Mode. The mock
soak passes on every commit.

### Phase A: Art and audio (weeks 2–10, in parallel)

| ID | Task | Owner | Dep | Done when |
|---|---|---|---|---|
| A-01 | **Style bible** in the cartoon direction (Fire Emblem × Stardew, GDD §16.1): 6 key backdrops + 4 master portraits (Pell, Odile, Tib, Rook) + a gameplay mockup. v1 (painterly) was superseded on 2026-10-14. | IMG + OP | none | **Kasey approves**; everything else uses these as references |
| A-02 | Port Ravage's art scripts (`gen_portrait_art`, `gen_anim_sheets`, `process_*`) to Monde, using `codex exec -m gpt-6-astra`; move `art_sources/` to **Git LFS** before bulk generation | CX | F-01 | One portrait and one sheet regenerate from source |
| A-03 | Tilesets and props for the 4 districts, plus Faded/Restored decals | IMG | A-01, W-01 | Greybox maps swapped to real tiles |
| A-04 | Portraits for the 15 MVP core residents + 4 featured (Bru, Nettie, Moss, Ada) × the standard 8 (+ signature expressions) | IMG | A-01 | Contact sheets pass the consistency check |
| A-05 | Library portraits for MVP: **40 masters × 3 color variants × 5 expressions** (600 images) with tags | IMG | A-01 | 120 identities tagged; M-03 can assign them |
| A-06 | Backdrops: 4 districts × day/dusk/night, 11 interiors × day/night, 9 puzzle close-ups | IMG | A-01 | All MVP scenes and puzzles have backdrops |
| A-07 | Sprites, 4 directions: player paper-doll layers; bespoke sheets for the core residents; resident layers subset (24 bodies, 12 hair, 16 outfits) | IMG + CX | A-02 | Every resident has a non-placeholder sprite |
| A-08 | UI art: Dawn Report newsprint, Journal, brass plaques, Pillar icons, emotes; fonts (§16.6) | IMG + CX | A-01 | UI pass in the G5 build |
| A-09 | Faded ↔ Restored color grade per district (§16.1) | CX | A-03, G-01 | A district warms visibly as its Projects finish |
| A-10 | Audio: 6 tracks (main, morning, market, wharf, night, Bloom Fair), ambience beds that scale with population, the town chime, tuned voice blips | K-04 + CX | none | Every MVP scene and district has music |

### Phase Q: Hardening (weeks 9–11)

| ID | Task | Owner | Done when |
|---|---|---|---|
| Q-01 | AI eval suite v1 (§9.16): a persona judge (Sonnet 5.5), the echo and repetition check, canon rules, a red-team set of 300 inputs; iterate cards and prompts until the bars pass | OP | Every §9.16 bar except cost and "would talk again" (those come from the playtest) |
| Q-02 | Soak bot: the mock mind on every commit; the real API nightly at low volume | CX | Nightly soak report in CI artifacts |
| Q-03 | Cost tuning to ≤ $0.09/day (the levers in §9.15) | OP | A staging soak measures under target |
| Q-04 | Performance: 60 fps with 60 residents on screen, zone load < 1.5 s, memory < 1.5 GB | CX | A perf capture on a mid-range laptop |
| Q-05 | Accessibility set: text size, typewriter speed, colorblind emotes, reduced motion, Choices only, Offline | CX | All settings work and persist |
| Q-06 | Telemetry (opt-in, anonymous gameplay events) + **in-game surveys** at Day 7 and End of Spring (they feed §3) | CX + SN | Events land in Postgres; survey answers export to CSV |
| Q-07 | Bug bash: three full internal playthroughs (Kasey + 2 friends) | K | No blockers open |

**Gate G5 (end of week 11):** a release candidate.

### Phase L: Ship (weeks 11–13)

| ID | Task | Owner | Done when |
|---|---|---|---|
| L-01 | Production deploy `monde-mind` (iad; autoscale workers; nightly Postgres backups; alerts for cost, latency and error rate) | CX | A production health check plus an alert test |
| L-02 | itch.io page: copy, capture-harness screenshots and GIFs, **AI disclosure** (§9.13), privacy policy (AI logs, telemetry, retention), invite codes | SN + CX, K approves | The page is approved and the build uploaded with butler |
| L-03 | **Closed playtest**: 50 invites in week 12, 200 in week 13; daily triage and a hotfix lane | OP + K | Dashboards and surveys collecting |
| L-04 | **Go / no-go** against §3 | K + OP | A written decision: open to the public, iterate, or rethink |

---

## 8. Schedule

| Week | Foundation / World | Living residents | Gameplay | Art & audio | Gate |
|---|---|---|---|---|---|
| 0 | K-01–K-05 | | | | |
| 1 | F-01–F-07 | | | A-01 start | |
| 2 | F-08, W-01, W-02 | M-01 | | A-01, A-02 | **G1** |
| 3 | W-03, W-04 | M-02, M-04 | | A-01 approval, A-03, A-04 | |
| 4 | W-05–W-07 | M-03, M-05 | G-01 | A-05, A-06 | **G2** |
| 5 | | M-05, M-06, M-07 | G-06 (×3), G-09 | A-05, A-06, A-07 | |
| 6 | | M-07, M-08, M-09, M-14 | G-02, G-03, G-06 (×3) | A-07, A-08 | |
| 7 | | M-10, M-11, M-12, M-13 | G-05, G-08, G-10 | A-07, A-10 | **G3** |
| 8 | | Eval v0 fixes | G-04, G-06 (rest), G-07, G-10 | A-08, A-09, A-10 | |
| 9 | | | G-11, G-12, integration | A-09, art polish | **G4** |
| 10 | | Q-01, Q-03 | Q-02, Q-04, Q-05 | Final art fixes | |
| 11 | | Q-01 | Q-06, Q-07 | | **G5** |
| 12 | | | L-01, L-02, L-03 (50 invites) | | Closed playtest |
| 13 | | | L-03 (200 invites), L-04 | | **Go / no-go** |

**Critical path:** F-05 → M-04 → M-05 → M-07 → G-10 → G-11 → Q-01 → L-03. Art can slip a week without
moving the date, because everything has procedural or placeholder fallbacks. The AI layer can't slip.

---

## 9. Budget (cash)

| Item | Estimate | Notes |
|---|---|---|
| Haiku during development (testing, soaks, generating the 192 residents) | $150–300 | Spend-capped by K-01 |
| Evals (Sonnet 5.5 judge, red-team runs) | $50–150 | Per prompt iteration |
| Closed playtest (200 players × ~20 days played × ~$0.09) | ≈ $360, cap set at $600 | The global daily cap protects against spikes |
| Fly.io (2–4 machines, Postgres, Upstash Redis, Tigris) | $60–120 per month | Scale workers to zero overnight in staging |
| GPT-6 image generation (~1,000 images) | Depends on your plan | Codex is signed in through ChatGPT, so this likely draws on plan limits rather than per-image billing. Confirm before A-05. |
| itch.io | $0 | |
| **Total cash through week 13** | **≈ $800–1,200** | Excluding music (K-04) |

Prices are from the cached model table (§9.15). Re-check them before the playtest.

---

## 10. Risks and the MVP cut list

| Risk | Early signal | Response |
|---|---|---|
| Residents feel generic | Eval v0 persona score < 4.0 at G3 | Rewrite weak cards (Sonnet), tighten topic cards, cut the Acquainted cap to focus quality |
| Latency hurts the VN feel | p95 > 2 s at G3 | Prewarm, shorter dynamic context, the authored "thinking" beat, lower max_tokens |
| Cost per day over target | > $0.12 at G3 | §9.15 levers in order; reduce gossip; Ambient plans to weekly |
| Codex output quality varies | Repeated review rejections in one area | Move that area to Opus subagents; smaller tasks |
| Art volume (≈ 1,000 images) | A-05 behind at week 6 | Ship 20 masters × 3 variants and use procedural fallbacks for the rest |
| Playtest abuse of free text | Red-team escapes, or reports in week 12 | Turn free text off by default for public; keep it for invites |

**Cut list, in order, if the date is at risk:** the lighthouse Project (and WF-4/5, PZ-05) →
`community_garden` → live gossip within earshot → Tib riddles → romance ladder → `sc_bins_raccoons` →
Library Returns. **Never cut:** live dialogue, memory, Quiet Mode, the budget guard, the Straw Poll
ending.

---

## 11. Definition of done (MVP)

- [ ] Days 1–25 playable start to finish on the itch.io web build, online and in Quiet Mode.
- [ ] S01–S10 play; the Straw Poll and End-of-Spring report close the run.
- [ ] Every MVP riddle and puzzle is solvable in-game, and `verify_puzzles.py` plus the TS puzzle tests
      are green.
- [ ] §9.16 eval bars met (except playtest-only metrics), and cost ≤ $0.09 per in-game day on staging.
- [ ] Budget guard, global cap, Report line and the review queue work in production.
- [ ] AI disclosure, privacy policy and survey are live; telemetry is opt-in.
- [ ] Kasey has finished a full run and signed off.

---

## 12. Decisions for Kasey

| # | Decision | Recommendation | Needed by |
|---|---|---|---|
| 1 | MVP scope: "Spring in Monde" (Days 1–25) as above | **Yes** | Week 0 |
| 2 | Price during the playtest | **Free and invite-only.** Pick the business model (GDD §21.2 #1) before any public build that costs money to run. | Week 12 |
| 3 | Music source (K-04) | License a cohesive pack for the MVP; commission later | Week 6 |
| 4 | Free text in the playtest | **On** for invitees (it's the magic); revisit for public | Week 11 |
| 5 | Invite count | 50 in week 12, then 200 | Week 11 |
| 6 | Which friends do the internal playthroughs (Q-07) | Your call: 2 people who've never seen the GDD | Week 10 |

---

## 13. First tasks to start now

Once you've done K-01–K-02 and said yes to decision 1, I'll start these in parallel:

1. **F-01** monorepo scaffold (Codex)
2. **F-05** shared schemas from GDD §9 (Opus)
3. **F-07** Fly staging skeleton (Codex; needs K-02)
4. **A-01** style bible prompts and first paintings (GPT-6 images; Opus writes the prompts)
5. **F-02/F-03** Ravage render and combat port (Codex), right after F-01 lands
