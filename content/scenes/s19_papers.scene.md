#### S19 · Papers
```yaml
id: s19_papers
day: 70
time: "08:00-17:00"
place: old_quarter.town_hall
trigger: "!flag.registered && day >= 70 && day <= 80 && player.place == 'old_quarter.town_hall'"
backdrop: bg_town_hall_registry
music: civic_hum
cast: [pell, margo, ines]
sets: [s19_explained, registered, campaign_season_open]
```
```script
// Re-arms every visit to the Town Hall from Day 70 to Day 80 (5 p.m.) until registered is set.
// First visit plays in full. Later visits skip to :: check via flag s19_explained.
{checkpoint: campaign_season}
// Pins the Day-70 06:00 rollover autosave under the key campaign_season. No-op if this scene first plays on a later day.
[[if flag.s19_explained]]
{goto: check}
[[end]]
N: The registry is a room with a table, a rubber stamp, a ledger as wide as a paving slab, and a window that doesn't shut.
N: The clerk's chair has been empty for eleven years. Pell sits in it with reading glasses halfway down her nose.
PELL [neutral]: The clerk retired the year the cannery went. I took the chair. Mind the stamp, it has a temper.
N: Ines Delacroix is leaving as you come in, a thin folder under her arm.
[[if flag.ines_trust_up]]
INES [neutral]: (stops beside you, voice low) He filed at eight sharp. Forty-three names, certified cheque. He asked for the earliest stamp in the book.
INES [worried]: Don't let him see you looking at the register.
[[else]]
INES [neutral]: Mr. Vane's papers are in order, Mayor. Good morning, Fellow.
[[end]]
N: Beside the door, a chalkboard has been propped on a chair. CANDIDATES. Two names are written in Pell's slanting hand.
N: S. VANE. M. FERRANTE (FERRY).
PELL [neutral]: Moss filed on Day 51. Forty signatures. One in pencil. One that appears to be gravy.
MARGO [neutral]: (at the end of the table, a ruler beside her) I'm the witness. I count, Pell stamps, nobody argues.
[[if flag.run_no]]
PELL [neutral]: You told me no on the bench.
PELL [neutral]: The door's still open.
>> CHOICE
- "I changed my mind." → {set: run_yes}; {unset: run_no}; {regard: pell +5}; goto check
- "I'm only looking at the register." → goto only_looking
[[end]]
:: check
{set: s19_explained}
[[if day >= 78]]
PELL [worried]: It's Day {day}. Five o'clock on the eightieth, remember. Don't make me lock you out.
[[end]]
[[if count.regard_ge_40 >= 40]]
{goto: enough}
[[else]]
{goto: short}
[[end]]

:: enough
N: The signature tin comes out. Margo opens it, runs the ruler under the first line, and reads aloud in the voice she uses for the Charter.
[[if regard.odile >= 40]]
MARGO [neutral]: Odile Fournier. In flour.
[[end]]
[[if regard.hollis >= 40]]
MARGO [neutral]: Hollis Brandt. Time and date beside the name.
[[end]]
[[if regard.nell >= 40]]
MARGO [neutral]: Nell Dunmore. Two signatures. Her brother's has a fish scale stuck to it.
[[end]]
[[if regard.delphine >= 40]]
MARGO [warm]: Delphine Mercer. A very careful hand. She's signed on the line, not above it.
[[end]]
[[if regard.tib >= 40]]
MARGO [laugh]: Tobias Okafor, aged eleven, which is disqualifying. He's put it in the margin under "Remarks."
[[end]]
MARGO [neutral]: And so on. {signatures} in all.
MARGO [neutral]: That's the forty.
PELL [neutral]: Fee. Three hundred coins to the clerk, which is me, who gives it to the Town Fund, which is also me.
[[if coins >= 300]]
>> CHOICE
- "Pay the fee." → {coins: -300}; {set: registered}; {unset: run_notyet}; {unset: run_no}; {set: run_yes}; goto stamped
- "Not today. I'll come back." → goto not_today
[[else]]
PELL [worried]: Short on the fee, I see. Come back when you've the three hundred. Day 80, five o'clock.
{goto: not_today}
[[end]]

:: stamped
N: Pell dips the stamp. It prints half a name and a blob. She says something to it under her breath, wipes it on a rag, and tries again.
{sfx: stamp_thud}
PELL [warm]: There. Candidate.
N: She takes the chalk and writes in the third line on the board, in a hand that hasn't changed in twenty-six years.
N: {name}.
MARGO [warm]: (reading it over her shoulder) There it is.
PELL [neutral]: Calendar, so you've got it. Day 75, Harvest Supper. Day 85, nothing, I hope, because you'll be busy. Day 90, voter lists close. Day 95, the debate in the Market Hall. Day 100.
PELL [neutral]: The ballot paper's printed by Sable. I won't tell you what's on it. She wants to surprise me.
{set: campaign_season_open}
{pillar: spirit +2}
{regard: pell +3}
{regard: margo +3}
{goto: end}

:: short
N: Margo opens the tin, runs a ruler under the first line, and counts.
MARGO [neutral]: {signatures}. Of forty.
[[if flag.s19_explained_before]]
MARGO [neutral]: Short again. No lecture.
[[else]]
MARGO [thinking]: The by-law says residents who'd call you a friend. In Monde that means someone who'd lend you a ladder. A Neighbor doesn't count. A Friend does.
MARGO [neutral]: How you get one: Favors, gifts they'd actually like, introducing them to each other, turning up where they turn up. Remember what they said last week.
MARGO [neutral]: I keep a short list of who's closest. I'll tell you if you ask.
{set: s19_explained_before}
[[end]]
>> CHOICE
- "Who's closest to signing?" → goto ask_margo
- "I'll work on it." → goto not_today

:: ask_margo
{ai_open: margo, topic: "Which residents are closest to Friend and what each of them might want or need from the Fellow. Give three names at most, gently, with a reason for each.", turns: 3}
{goto: not_today}

:: not_today
PELL [neutral]: Day 80, five o'clock. The clerk is very prompt.
{goto: end}

:: only_looking
PELL [neutral]: Look as long as you like. Mind the stamp.
{goto: end}

:: end
{memory: pell, "The Fellow came to the registry during registration season.", importance: 5}
[[if flag.registered]]
{memory: pell, "I stamped the Fellow's papers. The chair is the same chair. I am not as tired as I thought I'd be.", importance: 9}
{memory: margo, "Witnessed the Fellow's registration. I counted forty. I counted again to be sure.", importance: 8}
[[end]]
{memory: ines, "Filed Mr. Vane's papers at eight. Forty-three names. The Fellow came in as I left.", importance: 5}
```
