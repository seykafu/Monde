# Monde

A cozy open-world life-sim RPG about bringing a fading seaside town back to life, where every resident is a
live Claude agent.

Phaser 3 · TypeScript · Fastify · Postgres · Claude Haiku 5.5 · Fly.io

**Status (2026-10-21).** Pre-release. *Spring in Monde*, the first 25 days of the game, is built end to end: it
plays from the ferry on Day 1 to the End-of-Spring report on Day 25, online with live residents and offline in
Quiet Mode. A staging server runs on Fly.io. What remains is cost tuning, hardening and shipping a closed
playtest ([section 9](#9-status-and-roadmap)).

**Contents:** [1. What Monde is](#1-what-monde-is) · [2. How it plays](#2-how-it-plays) ·
[3. The residents as AI](#3-the-residents-as-ai) · [4. Choosing models](#4-choosing-models) ·
[5. The cost dashboard](#5-the-cost-dashboard) · [6. Architecture](#6-architecture) ·
[7. Running it](#7-running-it) · [8. Testing and quality](#8-testing-and-quality) ·
[9. Status and roadmap](#9-status-and-roadmap) · [10. Conventions](#10-conventions)

---

## 1. What Monde is

### The pitch

Monde is a seaside town of 210 people that once held 4,800. You arrive as its new Revitalization Fellow, a
last-ditch hire by a mayor who has run out of ideas. Over 100 days you fix what's broken, follow a dead
founder's riddles to a hidden charter, run off the crew squeezing the shops, and get to know everyone. On Day
100 the town votes for a new mayor, and you win by becoming it.

What sets it apart is its people. Each resident is a live AI agent built from a persona card: they keep
routines, form opinions, gossip, fall for each other, hold grudges, chase dreams and remember what you did last
Tuesday. The town has a life of its own and you are one part of it. The authored spine (story scenes, riddles,
puzzles) stays fixed and fair; the AI writes what residents say, plan and feel, inside limits the engine enforces.

| Design pillar | In practice |
|---|---|
| People are the content | Quests, gossip, the paper and the vote are fed by what residents think and do. A day of "just talking" should be a good day. |
| You can see the town come back | Every good deed shows: shutters go up, lamps light, the fountain runs, new faces step off the ferry. |
| Cozy, with stakes | No permadeath and no fail screens before Day 100, but a real antagonist and a deadline. Nobody is hurt in a Scuffle. |
| The founder's riddles | Hand-made riddles and puzzles run under the whole game, fixed, fair and machine-checked. |
| Cartoon cozy, Fire Emblem x Stardew Valley | Pixel-art town on a 3/4 diorama board, cel-shaded portraits, clean cartoon backdrops. |

### The setting

Monde sits where the River Liss empties into the Grey Bay. It was founded in 1838 by Aurélien Monde, a
clockmaker and mapmaker who built the clocktower and hid the town's founding Commons Charter in six pieces
behind riddles on small brass plaques stamped with a lantern. Locals call them *Monde's Marks* and think
they're decoration. Margo the librarian doesn't.

The town is dying for concrete reasons: Lissworth Mill closed 14 years ago, the cannery 11 years ago, the
railway dropped Monde Station 9 years ago, the clinic is shut, the ferry runs twice a week, and the school has
9 pupils and closes unless it reaches 20. A crew called the Tollmen "protect" the remaining shops for a weekly
fee. Behind them is Silas Vane of Vane Consolidated, who wants the waterfront for a freight terminal. Twelve
years ago Mayor Pell signed an *Option Clause* for a loan: if the census stays under 200 for seven dawns in a
row, Vane may buy the whole Wharf cheaply. She has told no one. The assembled Charter voids it.

**Era and tone: "storybook modern".** Bicycles, radios, rotary phones, a diesel ferry, a hand-set newspaper
(*The Lantern*); no smartphones, internet or real-world brands. That keeps the mood timeless and keeps the AI
grounded in the town. The target rating is E10+ (a design target, not an official rating).

| Zone | Mood and landmarks | Opens | In Spring |
|---|---|---|---|
| Old Quarter | Cobbles, gas lamps. Town Hall, the Clocktower (stopped at 4:17), Fountain Square, library, *The Lantern* office, your cottage | Day 1 | Yes |
| Market Row | Half the shutters down. Market Hall, Fournier & Fille bakery, Dunmore's General Store, The Gull & Anchor, Café Liss | Day 1 | Yes |
| The Wharf | Salt, rope, rusting cranes. Fish market, shut cannery, boathouse, ferry slip, the dark lighthouse, Vane's field office | Day 3 | Yes |
| The Commons | Overgrown and beautiful. Bandstand, community garden, Glasshouse, duck pond, the Old Elm | Day 6 | Yes |
| Millbrook, Briar Woods, Station Hill | Brick terraces and the mill; ferns and the quarry; wind and rails | Days 12, 20, 30 | No ("road works on the Millbrook road") |

Spring also has twelve walk-in rooms (cottage, bakery, pub, café, library, Town Hall, Lantern office, general
store, Market Hall, boathouse, Bertrand's clock shop, an empty storefront) in `content/zones/interiors/`. No
road is walled off; a story beat clears it ([GDD §2](docs/MONDE_GDD.md#2-world)).

**Day 1 in numbers.** Census 210 (211 once the Fellow signs on; the agent roster is 212 because the census
leaves out Vane, who isn't a resident until Day 48, and Bastien, a cat). Pillars (Prosperity, Safety, Spirit,
Charm) 18, 30, 22, 25. Town Fund 1,800 coins. 6 of 15 shops open. 61 vacant homes, 17 of them in the districts
Spring opens. 9 school pupils.

### The Fellow and the premise

You answer a three-line ad in *The Lantern* ("MONDE NEEDS YOU... Apply in person. - E. Pell, Mayor"), arrive on
the Tuesday ferry on Day 1, the first day of spring, and are given the Lamplighter's Cottage and a job title
nobody can define.

Character creation is the **Fellowship application**, a form Pell hands you on the slip: name, pronouns, build,
skin, hair, eyes, outfit, a **background** (Homecomer, Tinkerer, Scrapper or Organizer, each with a start bonus
and a perk), "Why Monde?" and "Something you love" (residents who share it warm up faster). You have no dialogue
portrait; the camera is your eyes. Four skills (Handiwork, Wits, Heart, Grit) rise with use
([GDD §11](docs/MONDE_GDD.md#11-the-player-character)).

The full game is 100 days in four seasons of 25, each ending in a festival. The arc is in
[GDD §3](docs/MONDE_GDD.md#3-story-spine), including Rook's redemption track.

| Days | Season | Festival |
|---|---|---|
| 1-25 | Spring | **Day 25, Bloom Fair** (the Commons). Spring in Monde ends here. |
| 26-50 | Summer | Day 50, Regatta & Fish Fry. Pell says she won't run; Vane announces. |
| 51-75 | Autumn | Day 75, Harvest Supper |
| 76-100 | Winter | Day 100, Lantern Night and the election |

### What "Spring in Monde" covers

Spring in Monde is the first 25 days (Acts I and II up to the Bloom Fair), planned as a **free, invite-only web
playtest on itch.io**. It exists to answer four questions in order: do players want to keep talking to the
residents; can we run them fast, safely and cheaply enough; does watching the town come back feel good; are the
riddles and puzzles fair. The election is out of scope, but the MVP ends with a **Spring Straw Poll** that runs
the real voter model on the Day-25 town ([`docs/MVP_PLAN.md`](docs/MVP_PLAN.md)).

| Area | In Spring in Monde (built) | Not in the MVP (the GDD describes it) |
|---|---|---|
| Time | Days 1-25, an estimated 7-9 hours | Days 26-100 |
| Districts | Old Quarter, Market Row, Wharf, Commons, 12 interiors | Millbrook, Station Hill, Briar Woods |
| Story | S01-S10, the Bloom Fair, the Straw Poll, the End-of-Spring report | S11-S23, the campaign, debate, election and endings. Their scripts are in `content/scenes/` and compile, but the Spring session plays S01-S10. |
| Residents | 212 agents (24 authored cards, 188 from the Day-1 census) plus generated arrivals | Returnees from the Departed list; pgvector memory |
| Projects | Fountain, bakery ovens, streetlights, community garden, market hall, homes (repeatable), lighthouse, clocktower | The other nine (glasshouse, ferry, bandstand, clinic, station, cannery co-op, mill, school) |
| Riddles | 19 Marks (Old Quarter 5, Market Row 5, Wharf 5, Commons 4) and 6 of Tib's | Millbrook, Station Hill and Folly chains; Tib's T-07 to T-12 |
| Puzzles | 9 boards, plus the procedural Mail Round and Library Returns | PZ-07 to 12, 14, 16, 17, 19, 20 |
| Scuffles | 3 (bakery tutorial, Market Row Saturday, bin raccoons) | The rest of the list |
| Romance | Resident-to-resident ladder up to Courting | Weddings. The player is never a romance target. |
| Platform | itch.io web build; Mac app (Electron); keyboard and mouse | Steam, a tested Windows build, controller, localization |

The playtest's bars ([MVP plan §3](docs/MVP_PLAN.md)): H1, residents are the content (60% or more of finishers
would talk again to three or more residents; a median of 6 conversations a day); H2, it's affordable and fast
(at most $0.09 per in-game day; first character under 0.8 s p50 and 1.5 s p95; zero shipped safety incidents);
H3, the town coming back feels good; H4, riddles and puzzles are fair; H5, Straw Poll results spread across
players. H1 and H2 must pass for a public build.

### Where things are documented

| Document | What it is for |
|---|---|
| [`docs/MONDE_GDD.md`](docs/MONDE_GDD.md) | **The design, and the source of truth** (about 12,000 lines; start at its table of contents). If code and GDD disagree the code is wrong, unless a newer decision says otherwise; then the GDD is updated in the same change. |
| [`docs/MVP_PLAN.md`](docs/MVP_PLAN.md) | What is being built now, with the task ids (F-01, M-05, G-11...) used in commits and code comments. |
| [`AGENTS.md`](AGENTS.md), [`CLAUDE.md`](CLAUDE.md) | Conventions and commands for coding agents, and how work is reviewed and committed. |
| [`docs/AUDIO.md`](docs/AUDIO.md), [`docs/PERF.md`](docs/PERF.md) | The 14 music tracks and ambience beds; the performance harness and captures. |
| [`docs/store/`](docs/store/) | Unpublished drafts of the itch.io page, the AI disclosure and the privacy notice, with `[KASEY: ...]` blanks. |
| `desktop/README.md`, `server/README.md`, `content/README.md` | Electron build; server env and migrations; content layout. |

---

## 2. How it plays

### The day

A day runs from 06:00 to 02:00: 1,200 game minutes at 0.75 s each, about 15 real minutes. Time stops in dialogue,
menus, puzzles, riddles and Scuffles, not while you walk. Day 1 is a Tuesday and the ferry sails Tuesdays and
Fridays. Weather (sun, cloud, rain, fog, wind) shifts residents' plans and some puzzles
([GDD §5](docs/MONDE_GDD.md#5-core-loop)).

- **06:00, the Dawn Report.** A full-page front page of *The Lantern*, written by Haiku as the editor Sable from
  yesterday's real events (templates offline): headline and stories, arrivals and departures with faces, the
  four Pillars with arrows, the census, notices, and letters to the editor from residents.
- **The free day.** 100 Stamina to spend on Projects, Favors, community work, Marks and puzzles, Scuffles and
  socialising. Meals restore it (Odile's bun +15, a Café Liss lunch +25, supper at the pub +30).
- **Late.** After midnight you lose 1 Stamina a minute. At 02:00 you pass out and wake with 70; bed before
  midnight starts the next day with 110.
- **Sleep and the night pass.** Residents reflect, plan, gossip and meet; the migration roll and Pillars
  recompute; the next Lantern is written. The loading screen lasts at most 4 seconds; unfinished work carries on
  in the background and falls back to routine templates at dawn.

### Talking to residents

Walk up and press E. A visual-novel panel opens: the resident's portrait (one of six expressions per line), a
name plate with their hearts, and a typewriter body. You pick one of 2-3 generated replies (written to answer
what was just said, in your voice, different in tone) or choose **Say something...** and type up to 140
characters (on by default; **Choices only** turns it off). You can also offer a gift, open the log (L), or use
the menu to **Report line** ([GDD §9.10](docs/MONDE_GDD.md#910-dialogue)).

- A conversation lasts up to 6 exchanges before the resident wraps up. Leave and return within 5 game minutes
  and it resumes (2 more exchanges, up to 8).
- Residents start things too: they walk up and open conversations, write letters, and chat with each other where
  you can see them. Those exchanges are authored lines unless you stop and listen, when a live one can play
  (at most one every 45 s and 20 per game day).
- **Quiet Mode** is the whole game with written lines in place of live residents. It starts with no invite code,
  with `?offline`, when you choose **Offline** in Settings, when the server is unreachable or erroring, and when
  a world's AI budget runs out. An Online/Offline dot in the HUD says which, and a panel on written lines shows
  "offline · written lines". Everything authored works the same offline
  ([GDD §9.14](docs/MONDE_GDD.md#914-quiet-mode-offline-fallback)).

### Friendship and Regard

Each resident's **Regard** toward you runs from -100 to 100 and shows as 10 hearts: **Stranger** 0-19,
**Neighbor** 20-39, **Friend** 40-69, **Confidant** 70+, and one cracked heart below 0 (Wary). The model judges
how each reply lands from that resident's point of view; the engine clamps the result
([GDD §9.11](docs/MONDE_GDD.md#911-friendship-the-player-the-residents-and-each-other)).

| Source | Regard | Limit |
|---|---|---|
| First chat of the day | +1 | once per resident per day |
| A reply that lands | -5 to +5 (Heart skill: up to 7) | conversation gains cap at +6 per resident per day; losses are uncapped |
| Gift | love +8, like +4, neutral +1, dislike -4; birthdays double | one gift per resident per day |
| Favor done | +5 to +15 | |
| Word of your deeds (gossip, reflection) | -8 to +8 | per night |
| Neglect (3 days without a word) | -1 | only at Friend or above, never below 40 |

Residents have ties with each other, labelled from the average of their two feelings: Acquaintances, Friends,
Close friends, Rivals, Enemies. Romance is a separate ladder between residents (Crush, Courting, Together,
Wedding, Falling out); Spring reaches Courting, and every resident has a birthday. The **People** page in the
Journal shows each resident's hearts, birthday, the gifts you've learned they like, and the ties you've seen,
heard of or read in the paper.

### Favors and dreams

A **Favor** is a resident's request: bring something, deliver something, find a lost thing, introduce two
people, help with a chore for an hour, or a "last chance" plea before someone leaves town. The model writes the
request but it is always built from an engine template and checked for feasibility, so it can be completed. One
Favor per resident, at most six open in the town, each expiring in 2-5 days
([GDD §9.9](docs/MONDE_GDD.md#99-favors)).

Every resident also has a **dream** with stages. Once you learn it, it is a side quest on the Journal's Quests
page; each stage earns +5 Regard and the last +15 in all, and stages with no engine condition are worked as
Favors. Code: `client/src/quests/`, `shared/src/dreams.ts`.

### Town Projects, Pillars and Appeal

The town's state is a few numbers the engine owns: four **Pillars** (Prosperity, Safety, Spirit, Charm, each
0-100) and **Appeal**, how attractive Monde is to people deciding whether to move here. AI residents never write
them; they react to them ([GDD §6](docs/MONDE_GDD.md#6-town-revitalization)).

A **Project** is a multi-day restoration that changes the town for good: unlock it, get Pell to sign off the
Fund cost, gather materials, put in volunteer-hours (yours at 10 Stamina each, and residents', who turn up on
site), solve the gating puzzle, and attend the opening ceremony.

| Project | Opens | Fund | Volunteer-hours | Puzzle |
|---|---|---|---|---|
| Fountain | Day 5, via S04 | 200 | 6 | PZ-01 Under the Square |
| Bakery ovens | Day 4 | 150 | 4 | PZ-02 The Old Lady's Flues |
| Streetlights | Day 8 | 400 | 8 | PZ-13 Lamplight |
| Community garden | Day 8, after PZ-06 | 100 | 10 | PZ-06 Who Fed the Ducks? (opens it) |
| Market hall | Day 12 | 600 | 16 | PZ-04 Market Day |
| Homes (repeatable) | Day 10 | 150 each | 6 | none |
| Lighthouse | Day 16 | 800 | 12 | PZ-05 The Lens |
| Clocktower | after Mark OQ-5 | none | none | PZ-15 The Founder's Gears |

Source: `content/projects.yaml`, which also holds the completion effects (Pillars, homes, a weekly market).

**Arrivals and departures** ([GDD §6.4](docs/MONDE_GDD.md#64-housing-arrivals-and-departures)). At dawn on a ferry
day, if Appeal is 35 or more, `floor((Appeal - 35) / 6) + 1` households arrive, capped by free restored homes
and at 6. Each person becomes a resident agent with a generated persona card and a library portrait, and walks
off the ferry at 08:00. Every resident has a nightly **Stay** score; under 25 for five nights gives a **Leaving
Notice**, then a **Last Chance** Favor two days before the ferry they'd take. At most two leave per ferry day.
Once the Option Clause is known (Day 18, or earlier if it triggers) the Town Ledger (L) shows its census gauge.

### Marks and puzzles

Riddles and puzzles are authored and never generated at runtime. Residents can talk about them but only pass on
authored hints ([GDD §14](docs/MONDE_GDD.md#14-riddles), [§15](docs/MONDE_GDD.md#15-puzzles)).

- **Marks.** Each brass plaque holds a riddle in Aurélien's voice, and *the answer is where the next Mark is
  hidden*. Find it in the world (full reward) or type the answer in the Journal (half the Wits XP). Answers are
  normalised; fuzzy matching accepts only reviewed one-edit misspellings. Spring ships 25 riddles in
  `content/riddles.json`: 19 Marks in four chains (the Wharf's last two need the lighthouse) and 6 of Tib's. The
  Old Quarter chain yields the lantern pinion; fitting it (PZ-15) restarts the clocktower.
- **Hints.** A nudge (free after an in-game hour), a narrowing (ask Margo, Bertrand or Tib, or spend 10 Stamina
  puzzling at home), then a near-giveaway (Friend-level Regard with them, or a Founder's Notebook page). When a
  resident is asked about a riddle the server skips the model and serves the authored hint for the level you've
  unlocked, so an answer cannot leak.
- **Puzzles.** Nine boards: pipes (PZ-01), lights-out (PZ-02), a book cipher (PZ-03), a logic grid (PZ-04),
  beam routing (PZ-05), truth-teller deduction (PZ-06), a breaker panel (PZ-13), gear selection (PZ-15) and
  subset partition (PZ-18). Time stops, every board has Undo and Reset, none can fail permanently.
  `tools/verify_puzzles.py` proves each instance solvable (and unique where the design needs it), and the
  TypeScript boards are tested against the same solutions.

### Scuffles

Turn-based fights on a small diorama board, on the combat core ported from Ravage and softened to cartoon:
nobody is hurt, units get *Winded* and sit down ([GDD §7](docs/MONDE_GDD.md#7-scuffles-combat)). Tools form a
triangle (Frying Pan beats Broom beats Umbrella beats Frying Pan), with stances, five items a Scuffle, and **Talk
Down** as a non-violent option. Allies (Augusta, Kasimir, Nell) join at Regard 40 or more. Each zone has a
Tollmen level from 0 to 3 that winning, streetlights and deputies push down. Losing is forgiving: you wake at
home, lose a little coin, and the level rises for two days.

Spring has three: `sc_bakery_tutorial` (Day 3; losing still advances the story), `sc_market_saturday`
(Saturdays at Tollmen level 2 or more) and `sc_bins_raccoons` (random, Old Quarter and Market Row).

### The economy

| Thing | In Spring |
|---|---|
| Stamina | 100 a day; spent on work, Projects and puzzling; restored by meals and sleep. |
| Coins | The Fellowship stipend (20 a day, from the Town Fund), community work and some Favors; spent on gifts, meals and materials. |
| The Bag (I) | 24 slots for items, gifts and Project materials. Dunmore's General Store sells the basics. |
| Community work | Six repeatable tasks: sweep Market Row, litter pick, Mail Round, Library Returns, mend nets, weed the garden. They pay coins, nudge a Pillar (at most +3 per Pillar a week) and put you next to people. Repeating a task the same day halves its Pillar effect, then removes it. Mail Round and Library Returns are procedural puzzles. |

([GDD §8](docs/MONDE_GDD.md#8-community-work), [§11](docs/MONDE_GDD.md#11-the-player-character))

### The story: scenes S01-S10

Scenes are scripts in `content/scenes/*.scene.md` (format: [GDD §13.1](docs/MONDE_GDD.md#13-story-calendar-and-scripts)),
compiled to JSON and run by the story runtime. A scene can hand over to a live resident (`{ai_open}`,
`{ai_line}`); each such cue has an authored Quiet Mode version.

| Scene | Day | Where | What happens |
|---|---|---|---|
| S01a-c The Ferry, The Walk, The Cottage | 1 | Ferry slip, Old Quarter | Meet Pell and Old Moss, fill in the Fellowship form, get your keys. The first Mark (OQ-1) is on your door knocker. |
| S02 Monde's Marks | 2 | Library | Margo shows the founder's papers and the Charter legend; Tib tags along; PZ-03 yields Aurélien's map. |
| S03 Tolls | 3 | Bakery | The Tollmen shake down Odile; the tutorial Scuffle. Rook watches and doesn't step in. |
| S04 Water Again | 5 | Fountain Square | The first Project, the fountain. |
| S05 First Arrival | first ferry day on or after Day 7 with Appeal 35+ | Ferry slip | The first new resident steps off the boat. In the empty-boat variant Pell admits she's scared and it repeats on the next qualifying ferry day. |
| S06 The Man in the Good Coat | 10 | Fountain Square | Vane visits, charming, and offers a "consulting" retainer, a bribe to look busy. Accepting is possible. |
| S07 Quarter Chime | by 14 | Clocktower | The clocktower strikes once (pinion fitted, or a borrowed chime). Act I ends. |
| S08 The Option | 18 | Lantern office | Sable finds the Option Clause in the council archive. |
| S09 Pell's Confession | 18, evening | Pell's house | A private scene. |
| S10a-c Bloom Fair, Straw Poll | 25 | The Commons | The festival, then the poll. |

### The Journal, quests and the objective line

**J** opens the Journal: **Quests**, **People**, **Marks**, **Today**, **Favors**. **L** opens the Town Ledger
(Pillars, Appeal, census, housing, Fund). The Quests page keeps the main story's next step and last few beats,
Projects under way, Favors you took on, and the dreams you know. Under the HUD clock an **objective line** says
what to do next (the scene you can still catch today, where and when, or something to do meanwhile); you can
switch it off from the Quests page. Key characters point you at the main story when you ask what to do. Code:
`client/src/quests/`, `client/src/story/hint.ts`.

### The finale: Bloom Fair, Straw Poll, End-of-Spring report

On Day 25 the Commons hosts the **Bloom Fair** (S10a at midday, S10b at dusk). Turnout and mood come from your
actual Spirit pillar (about 31, 73 or 190 people) and from who likes whom. At the close Sable sets three of
Odile's jam jars on a trestle (THE FELLOW, MR. VANE, OLD MOSS) and every grown-up in the crowd drops one bean.
The ballots are a seeded sample of eligible voters (28, 65 or 169, by crowd), each decided by the GDD's voter
model on real Regard, ties and record. The paper prints the shares with an honest margin of error, three
residents say which jar they chose (live lines online, written ones offline), and an **End-of-Spring report**
shows Days 1-25 on one page and ends on "to be continued". In the balance test (five play styles over eight
worlds each) the Fellow's share runs from about 12% for a passive player to about 77% for a strong one
([GDD §10.3](docs/MONDE_GDD.md#103-the-voter-model), "The Spring Straw Poll").

### Controls and settings

WASD or the arrow keys walk. **E** talks, opens, picks up and uses. **J** is the Journal, **L** the Town Ledger,
**I** the Bag. In a conversation **1-6** (or arrows/Tab then Enter) pick a reply, **T** types a line, **L** opens
the log and **Esc** leaves. **F11** is fullscreen (from the itch page draft, read against the code on
2026-10-16). Settings: three text sizes, typewriter speed (including instant), colourblind-safe emotes, reduced
motion, Choices only, Offline. Saves: 3 manual and 3 rolling dawn autosave slots, plus checkpoints.

---

## 3. The residents as AI

The contract is [GDD §9](docs/MONDE_GDD.md#9-the-living-town-resident-agents). Its principle: **the model
proposes, the engine disposes.** Haiku writes words and *suggests* plans, feelings and changes as structured
JSON; the deterministic engine validates, clamps and applies them. The engine owns position, time, money, flags,
Pillars and votes, so no prompt can make a model give you an item or skip a story beat. Every model call has a
deadline and an authored fallback, so the game never waits on a model.

### Who is in the town

| Group | Count | Where | How they were made |
|---|---|---|---|
| Authored cast | 24 cards | `content/residents/*.yaml` | The core cast (Pell, Margo, Tib, Odile, Rook, Vane and the rest; 19 cards are `kind: canon`), the cat Bastien (`kind: animal`, no speech) and four featured residents (Ada, Moss, Bru, Nettie). Written ahead of time (GDD §12.2), not at run time. |
| Day-1 census | 188 cards | `content/residents/day1/*.yaml` | Generated offline with Haiku from the census skeleton (`content/census/day1.yaml`, GDD Appendix A.1), then repaired, linted and swept. 43 are flagged `curated: true`; the rest are model drafts that went through that repair and review. |
| Arrivals | per world | the database | Written during play by `server/src/mind/arrivals.ts` from the archetype rules (Appendix A.3), each with a library portrait. |

That makes 212 agents. The 120 library portrait identities and the 24 authored cards give the 144 portrait
sheets. A 30-card sample review (commit `b5d11bd`) and a sweep of the other cards followed the first draft;
Kasey's own sign-off is not recorded in the repo.

### The persona card

A card ([GDD §9.3](docs/MONDE_GDD.md#93-the-persona-card), schema in `shared/src/persona.ts`) holds identity and
look, backstory, personality, **values** (how much they weigh each Pillar, which later drives the vote), voice
(register, tics, words they never say, three sample lines), likes, dislikes, fears, a **dream** with stages, a
routine, beliefs (including something they're wrong about), relationships, secrets with reveal conditions, and
**canon locks**: facts they must never contradict, active while a story-flag condition holds. The `look` block
drives the paper-doll sprite. Cards are YAML in authoring and JSON at runtime; voice rules are in
[GDD §12.1](docs/MONDE_GDD.md#12-characters-and-voice).

### Tiers

Detail follows attention ([GDD §9.8](docs/MONDE_GDD.md#98-levels-of-detail-and-scheduling),
`server/src/mind/tiers.ts`).

| Tier | Who | Plans | Reflections | Live dialogue |
|---|---|---|---|---|
| **Core** | Cards with `kind: canon` | Every night | Every night | Yes |
| **Acquainted** | Up to 30 residents you've talked to in the last 14 days, or tied to an open Favor | A model plan on even days and any night they reflect; else their routine | Daily with an importance-5+ memory, else every 3rd day (batched) | Yes |
| **Ambient** | Everyone else | Routine template (weekly, plus life events) | Only with an importance-6+ memory (batched) | Yes; talking to one promotes them to Acquainted |

### The prompt: four blocks

Every resident call is four blocks ([GDD §9.10.1](docs/MONDE_GDD.md#9101-prompt-layout-cache-aware),
`server/src/mind/promptBuilder.ts`, templates in `server/src/mind/prompts/*.md`):

| Block | Content | Changes | Cached |
|---|---|---|---|
| 1 | **World Bible**: setting, era rules, tone, rating rules, voice rules, output contract. Under 2,800 tokens. | Per release | Yes; shared by every world and resident |
| 2 | **Persona card** with canon locks evaluated, plus other residents' catchphrases never to borrow | Rarely | Yes |
| 3 | **Beliefs** and the top relationships and stances | Nightly | Yes |
| 4 | **Session history** (earlier turns verbatim) and the **per-turn context**: what the Fellow just said, scene and mood, who the Fellow is and what this resident calls them, retrieved memories, topic cards, `<town_now>`, `<quest>`, open Favors, revealable secrets, riddle hints | Every turn | Earlier turns only |

**Blocks 1-3 must stay byte-stable** (fixed field order, sorted collections, no timestamps, regard, mood or
topics) or caching silently stops. A unit test proves the bytes are identical across turns, and the server logs
`cache_read_input_tokens` on every call. Each call carries a hash of the templates (`prompt_version`, also from
`GET /v1/version`).

### Live dialogue

`POST /v1/worlds/:w/talk` streams the reply over server-sent events, not a WebSocket
([GDD §9.10](docs/MONDE_GDD.md#910-dialogue); `server/src/mind/dialogue.ts`, `routes.ts`):

1. **Prewarm.** Within 6 tiles of a resident the client sends `/prewarm`: a one-token request with that
   resident's exact prefix and output schema, so the first real turn hits a warm cache. At most one per
   resident per world every 4 minutes.
2. **Call.** The `dialogue` role's model (Haiku 5.5 by default) with streaming, structured output
   (`output_config.format`) and thinking off, capped at 900 tokens. A reply cut short is *salvaged*: whole
   lines kept, an unfinished one trimmed to its last sentence.
3. **Deadlines.** First visible character targets 0.8 s p50 and 1.5 s p95. At 2.5 s the resident plays an
   "Hm." thinking beat and a second identical request goes out alongside (first to stream wins). At 6 s the
   line falls back to the authored library. A call that fails before producing text is retried at once if
   1.5 s remain.
4. **Validation**, on every model output: schema, ranges and ids; lexical filters (profanity, modern tech and
   brands, "as an AI" patterns, unsolved riddle answers); canon contradictions; effect clamps (Regard, mood,
   memory, Favor feasibility, secret ids). On failure it regenerates once with a short corrective note, then
   uses the authored fallback. Every failure is logged by category.
5. **Voice repairs.** An echo check (word-trigram overlap above 0.35 with the resident's last 20 lines)
   regenerates once. Voice checks catch a wrongly gendered "you", a `never_says` word, money that isn't Monde's,
   another resident's catchphrase, or a lifted card sample. A slip in voice beats an authored line in no voice,
   so these never fall back; the better attempt is kept.
6. **Refusals.** Haiku can stop with `stop_reason: "refusal"` with no server-side fallback, so the server
   always checks `stop_reason` before reading content and uses the authored line.
7. **Sessions.** The live conversation is verbatim in the prompt. After the 5-game-minute window it is compacted
   into a summary (at most 60 words; also the resident's memory of it), and older summaries merge into a rolling
   "history with the Fellow" digest of at most 150 words, so history never grows in tokens
   ([GDD §9.10.3](docs/MONDE_GDD.md#9103-conversation-sessions-and-compaction)).

Everything else on the failure path (offline, timeouts, errors) is the Quiet Mode line library in
`content/lines/` ([GDD Appendix B](docs/MONDE_GDD.md#appendix-b-quiet-mode-line-library)).

### The night pass

When you sleep the client calls `POST /v1/worlds/:w/night`; `GET /v1/worlds/:w/dawn/:day` returns the dawn
package (plans, letters, Favors, the paper, arrivals, departures). `server/src/mind/night.ts` runs it:

1. Claims the night atomically (the world moves to 06:00 the next day; a repeat reports status) and recomputes
   tiers.
2. Schedules tomorrow's birthday parties, then runs the friendship pass: neglect, weekly drift, and
   **encounters** between residents whose plans put them together. Model-written encounters are capped at **40 a
   night**, Core pairs first; the rest follow the Ambient rule (+1, -1 or 0 by mood). This is how gossip travels.
3. Queues jobs, Core then Acquainted then Ambient, at most 8 model calls in flight per world. Core: reflect,
   then a model plan. Acquainted: reflect when due, then plan on even days or after a reflection. Ambient:
   reflect only on a big event; the plan is the routine.
4. Reflections for everyone but Core go through the **Message Batches API at half price** and may arrive after
   dawn. Plans list only the blocks they *change*, and overnight blocks end at 02:00.
5. Runs the romance ladder, the press job (the Lantern) and, on ferry days, arrivals.
6. Answers within 4 seconds. Unfinished work keeps running and is saved; the dawn package serves routine plans
   for anything pending.

### Memory

Everything notable becomes a **memory**: kind saw, heard, did, said, felt or scripted; at most 200 characters;
importance 1-10; valence -5 to 5 ([GDD §9.6](docs/MONDE_GDD.md#96-memory)). They are written by witnessing (anyone
within sight of a town event), at the end of conversations, by gossip (each hop lowers importance by 1) and by
scripted scenes. **Beliefs** are the compressed self: at most 12 sentences rewritten each night and included in
every prompt. **Retrieval** is keyword-based with no embeddings: `0.5 * relevance + 0.3 * importance/10 + 0.2 *
recency`, recency halving every 5 in-game days, the top 8 going into a dialogue prompt. Client events (gifts,
Projects, scenes, Favors) are batched to `POST /v1/worlds/:w/events`; offline they queue locally and go up at the
next night.

### The budget guard and caps

`server/src/mind/budget.ts` admits every charged call inside a database transaction, reserving a conservative
estimate first and settling to the real cost after (a lost response keeps its reservation, so a crash never
reopens the budget). Limits are in dollars:

| Limit | Default | What happens |
|---|---|---|
| `WORLD_DAILY_BUDGET_USD` | $0.06 per world per in-game day | Past 100%, Ambient *work* (plans, reflections, encounters, summaries, prewarm) stops; Ambient residents still talk. Past 150%, Acquainted model plans stop. Past 200%, everything stops except live dialogue (and its safety check) with Core residents. |
| `GLOBAL_DAILY_BUDGET_USD` | $10 per UTC day, all worlds | Past it every charged call is refused, Core dialogue included. Zero disables them all. |
| `CENSUS_BUDGET_USD` | $3 in total | Ceiling for the one-off Day-1 census writing run. |

A refused call becomes Quiet Mode for that moment. Players see a status, never a cost
([GDD §9.15](docs/MONDE_GDD.md#915-cost-model), `server/src/mind/BUDGET_SAFETY.md`). Each call is logged to
`ai_log` with its model, tokens, latency, stop reason and validation result.

### Safety

([GDD §9.13](docs/MONDE_GDD.md#913-guardrails-and-safety), `server/src/mind/BUDGET_SAFETY.md`)

- **Content policy** lives in the World Bible and the validators: in-world only, E10+, no fourth-wall breaks, no
  real brands, places or politics, a kindness floor (rude or sad is fine, cruel about identity or threatening is
  not), and canon locks as hard facts.
- **Free-text pre-check.** Typed lines pass local rules first (a rejected line never reaches the model), then a
  tiny Haiku check (64 output tokens, 750 ms timeout) that runs beside the dialogue call. The reply is held
  until it clears, so an unsafe line's reply never reaches you. A timeout or API error lets the line through
  after the local rules. Text is wrapped in `<player_said>` and treated as dialogue, never instructions. Rude
  input is answered in-world with a small Regard cost; distress points to Priya, friends and the clinic.
- **Report line.** The dialogue panel, each model-written item of the paper and each letter to the editor have a
  Report button that swaps in an authored line at once and queues the item, stored from the server's own copy.
  At most 10 reports per world per UTC day; the queue is visible behind `ADMIN_TOKEN`.
- **Disclosure.** `docs/store/ai_disclosure.md` separates pre-generated content (art, Day-1 personas, scripts)
  from live content (dialogue, plans, letters, the paper) and must match §9.13.

### Measured cost

Haiku 5.5 costs **$0.10 input / $0.50 output per million tokens**; cache reads are 0.1x, 5-minute cache writes
1.25x, Message Batches half price. The MVP target is **at most $0.09 per in-game day** (about $2.25 a finished
Spring); the GDD's longer-term "Standard" target is $0.06. Measured on staging with `tools/soak-live.ts` (60
dialogue turns a day, prewarm, nights, dawns; GDD §9.15):

| Step | Per in-game day |
|---|---|
| First soak, before tuning (2026-10-19) | $0.163 |
| Acquainted capped at 30; quiet-day reflections every 3rd day | $0.136 |
| Changes-only plans and larger token caps (all 227 plans kept, up from 55%) | $0.128 |
| Plus batching non-Core reflections (about $0.003 saved; within noise) | $0.134 |
| Kasey's two levers: Acquainted model plans every other day, 40 model encounters a night | **$0.106** (5-day soak, 2026-10-21; days from $0.080 to $0.143) |

So Spring costs about $2.65 a run today, **18% over the $0.09 MVP target**, and the $0.06 target is not met.
Before the last two levers a $0.13 day went on plans $0.045, Core reflections $0.022, dialogue $0.024, gossip
$0.021, prewarm $0.009, summaries $0.007 and pre-checks $0.003. The soak talks to about 20 residents a day, which
keeps Acquainted at its cap, so a real day likely costs less. Still open: batching Core reflections (their plans
would read yesterday's beliefs) and a compact night persona. Tried and reverted: sharing the plan's and
reflection's cached prefix (a different output format invalidates the cache) and one combined reflect-and-plan
call (saved about 5% and lost a blind A/B 38-13).

---

## 4. Choosing models

Every model call belongs to one of eight **roles**. Claude Haiku 5.5 is the default for every role. Each role
can run on Haiku 5.5 (small, cheap) or on a larger model: Sonnet 5.5, Opus 5.5 or Fable 5.1.

| Role | What it does |
|---|---|
| `dialogue` | A resident's reply in a conversation, with the cache prewarm before it and the salvage of a cut-off reply |
| `precheck` | The safety check on typed lines |
| `plan` | A resident's timetable for tomorrow |
| `reflect` | The nightly reflection (live for Core, batched for others) |
| `gossip` | Resident-to-resident exchanges: night encounters and live chatter |
| `press` | The Dawn Report, written as Sable |
| `arrival` | Persona cards for arriving households, and the Day-1 census writer |
| `summary` | Conversation summaries and history digests |

| Model | API id | Size | Input / output per million tokens |
|---|---|---|---|
| Claude Haiku 5.5 (default) | `claude-haiku-5-5` | small, cheap | $0.10 / $0.50 |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | larger | $2 / $10 |
| Claude Opus 5.5 | `claude-opus-5-5` | larger | $4 / $20 |
| Claude Fable 5.1 | `claude-fable-5-1` | larger | $10 / $50 |

**Precedence**, highest first, resolved separately for each role:

1. **A runtime override**, set from the [dashboard](#5-the-cost-dashboard) or with `PUT /admin/models`, stored in
   the database.
2. **The env var `MIND_MODEL_<ROLE>`**: `MIND_MODEL_DIALOGUE`, `MIND_MODEL_PRECHECK`, `MIND_MODEL_PLAN`,
   `MIND_MODEL_REFLECT`, `MIND_MODEL_GOSSIP`, `MIND_MODEL_PRESS`, `MIND_MODEL_ARRIVAL`, `MIND_MODEL_SUMMARY`.
3. **`MIND_MODEL`**, one env var for every role with no more specific setting.
4. **Haiku 5.5.**

Env var values are the API ids above; an unknown id stops the server at boot. The admin routes take the
`ADMIN_TOKEN` as a bearer token:

```
GET /admin/models    the model each role uses now and where it came from ("admin", "env" or "default"),
                     plus the model list with prices
PUT /admin/models    {"role": "plan", "model": "claude-sonnet-5-5"} sets an override;
                     {"role": "plan", "model": null} clears it
```

A change applies at once on the instance that takes it and on every instance within a minute. Code:
`server/src/mind/models.ts`, `modelRoutes.ts`. Every `ai_log` row records its model, and costs and budget
reservations use the selected model's prices (and the batch discount). Thinking is handled per model: Haiku uses
`thinking: {type: "disabled"}`, Sonnet `between_tools` with low effort, and Opus and Fable (always thinking) omit
the field and use low effort. All four reject non-default sampling and assistant prefill.

**Cost and budgets.** A larger model costs 20x (Sonnet 5.5), 40x (Opus 5.5) or 100x (Fable 5.1) Haiku's price
per token. The caps are in dollars, so a larger model reaches a world's daily cap much sooner. Back of the
envelope, ignoring cache pricing: dialogue is about $0.024 of a $0.13 day on Haiku, so at 20x it alone is about
$0.48, eight times the $0.06 default world budget and four times the $0.12 line past which only Core dialogue
continues. **Raise `WORLD_DAILY_BUDGET_USD` on staging when testing a larger model** (and
`GLOBAL_DAILY_BUDGET_USD` if several worlds run), then lower it again.

**When you switch.** A new model starts with a cold prompt cache, so the first calls cost more than steady state.
Deadlines are fixed in code and tuned for Haiku (the 2.5 s thinking beat, the 6 s dialogue fallback, the 750 ms
pre-check timeout); a slower model hits them more often, and a pre-check that times out lets the line through
after the local rules, so think before moving `precheck`. Change one role at a time and judge a voice change by
blind A/B (`tools/eval-pair.py`), not absolute scores ([section 8](#8-testing-and-quality)).

---

## 5. The cost dashboard

```
npm run dashboard
```

opens a local page at **http://localhost:4310** (`tools/dashboard/server.mjs`, `index.html`). It shows:

- today's, the last 7 days' and all-time spend, with call counts and all-time token totals;
- daily cost as a bar chart over a range you pick (7, 14 or 30 days);
- where the money goes, by call kind (dialogue, plan, reflect, gossip...), with each kind's share and average
  cost per call;
- recent worlds: cost, in-game days played and **cost per in-game day against the $0.09 target** (green under,
  amber over);
- which model each role uses, with a selector to switch it ("Automatic (env / default)" removes the override;
  see [section 4](#4-choosing-models));
- the budget limits, today's global spend against its cap, and pending batch requests.

It reads the admin token from the `ADMIN_TOKEN` environment variable or `~/.config/monde/admin_token.txt`, and
targets **staging** (`https://monde-mind-staging.fly.dev`) by default. To watch a server on your own machine:

```
npm run dashboard -- --url http://localhost:8080
```

The token stays in the dashboard's local process (it listens on `127.0.0.1:4310` only) and the page never sees
it. The server side is `GET /admin/usage.json?days=N` (1 to 365, default 14; UTC calendar days;
`server/src/mind/usage.ts`) and `/admin/models`. All need `ADMIN_TOKEN` set on the server, or the `/admin` routes
answer 404. The older `/admin` page and `/admin/costs.json` show cost per world-day, the global cap and the
report queue.

---

## 6. Architecture

```
  Player ── client (Phaser 3, browser or Electron) ──HTTPS + SSE──> monde-mind (Fastify, Fly.io, iad)
                │                                                      │             │
        local saves, the                                        Anthropic API   Postgres (Supabase, us-east)
        deterministic town sim                                  (Haiku 5.5 and  worlds, residents, memories,
        and routine executor                                    Message Batches) events, plans, ai_log...
```

**Split authority.** The client runs the deterministic world: clock, routines and pathfinding, the town engine,
Projects, puzzles, Scuffles, saves; walking around needs no network. The server owns *minds*: memories,
relationships, plans, reflections and dialogue. **World time only moves while the player plays**, so cost tracks
play time and nothing is simulated in the background. One world per save, in isolated rows; loading a save
restores its snapshot into a new branch.

### Workspaces and directories

npm workspaces: `shared`, `client`, `server`, `desktop`. Plain directories: `content`, `tools`, `docs`,
`scripts`, `art_sources`.

```
client/    Vite + Phaser 3 game             (src/render and src/combat ported from Ravage)
server/    monde-mind (Fastify + TS)        Fly.io; Dockerfile, fly.toml, drizzle migrations
shared/    zod schemas and pure rules       used by client, server and tools
desktop/   Electron wrapper                 Mac (and Windows) app around the same client build
content/   YAML, JSON, script markdown      cards, places, scenes, line library, Projects, riddles
tools/     compilers, linters, evals, soak, packaging, dashboard
scripts/art/  art generation and export (Python)       art_sources/  raw generated art (Git LFS)
docs/      GDD, MVP plan, audio, performance, store drafts
.github/workflows/   CI and the nightly live soak                release/  the itch zip (gitignored)
```

### The client (`client/src`)

| Folder | What lives there |
|---|---|
| `scenes/` | Phaser scenes: Title, Fellowship form, Zone (the walkable board and HUD), Dialogue, Story, Dawn Report, Journal (People, Quests, Marks), Town Ledger, Straw Poll, Spring report, Survey. `scenes/zone/` has resident layers, greetings, chatter and speech bubbles. Puzzle and Scuffle scenes sit with their modules. |
| `render/`, `world/` | The 3/4 diorama renderer ported from Ravage and the town board (autotiled ground, animated water, building and prop billboards that swap between Faded and Restored art, shadows, night windows); zone format, nav grid and A*, places, the roster. |
| `sim/`, `town/` | Clock, weather, plans and the routine executor; Pillars, Appeal, the Fund, migration, the Option Clause. |
| `mind/`, `story/` | The monde-mind client (session, SSE stream, prewarm, dawn package, event queue, Quiet Mode picker, online status); the script runtime (triggers, flags, director, host, hints). |
| `quests/`, `friendship/`, `economy/`, `projects/`, `riddles/`, `puzzles/`, `scuffles/`, `combat/`, `finale/`, `press/`, `fellow/`, `dialogue/` | Feature modules: mostly pure logic with a thin Phaser adapter. |
| `save/`, `accessibility/`, `audio/`, `telemetry/`, `perf/`, `qa/` | Saves (IndexedDB on the web, files on desktop), settings, music and ambience, opt-in telemetry, the perf harness, the Spring bot. |

### The server (`server/src`)

| Route | Purpose |
|---|---|
| `POST /v1/worlds`, `GET /v1/worlds/:w` | Create a world from the Day-1 template (invite code and device id in, world id and token out); read it |
| `PATCH /v1/worlds/:w/player` | Send the Fellowship application |
| `POST /v1/worlds/:w/talk`, `/talk/close`, `/prewarm` | Dialogue (SSE), session close, cache prewarm |
| `POST /v1/worlds/:w/chat` | A live resident-to-resident exchange |
| `POST /v1/worlds/:w/events`, `/night`; `GET /v1/worlds/:w/dawn/:day` | Client events, the night pass, the dawn package |
| `POST /v1/worlds/:w/snapshots`, `/snapshots/:id/restore` | Save snapshots; restore as a new branch |
| `POST /v1/worlds/:w/reports`, `POST /v1/telemetry` | Report line; opt-in telemetry and surveys |
| `GET /v1/health`, `/v1/version` | Health (database, optional Redis); git sha and prompt version |
| `GET /admin`, `/admin/costs.json`, `/admin/usage.json`; `/admin/models`; `POST /admin/census/write` | Bearer `ADMIN_TOKEN` only: costs, usage, model routing, the census writer |

`src/mind/` is the AI layer: prompt builder and `prompts/*.md`, dialogue, validation, filters, fallbacks, plan,
reflect, the night runner, tiers, encounters, romance, arrivals, press, compaction, retrieval, budget, safety,
models, usage. `src/db/` has the Drizzle schema (migrations `0000` to `0011` in `server/drizzle/`) and PGlite
test helpers; `src/worlds/` creates worlds and snapshots; `src/telemetry/` stores events and exports CSVs.

The data store is **Postgres on Supabase** (a pooled connection for the server, a direct one for migrations);
the game never talks to Supabase or Anthropic directly. **Redis is optional** and feeds only the health check:
per-world concurrency is an in-process semaphore and locks are Postgres advisory locks. Snapshots are JSONB
(Tigris is a recorded GDD-GAP). Worlds are authorised by an HMAC token bound to a device id; outside dev, world
creation needs one of `MONDE_INVITE_CODES`.

### The shared package (`shared/src`)

Zod schemas and pure rules used on both sides: `persona.ts`, `state.ts`, `memory.ts`, `events.ts`,
`conversation.ts`, `outputs.ts` and `modelSchema.ts` (what a model may return, with the JSON Schema for
structured output), `friendship.ts`, `favor.ts`, `economy.ts`, `save.ts`, `riddles.ts`; `script/` (the scene
compiler), `census/` and `arrivals/` (Day-1 census and arrival generation), `election/` (voter model, Straw
Poll). No Phaser or DOM imports, so it runs under vitest in Node.

### Content and its compile steps

| Content | Compiled or checked by | Output |
|---|---|---|
| `scenes/*.scene.md` (S01-S23, endings) | `npm run scenes` (`tools/compile-scenes.ts`) against `flags.yaml`, the cards and the place registry | `client/src/story/scenes.gen.json` (gitignored) |
| `residents/*.yaml`, `residents/day1/*.yaml` | `npm run residents` (`tools/compile-residents.ts`) | `client/src/world/residents.gen.json` (gitignored): authored cards first, then the census by id |
| All of the above plus `places/`, `lines/`, `projects.yaml`, `census/` | `npm run lint:content` (`tools/lint-content.ts`), also in CI | exit 1 on errors |
| `riddles.json` | Bundled by `shared`; verified by `npm run verify:puzzles` | |

`npm run dev`, `npm run build` and the client tests compile scenes and the roster first. The server reads cards
from `content/` at runtime (`MONDE_CONTENT_DIR`; the Docker image copies it in read-only).

### Art and audio pipelines

- **Portraits.** Cel-shaded busts generated with GPT-6 image generation through the Codex CLI
  (`scripts/art/gen_portraits.py`), six expressions each, exported (`export_portraits.py`) as **one WebP sheet
  per resident** in `client/public/assets/portraits/`: 144 identities in 144 files, because itch.io allows at
  most 1,000 files per game. The library of generic townsfolk is `content/portraits/library.json`.
- **Town and backdrops.** Town sprites (`gen_town.py`, `export_town.py`) are single objects drawn on magenta,
  keyed, trimmed and scaled to pixel art, with Faded and Restored states; ground and water are procedural. Scene
  backdrops (`gen_backdrops.py`) are 28 painted 1280 x 720 JPEGs. Residents' sprites are procedural paper-doll
  rigs drawn from each card's `look` block.
- **Audio.** 14 music tracks (15 files) made with Suno by Kasey in `client/public/audio/music/`; until a file
  exists the game plays a generative placeholder. Sound effects are synthesized in WebAudio. Ambience beds
  (gulls, surf, rigging, rain on tin, weir, hill wind, pub murmur, market chatter) are procedural
  (`tools/make-ambience.py`). See `docs/AUDIO.md`.
- **Git LFS** holds the heavy binaries (`.gitattributes`): `art_sources/**/*.png|jpg`,
  `client/public/assets/**/*.png|webp`, `client/public/audio/**/*.mp3`.

### Deployment

Staging is the Fly app `monde-mind-staging` (region `iad`, `shared-cpu-1x` with 512 MB, kept running)
with its database on Supabase. `server/Dockerfile` builds from the repository root, and Fly's release command
runs the migrations (`node server/dist/db/migrate.js`). Deploy with `flyctl deploy . -c server/fly.toml
--remote-only` from the repo root; it uploads the working tree, so use a clean checkout of `main`. There is no
production app yet ([section 9](#9-status-and-roadmap)).

---

## 7. Running it

### Prerequisites

- **Node 22** (`.nvmrc`) and npm.
- **Git LFS** for art and audio: `git lfs install` once, then `git lfs pull`. A fresh `git worktree` holds
  pointer files instead; `git lfs checkout client/public/assets` fills them in (without them every sprite is a
  black square).
- **Python 3** for `verify:puzzles` (CI uses 3.12). Optional: Pillow (desktop icon), numpy, scipy and ffmpeg
  (ambience), the Codex CLI (art generation), `flyctl` (deploys).
- On Kasey's Mac, Node runs as x86_64 under Rosetta; that is fine for Vite and Phaser.

```
git clone https://github.com/seykafu/Monde.git && cd Monde
git lfs pull
npm install
npm run dev            # the game on http://localhost:5173, in Quiet Mode
```

### Secrets and environment

**The Anthropic API key lives only in Fly secrets or your local environment. It never goes in the client.**
Never paste a key, token, invite code or database URL into a chat, issue, commit, log or screenshot. `.env` files
are gitignored. The server reads **process environment variables** only; it does not load `.env` itself
(`tools/gen-residents.ts --local` is the one tool that reads the repo `.env`, for `ANTHROPIC_API_KEY`).

| Variable | Where | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | server | The model key. Without it the server runs and every call takes its fallback. |
| `ANTHROPIC_WORKSPACE_ID` | server | Only if the key is org-level rather than workspace-scoped. |
| `DATABASE_URL`, `DATABASE_DIRECT_URL` | server | Postgres; the direct (session) URL is for migrations. Without `DATABASE_URL`, world routes answer 503. |
| `REDIS_URL` | server | Optional; health check only. |
| `MONDE_ENV` | server | `dev` (default), `staging` or `production`. Outside dev, `MONDE_TOKEN_SECRET` is required. |
| `MONDE_TOKEN_SECRET`, `MONDE_INVITE_CODES` | server | HMAC secret for world tokens; comma-separated invite codes (in dev any non-empty code works). |
| `ADMIN_TOKEN` | server | Enables the `/admin` routes (404 without it). |
| `WORLD_DAILY_BUDGET_USD`, `GLOBAL_DAILY_BUDGET_USD`, `CENSUS_BUDGET_USD` | server | Spend caps ([section 3](#the-budget-guard-and-caps)). |
| `MIND_MODEL`, `MIND_MODEL_<ROLE>` | server | Model per role ([section 4](#4-choosing-models)). |
| `PORT`, `NODE_ENV`, `LOG_LEVEL`, `GIT_SHA`, `MONDE_CONTENT_DIR` | server | Plumbing; defaults in `server/src/config.ts`. |
| `VITE_MIND_URL` | client build | Which monde-mind to use; default is staging. A different URL starts a new world. |
| `VITE_MIND_INVITE` | client build | Bakes an invite code into a personal test build. **Never ship a build with it:** every tester would share your code. |

Players pass their invite as `?invite=CODE`, in Settings on the title screen, or `--invite=CODE` in the desktop
app. To play with live residents against a local server:

```
# terminal 1 (export ANTHROPIC_API_KEY and DATABASE_URL in your shell first)
npm run db:migrate -w @monde/server
npm run dev:server                              # http://localhost:8080
# terminal 2
VITE_MIND_URL=http://localhost:8080 npm run dev
# then open http://localhost:5173/?invite=anything
```

### Commands

Every npm script in the root `package.json`:

| Command | What it does |
|---|---|
| `npm run dev` | Client dev server on :5173 (compiles scenes and the roster first) |
| `npm run dev:server` | monde-mind on :8080 with reload |
| `npm test` | vitest across the four workspaces |
| `npm run typecheck` | `tsc` on shared, client, server and desktop |
| `npm run lint` | ESLint over the repo |
| `npm run lint:content` | Content linter: cards, places, flags, the line library, scripted exchanges, Projects |
| `npm run scenes` | Compile `content/scenes` to `scenes.gen.json` |
| `npm run residents` | Compile the persona cards to `residents.gen.json` |
| `npm run verify:puzzles` | Check every puzzle and riddle instance in the GDD (Python) |
| `npm run build` | Production build of the client and the server |
| `npm run build:itch` | Client build for itch.io (`client/dist-itch`) |
| `npm run package:itch` | Run the itch build, check itch's limits and that no art is an LFS pointer, and zip it to `release/monde-web-<commit>.zip` |
| `npm run smoke:server` | Boot the built server with no services and check `/v1/health` and `/v1/version` |
| `npm run ci` | Everything CI runs: typecheck, lint, lint:content, scenes, residents, test, verify:puzzles, build, desktop:compile, smoke:server |
| `npm run census:skeleton` | Build `content/census/day1.yaml` from the pins and homes; it won't overwrite the frozen file without `-- --reseed` |
| `npm run census:report` | Recompute the Appendix A.1 census tables and check they close |
| `npm run census:write` | Write Day-1 resident cards with Haiku (`tools/gen-residents.ts`; options in its header) |
| `npm run dashboard` | The local cost dashboard ([section 5](#5-the-cost-dashboard)) |
| `npm run desktop:dev` | Electron against the Vite dev server |
| `npm run desktop:compile` | Compile the desktop main process (what CI runs) |
| `npm run desktop:build` | Client build plus desktop compile |
| `npm run desktop:dist` | Package the Mac app (the Windows installer on Windows) into `desktop/release/` |

Workspace scripts: `npm run db:generate -w @monde/server` after a schema change, `npm run db:migrate -w
@monde/server`, `npm run start -w @monde/server` (the built server), `npm run preview -w @monde/client`,
`npm run icon -w @monde/desktop`.

Tools run directly (they spend tokens or need a server; CI runs none of them except the nightly soak):

| Command | What it does |
|---|---|
| `npx tsx tools/soak-live.ts --days=5 --turns=60 --out-dir=<dir>` | Live cost soak on staging (`--url=` for another server). Five days costs about $0.50 at today's $0.106 a day. |
| `npx tsx tools/eval-dialogue.ts --label=<name> --out-dir=<dir>` | Dialogue responsiveness eval on staging (`--local` for an in-process server) |
| `python3 tools/eval-pair.py make <old.judge.md> <new.judge.md> <out>`, then `score <out>` | Blind A/B of two eval runs |
| `npx tsx tools/export-telemetry.ts <dir>` | Export opt-in telemetry and surveys to CSV (needs `DATABASE_URL`) |
| `node --import tsx tools/riddle-red-team-live.ts` | 50 adversarial riddle asks against staging (needs `WORLD_ID`, `WORLD_TOKEN`, `WORLD_URL`) |
| `python3 tools/make-ambience.py --only surf,gulls` | Regenerate ambience beds |
| `python3 scripts/art/gen_portraits.py` (and `export_portraits.py`, `gen_town.py`, `export_town.py`, `gen_backdrops.py`) | Art generation and export; needs the Codex CLI |

Tools that need secrets read them from the environment or `~/.config/monde/` (`ADMIN_TOKEN` or
`admin_token.txt`; `MONDE_INVITE_CODE` or `staging_invite_codes.txt`) and never print them.

**Dev URL flags** (some need a dev build or `?dev`): `?skiptitle=1` (start in the town as a default Fellow),
`?offline`, `?invite=CODE`, `?day=N&time=HH:MM`, `?spring=strong|social|builder|lapsed|passive` (start on Day 25
with that Spring behind you), `?puzzle=PZ-01`, `?scuffle=sc_bakery_tutorial`, `?scene=<id>`, `?story=all`,
`?perf=1&crowd=60`.

### The desktop app and the itch.io build

**Desktop.** `npm run desktop:dist` builds the client and packages Electron; on a Mac it writes
`Monde-<version>-mac-arm64.dmg` and `-mac-x64.dmg` to `desktop/release/`. Builds are unsigned for now (right-click
Open the first time). The game is served from a privileged `app://monde/` scheme with a strict CSP, saves are
files in `~/Library/Application Support/Monde/saves/`, and the flags `--invite=CODE`, `--offline` and `--devtools`
work. Details, signing and notarisation, and Steam notes are in `desktop/README.md`.

**itch.io.** `npm run package:itch` makes the zip. Creating the page and uploading it (with `butler`) are manual
and not done yet. Runtime asset URLs resolve against `import.meta.env.BASE_URL` because itch serves games from an
iframe CDN path.

---

## 8. Testing and quality

- **vitest, four workspaces.** About 200 test files in `__tests__/` folders next to the code. Pure logic runs in
  Node; server tests run on PGlite with the real migrations. `npm test` runs them all.
- **The Spring bot** (`client/src/qa/springBot.ts`, run by `client/src/qa/__tests__/springRun.test.ts`). Three
  player scripts play Days 1-25 on the real game modules in Quiet Mode, saving at every dawn and reloading the
  save, through to the End-of-Spring report. `BOT_OUT=<dir>` keeps each run's log. It found ten bugs on its first
  run. A separate test (`client/src/finale/__tests__/h5.test.ts`) plays five styles over eight worlds each
  against hypothesis H5.
- **Puzzles, riddles, content.** `npm run verify:puzzles` plus the per-puzzle TypeScript tests; a hint-guard test
  throws adversarial asks at the riddle path; `npm run lint:content` catches money that isn't Monde's, a
  generated card using a core catchphrase, cut-off text, unreciprocated ties and more.
- **Dialogue eval** (`tools/eval-dialogue.ts`). Scripted conversations (questions, callbacks, feelings, jokes,
  rudeness, riddles, goodbyes, memory scenarios) are played through `POST /talk` and recorded: fallback rate, stop
  reasons, time to first line, prompt layout, and a Sonnet 5.5 judge on "responds to the player's line",
  "remembers when relevant" and "in character". `--repeat=N` plays each scenario N times.
- **Blind A/B** (`tools/eval-pair.py`). Judge scores drift between judges, so a prompt or voice change is
  compared by *one* judge seeing both runs of each scenario with shuffled labels; the tool reports wins, means and
  sign tests.
- **Live cost soak** (`tools/soak-live.ts`) and **the nightly workflow** (`.github/workflows/nightly-soak.yml`,
  07:17 UTC daily): a fresh staging world for two days at 30 turns a day, about $0.25 a run, with the report kept
  as an artifact. It does nothing until the repository secrets `MONDE_INVITE_CODE` and `ADMIN_TOKEN` exist.
- **CI** (`.github/workflows/ci.yml`; pushes to `main` and pull requests; Ubuntu, Node 22, Python 3.12): the
  `npm run ci` steps. **CI checks out without Git LFS**, so every image and audio file is a pointer there; a test
  that reads an asset's bytes must accept a pointer.
- **Playtest data.** Telemetry is opt-in and off by default, and two short in-game surveys (around Day 7 and at
  the end of Spring) feed the bars in [section 1](#what-spring-in-monde-covers). `tools/export-telemetry.ts` exports
  them to CSV; see `server/src/telemetry/README.md`.
- **Performance** (`docs/PERF.md`). `?perf=1&crowd=60` records frame statistics and zone-load times against the
  targets: 60 fps at 1080p with 60 visible residents, zone loads under 1.5 s, memory under 1.5 GB. The one capture
  so far (M1 Max, packaged app) gave 120 fps mean and zone loads of 0.51-0.85 s. Sign-off needs a mid-range laptop.

---

## 9. Status and roadmap

The MVP plan's task ids, checked against `git log` and the code on 2026-10-21 (162 commits since the scaffold on
2026-10-14).

| Phase | Tasks | State |
|---|---|---|
| **K** Kasey's setup | K-01 to K-05 | The Anthropic key, Fly staging and the Suno music (K-04) are in place. The API spend limit and the itch.io project and `butler` (K-03) can't be seen from the repo. |
| **F** Foundation | F-01 to F-08 | Done: monorepo, Ravage render and combat ports, shared schemas, CI, server skeleton, scene compiler, linters. |
| **W** Walkable town | W-01 to W-07 | Done: zone format, player, four districts and 12 interiors, clock and weather, routine executor, saves, the Fellowship form. |
| **M** Living residents | M-01 to M-14 | Done: world creation, cards, prompt builder, dialogue, memory, night pass, gossip, Favors, Dawn Report, Quiet Mode, budget guard, safety, prewarm. M-03 (the 188-card census) is written, repaired and reviewed; Kasey's own sign-off isn't recorded. |
| **G** Gameplay | G-01 to G-13 | Done: town engine, arrivals and departures, Projects, Option Clause, Marks, nine puzzles and the procedural two, Scuffles, community work and economy, story runtime for S01-S10, the finale, romance to Courting, friendship. |
| **A** Art and audio | A-01 to A-10 | Done in shape: style bible v2 (the cartoon direction, D15), 144 portrait identities, town sprites with Faded and Restored states, 28 scene backdrops, 14 music tracks, 8 ambience beds, districts that warm as Projects finish. Residents use procedural sprites, and the plan's 9 puzzle close-up backdrops weren't made (puzzles reuse scene backdrops). |
| **Q** Hardening | Q-01 to Q-07 | **Q-05** accessibility and **Q-06** telemetry and surveys: done. **Q-02** soak: bot, live soak and nightly workflow done (the nightly needs repository secrets). **Q-01** AI evals: partial (dialogue eval, blind A/B, voice checks, a 45-input local red-team set; the 300-input live red-team and the full persona bars aren't recorded as run). **Q-03** cost: in progress, $0.106 against $0.09. **Q-04** performance: harness and an M1 Max capture; the mid-range laptop capture is open. **Q-07** bug bash with Kasey and two friends: not started. |
| **L** Ship | L-01 to L-04 | **L-01** production deploy: not started (staging only). **L-02** itch page: drafts of the page, AI disclosure and privacy notice, and `npm run package:itch`; the page, the upload and the blanks are open. **L-03** closed playtest (50 invites, then 200) and **L-04** go/no-go: not started. |

**What remains**

- *Engineering.* Get cost to $0.09 or below (batch Core reflections, a compact night persona), or decide the
  target; a production deploy with backups and alerts on cost, latency and error rate; a mid-range-laptop perf
  capture; finish Q-01's red-team and persona evals; Intel Mac and Windows builds, signing and notarisation.
- *Kasey's side.* Settle the decisions in [MVP plan §12](docs/MVP_PLAN.md) (playtest price, invite count, free
  text for invitees); fill the `[KASEY: ...]` and `[CAPITALS]` blanks in `docs/store/` (operator, contact,
  retention periods, how to request an invite, which build to upload); create the itch.io page and upload; sign
  off the census; run the internal playthroughs; choose the business model (GDD §21.2) before any public build
  that costs money to run. Inference is about $2.65 a Spring today.
- *Cut list if the date slips* ([MVP plan §10](docs/MVP_PLAN.md)): the lighthouse Project, community garden, live
  gossip within earshot, Tib's riddles, the romance ladder, the raccoon Scuffle, Library Returns. Never cut: live
  dialogue, memory, Quiet Mode, the budget guard, the Straw Poll ending.

**Where the code and the GDD differ today**

| Topic | GDD or plan says | The code does |
|---|---|---|
| Riddle count | MVP plan §1: "25 Marks + 6 Tib riddles" | 19 Marks plus 6 of Tib's, 25 in all (`content/riddles.json`) |
| Dialogue transport | §9.2 diagram shows a WebSocket | Server-sent events over `POST /talk` |
| Redis and Tigris | §9.2, §19.3: Redis for queues and locks, Tigris for snapshots | Redis is health-check only; in-process concurrency and Postgres advisory locks; snapshots are JSONB |
| Endpoints | §19.4: `/v1/report`, `/v1/worlds/:w/budget` | `/v1/worlds/:w/reports` and the `/admin` pages |
| Journal | §18: ten tabs, Tab and Esc | Five tabs (Quests, People, Marks, Today, Favors) on J; the Town Ledger on L |
| Core tier size | §9.15 cost text: 24 Core residents | Core is the 19 `kind: canon` cards (§4 counts 20 with the cat) |
| Returnees | §6.4: the 24 Departed come back by letter | Not built |
| Cost target | §9.15 Standard $0.06; MVP plan $0.09 | $0.106 measured |

**Where to look next.** Read a system's GDD section, then the module header: most files name the GDD section and
MVP task they implement. The AI layer starts at `server/src/mind/promptBuilder.ts`, `dialogue.ts` and `night.ts`.
Residents and scenes are edited in `content/`, then `npm run lint:content` and `npm run scenes`.

---

## 10. Conventions

- **The GDD is the source of truth.** If code and GDD disagree the code is wrong, unless a newer decision says
  otherwise; then update the GDD in the same change. Rules and numbers come from the cited GDD sections. Don't
  invent numbers: if one is missing, add a `// GDD-GAP:` comment and say so in your summary.
- **Pure logic stays pure.** Anything in `client/src/{combat,town,sim/rules}`, the render maths and all of
  `shared/` has no Phaser or DOM imports, so it runs under vitest in Node. Phaser code lives in scenes and adapters.
- **TypeScript strict, Node 22, npm workspaces** (`@monde/client`, `@monde/server`, `@monde/shared`,
  `@monde/desktop`). Tests live in `__tests__/` next to the code (`*.test.ts`). Don't add dependencies unless the
  task says so; if you must, say which and why.
- **Asset URLs** resolve against `import.meta.env.BASE_URL`, never a leading `/` (the build is served from itch.io's
  iframe CDN path).
- **Claude API rules (server).** The model is chosen per role (`server/src/mind/models.ts`), `claude-haiku-5-5` by
  default, through `@anthropic-ai/sdk`, and all call parameters are built through the model router. **No**
  non-default `temperature`, `top_p` or `top_k` and **no** assistant prefill (400s on every supported model).
  Structured output goes through `output_config.format`. Thinking-off calls follow the model (section 4); plans and
  reflections use `output_config: {effort: "low"}`. **Always check `stop_reason` before reading content**
  (`refusal` has no server-side fallback on Haiku). Prompt blocks 1-3 stay byte-stable for caching. The API key
  lives only in Fly secrets or a local environment, never in the client.
- **Content rules.** Riddles and puzzles are authored and machine-verified; re-run `npm run verify:puzzles` after
  any edit to GDD §14 or §15. Voice follows the voice bible (GDD §12.1). No real-world brands, places or
  technology in anything a resident can say.
- **How work lands.** Claude Opus orchestrates and reviews, heavy implementation goes to Codex, and writing goes
  to Sonnet. A coding agent makes the change, runs `npm run typecheck` and `npm test`, reports what it changed and
  verified, and **does not commit or push**; it stays inside the files the task names. The orchestrator reviews the
  diff (and screenshots for visual work) and commits to `main`, trunk-based. A red CI blocks the next task in
  that area.

**Credits.** Creative direction: Kasey. Design, AI layer and prompts: Claude Opus 5.5. Cast, scripts and appendices:
Claude Sonnet 5.5. Implementation: GPT-6 Astra through Codex, and Claude. Art: GPT-6 image generation, curated by
hand. Music: Suno, by Kasey. Runtime residents: Claude Haiku 5.5. Rendering and combat are ported from
[Ravage](https://github.com/seykafu/Ravage). No open-source licence is set; the desktop package is marked
`UNLICENSED`.
