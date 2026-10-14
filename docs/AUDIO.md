# Monde audio

**Music** comes from Kasey's Suno AI tracks, which get dropped in later. Until a track's file exists, the game
plays a **generative placeholder** (WebAudio, in code) for that track, so every scene has music from day one.
**Sound effects** are synthesized in JavaScript (WebAudio), as in Ravage. There are no SFX files.

## Adding a Suno track

1. Export the track from Suno as **MP3, instrumental** (no vocals).
2. Name it exactly as the **file** column below, e.g. `market_row.mp3`.
3. Put it in `client/public/audio/music/`.
4. That's it. On the next load the game uses your file instead of the placeholder. To go back, delete the file.

Tips: 2–3 minutes is plenty (the game crossfades into a restart at the end). Aim for even loudness across
tracks; the game normalizes per-track volume in `client/src/audio/musicTracks.ts` if one comes out loud.

## MVP tracks (Spring in Monde)

| # | File | Where it plays | Mood | Suno prompt (style box) |
|---|---|---|---|---|
| 1 | `main_theme.mp3` | Title screen, credits | Hopeful, a little wistful; the town's song | instrumental, cozy folk, acoustic guitar, glockenspiel, soft strings, warm, seaside town, gentle waltz feel, nostalgic, hopeful |
| 2 | `morning.mp3` | The Dawn Report, the first hour of each day | Fresh, quiet, kettle-on | instrumental, solo piano and celesta, morning, gentle, sparse, bright, cozy, slow tempo |
| 3 | `old_quarter.mp3` | Old Quarter by day | Cobbles, clocks, gentle bustle | instrumental, chamber folk, pizzicato strings, accordion, clockwork percussion, light, cozy, mid tempo |
| 4 | `market_row.mp3` | Market Row by day, the café, the bakery | Warm, busy, a bit cheeky | instrumental, folk, upright bass, fiddle, hand claps, bakery, market day, warm, playful |
| 5 | `wharf.mp3` | The Wharf by day | Salt air, rope, slow swell | instrumental, sea shanty influenced folk, concertina, low strings, waves, slow, wistful, maritime |
| 6 | `commons.mp3` | The Commons, the garden, the Glasshouse | Green, open, birdsong | instrumental, pastoral folk, flute, harp, soft acoustic guitar, spring, airy, peaceful |
| 7 | `night.mp3` | Any district after dark | Lamplight, hush | instrumental, lo-fi piano, soft pads, night, lamplight, calm, slow, intimate |
| 8 | `cottage.mp3` | The player's cottage, letters, quiet personal scenes | Home, safe, small | instrumental, music box, felt piano, warm, cozy, tender, slow |
| 9 | `tension.mp3` | The Tollmen, Vane's pressure, hard conversations | Uneasy, not scary | instrumental, low strings, muted brass, sparse percussion, tension, cozy game, restrained |
| 10 | `scuffle.mp3` | Scuffles | Comic, bouncy fight | instrumental, playful folk rock, fiddle, upright bass, snare, bouncy, cartoon brawl, upbeat |
| 11 | `vane_theme.mp3` | Silas Vane's scenes | Smooth, slightly too polished | instrumental, smooth jazz lounge, vibraphone, muted trumpet, brushed drums, charming, a little sinister |
| 12 | `tender.mp3` | Confessions, reconciliations, quiet wins | Heartfelt | instrumental, solo cello and piano, emotional, gentle, hopeful, slow |
| 13 | `arrival.mp3` | Day 1 at the ferry slip; new arrivals | Beginning, open water | instrumental, folk, acoustic guitar, whistle, gulls, arrival, hopeful, mid tempo |
| 14 | `bloom_fair.mp3` | The Bloom Fair (Day 25) | Festival joy | instrumental, festive folk, accordion, fiddle, tambourine, dance, celebration, spring fair |

**The town chime** (C–E–A–G–D–C, GDD PZ-07) is played by the game's own bells, not the music. If a Suno
take happens to carry that shape in `main_theme` or `bloom_fair`, keep it.

## Scene cues → tracks

Scripts name a mood cue (`music: dawn_report`); the game maps each cue to one of the tracks above. Cues
for later chapters fall back to the nearest MVP track until their own tracks exist.

| Track | Cues that use it |
|---|---|
| `morning` | dawn_report, dawn_report_soft, slip_morning |
| `old_quarter` | walk_theme, civic_hum, library_hush, clock_hush, fountain_work |
| `market_row` | cafe_idle |
| `wharf` | dusk_harbor, slip_empty |
| `night` | ledger_dusk |
| `cottage` | cottage_warm |
| `tension` | tension_light, tension_slow, quiet_strain |
| `tender` | quiet_resolve, pell_private |
| `vane_theme` | vane_theme |
| `arrival` | arrival_theme |
| `bloom_fair` | fair_bright, fair_dusk |
| (later chapters, mapped for now) | station_wind, station_open → `commons`; quarry_wind → `tension`; harvest_fiddle → `market_row`; folly_theme, debate_theme → `tension`; lantern_night* → `main_theme` |

## Sound effects (synthesized)

UI: click, hover, confirm, cancel, page turn, typewriter tick, voice blips (per resident).
World: footsteps (cobble, boards, grass), door open/close/bang, gull cry, waves, coin, paper rustle, stamp
thud, bell, clock tick, clock chime (the town chime notes), splash, crate scrape, brakes squeal, train horn
(distant), air hiss, cough behind a door.
Scuffle: pan clang, broom swish, umbrella pop, slingshot ping, winded thump.
Crowds (filtered noise): murmur, applause (polite / warm / mixed / thin), cheer (small / big), laughter,
roar, fair cheer.

## AI disclosure

Suno music is AI-generated content made before release. It goes in the store disclosure (GDD §9.13) next
to the GPT-6 art.
