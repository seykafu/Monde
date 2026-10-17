# Monde audio

**Music** comes from Kasey's Suno AI tracks, which get dropped in later. Until a track's file exists, the game
plays a **generative placeholder** (WebAudio, in code) for that track, so every scene has music from day one.
**Sound effects** are synthesized in JavaScript (WebAudio), as in Ravage. There are no SFX files.

## Adding a Suno track

1. Export the track from Suno as **MP3, instrumental** (no vocals).
2. Name it exactly as the **file** column below, e.g. `market_row.mp3`.
3. Put it in `client/public/audio/music/`.
4. That's it. On the next load the game uses your file instead of the placeholder. To go back, delete the file.

Tips: 2–3 minutes is plenty (the game crossfades into a restart at the end). Loudness is evened out per file
in `client/src/audio/musicTracks.ts` (each file's `gain` brings it to about −17 LUFS, measured with
`ffmpeg -i <file> -af ebur128 -f null -`).

**More than one take?** Name extra takes `<track>_2.mp3`, `<track>_3.mp3` and list them as `alts` on the track
in `musicTracks.ts`; the game rotates through the takes that exist each time the track starts (Old Quarter has
two).

## MVP tracks (Spring in Monde)

| # | File | Where it plays | Mood |
|---|---|---|---|
| 1 | `main_theme.mp3` | Title screen, credits | Hopeful, a little wistful; the town's song |
| 2 | `arrival.mp3` | Day 1 at the ferry slip; new arrivals | Beginning, open water |
| 3 | `morning.mp3` | The Dawn Report, the first hour of each day | Fresh, quiet, kettle-on |
| 4 | `old_quarter.mp3` | Old Quarter by day | Cobbles, clocks, gentle bustle |
| 5 | `market_row.mp3` | Market Row by day, the café, the bakery | Warm, busy, a bit cheeky |
| 6 | `cottage.mp3` | The player's cottage (inside it, at every hour), letters, quiet personal scenes | Home, safe, small |
| 7 | `wharf.mp3` | The Wharf by day | Salt air, rope, slow swell |
| 8 | `commons.mp3` | The Commons, the garden, the Glasshouse | Green, open, birdsong |
| 9 | `night.mp3` | Any district after dark | Lamplight, hush |
| 10 | `tender.mp3` | Confessions, reconciliations, quiet wins | Heartfelt |
| 11 | `tension.mp3` | The Tollmen, Vane's pressure, hard conversations | Uneasy, not scary |
| 12 | `vane_theme.mp3` | Silas Vane's scenes | Smooth, slightly too polished |
| 13 | `scuffle.mp3` | Scuffles | Comic, bouncy fight |
| 14 | `bloom_fair.mp3` | The Bloom Fair (Day 25) | Festival joy |

**Indoors** (`client/src/audio/musicDirector.ts` `ambientMusic`, GDD §16.4.2): a room with its own track plays it at
every hour (the cottage); every other room plays its district's music as the street does (morning, by day, night), a
little softer (0.8), and a hushed one (the library, Town Hall, the Lantern, the clock shop, No. 9) softer again (0.55).
The Gull & Anchor keeps Market Row's fiddle going all evening.

### How to generate

- **Instrumental on.** Leave the lyrics box empty, or paste the structure line given for the track (Suno reads
  the bracketed tags as arrangement hints).
- **Style** goes in the style box; **Exclude** goes in "Exclude styles" (if your Suno version has it).
- Make 2–4 takes per track and keep the one that loops most naturally: no big fade-in, no dramatic ending,
  steady loudness. The game crossfades at the end, so 2–3 minutes is plenty.
- Don't name real artists or games in the prompt (Suno rejects them); the descriptions below aim at the
  same feel: acoustic, hand-played, warm, cozy-game.
- One sound world for the whole town: acoustic guitar, felt piano, fiddle, accordion, flute, glockenspiel,
  soft strings, light hand percussion. Each district adds one signature colour (clockwork, hand claps,
  concertina, harp).

### Prompts

**1 · `main_theme.mp3`** · Title: *Monde (Main Theme)*
- Style: `instrumental cozy folk waltz in D major, 3/4, 92 bpm, fingerpicked acoustic guitar, glockenspiel melody, warm felt piano, soft string pad, light brushed percussion, a simple six-note bell motif, seaside town, hopeful and nostalgic, gentle swell`
- Exclude: `vocals, choir, EDM, trap, distorted guitar, heavy drums, synth bass`
- Structure: `[Instrumental] [Intro: glockenspiel motif] [Main theme] [Bridge: strings rise] [Main theme, fuller] [Outro: motif returns softly]`

**2 · `arrival.mp3`** · Title: *The Gannet Comes In*
- Style: `instrumental acoustic folk, 96 bpm, G major, strummed acoustic guitar, tin whistle melody, upright bass, light tambourine, sea breeze, gentle waves, arriving in a small harbour town, hopeful, open, morning light`
- Exclude: `vocals, EDM, heavy drums, electric guitar, synth`

**3 · `morning.mp3`** · Title: *Kettle On*
- Style: `instrumental solo felt piano and celesta, 70 bpm, G major, soft and sparse, early morning, quiet kitchen, sunlight through curtains, cozy, gentle, simple melody with lots of space, warm room tone`
- Exclude: `vocals, drums, bass drop, synth pads, strings swell`

**4 · `old_quarter.mp3`** · Title: *Cobbles and Clocks*
- Style: `instrumental chamber folk, 100 bpm, F major, pizzicato strings, accordion, felt piano, clockwork ticking percussion, woodblock, light and curious, cobbled old town square, gas lamps, gentle bustle, whimsical but calm`
- Exclude: `vocals, EDM, heavy drums, distorted guitar, orchestral hits`

**5 · `market_row.mp3`** · Title: *Market Day*
- Style: `instrumental upbeat folk, 112 bpm, C major, fiddle melody, upright bass, acoustic guitar strumming, hand claps, tambourine, bakery smells and striped awnings, warm, busy, playful, a little cheeky, cozy village market`
- Exclude: `vocals, EDM, rock drums, synth, brass section`

**6 · `cottage.mp3`** · Title: *Lamplighter's Cottage*
- Style: `instrumental music box and felt piano, 72 bpm, E flat major, soft cello underneath, warm, cozy, tender, small home by the fire, letters on the table, slow and safe, lullaby feel`
- Exclude: `vocals, drums, percussion, synth, electric instruments`

**7 · `wharf.mp3`** · Title: *Salt and Rope*
- Style: `instrumental maritime folk, 6/8, 76 bpm, D minor to F major, concertina melody, low strings, acoustic guitar, soft bodhran, gentle sea swell, gulls far off, sea shanty influenced, wistful, weathered, slow and rolling`
- Exclude: `vocals, choir, EDM, rock drums, synth`

**8 · `commons.mp3`** · Title: *The Commons in Bloom*
- Style: `instrumental pastoral folk, 84 bpm, A major, wooden flute melody, concert harp, soft fingerpicked guitar, light strings, birdsong feel, spring park, duck pond and willow trees, airy, peaceful, green and open`
- Exclude: `vocals, drums, EDM, synth, electric guitar`

**9 · `night.mp3`** · Title: *Lamplight*
- Style: `instrumental lo-fi felt piano, 64 bpm, D flat major, soft warm pads, gentle vinyl warmth, distant harbour bell, night in a small town, lamplight on wet cobbles, calm, slow, intimate, quiet`
- Exclude: `vocals, beats, hip hop drums, EDM, bright synth`

**10 · `tender.mp3`** · Title: *Something True*
- Style: `instrumental solo cello and piano, 66 bpm, B flat major, emotional, gentle, heartfelt confession, hopeful resolution, slow, intimate, warm room, swelling softly then settling`
- Exclude: `vocals, drums, orchestral hits, synth, epic trailer`

**11 · `tension.mp3`** · Title: *The Tollmen*
- Style: `instrumental low strings and muted brass, 80 bpm, E minor, sparse pizzicato, soft timpani, ticking clock, uneasy but not scary, cozy game tension, sly and restrained, small-town trouble`
- Exclude: `vocals, horror, jump scares, heavy drums, distorted synth, dubstep`

**12 · `vane_theme.mp3`** · Title: *Mr Vane*
- Style: `instrumental smooth lounge jazz, 96 bpm swing, A flat major, vibraphone melody, muted trumpet, brushed drums, walking upright bass, polished and charming, slightly too smooth, a little sinister underneath, expensive suit in a fishing town`
- Exclude: `vocals, EDM, rock, distorted guitar, trap`

**13 · `scuffle.mp3`** · Title: *Scuffle!*
- Style: `instrumental playful folk rock, 140 bpm, D major, fast fiddle, upright bass, snare and woodblock, banjo, slide whistle accents, bouncy cartoon brawl, comic, upbeat, never violent`
- Exclude: `vocals, metal, distorted guitar, EDM, epic orchestra`

**14 · `bloom_fair.mp3`** · Title: *The Bloom Fair*
- Style: `instrumental festive folk dance, 124 bpm, G major, accordion, fiddle, tambourine, hand claps, acoustic guitar, glockenspiel echoing a six-note bell motif, spring fair in a seaside town, bunting and flowers, joyful celebration`
- Exclude: `vocals, choir, EDM, rock drums, synth`

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

## Drop-in ambience beds (A-10)

Put these optional MP3s in `client/public/audio/ambience/`. The manifest and district/day/night mapping live in
`client/src/audio/ambienceDirector.ts`; missing or invalid files are silent, with no placeholder. Reload after adding
files. Beds crossfade when walking between districts, soften indoors, and duck with dialogue. Master, music and SFX
sliders all affect beds; town bells follow master/SFX. Music holds suppress automatic town bells and fade beds out,
leaving S07a/S07b's scripted chime alone. GDD §17 specifies the C–E–A–G–D–C motif at **06:00 and 18:00** once restored.

For every prompt: **soundscape only**, 60–90 seconds, seamless loop, steady texture, no intro/outro or fade,
no melody, no intelligible speech, no sudden loud foreground events. Aim for **−24 LUFS integrated**, peaks below
**−6 dBTP**; the game applies an additional bed gain of 0.22 to sit below the music. These lengths, loudness targets,
gains, 3-second crossfade, 06–18 day band and indoor attenuation (0.3) are **GDD-GAP** production tuning.
Population density currently uses town census / 420 (clamped), with a 0.15 floor for environmental sound and none for
crowds; §17 requests zone population but a complete district census is not yet available.

- **`gulls.mp3`** · Style: `distant sparse seaside gull calls, small sheltered harbour, airy spring morning, soft natural field recording, no close squawks`.
- **`surf.mp3`** · Style: `gentle harbour water lapping stone steps, slow small waves, calm sheltered bay, soft natural field recording, no storm`.
- **`rigging.mp3`** · Style: `wooden fishing boats gently creaking, loose ropes brushing timber, occasional soft rigging taps, quiet coastal breeze, no bells`.
- **`rain_on_tin.mp3`** · Style: `steady gentle spring rain on an old tin awning, soft rounded patter, cozy sheltered street, no thunder or gutter crashes`.
- **`weir.mp3`** · Style: `small village weir, gentle continuous fresh water spilling over low stones, leafy riverbank, soft natural field recording`.
- **`station_wind.mp3`** · Style: `light spring wind through grass on a quiet station hill, airy soft rustle, distant open landscape, no trains or whistles`.
- **`pub_murmur.mp3`** · Style: `distant small cozy pub crowd behind a doorway, indistinct warm conversation wash, very occasional soft crockery, no intelligible words or music`.
- **`market_chatter.mp3`** · Style: `small seaside village market at a distance, indistinct friendly chatter, light footsteps on cobbles, gentle cloth rustle, no intelligible words or music`.
