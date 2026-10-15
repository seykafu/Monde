#### S07 · Quarter Chime (variant A: the pinion is fitted)
```yaml
id: s07a_chime_runs
day: 6
time: "16:00-17:45"
place: old_quarter.clocktower
trigger: "!flag.s07_done && flag.pinion_found && player.zone == 'old_quarter'"   # first afternoon on/after OQ-5 is solved; on most runs that is D14
backdrop: bg_clocktower_square
music: clock_hush
cast: [bertrand, pell, margo, tib, hollis]
sets: [s07_done, clock_chimed]   # plus clock_running, pinion_fitted, hollis_bertrand_spoke if PZ-15 solved; pz15_pending if not; remembered_chime if chosen
```
```script
{fade}
N: Four o'clock, and the Old Quarter is doing what it does at four: nothing, thoroughly.
N: Bertrand waits at the foot of the clocktower with a stick he doesn't lean on. The tower door stands open behind him. Bastien sits on the bottom step.
BERTRAND [warm]: Young person. You have the pinion.
N: You unwrap the oilcloth. Eight brass leaves, hand-cut, none longer than your thumbnail.
N: Bertrand takes it between two fingers. His hand shakes, a little. He puts the loupe to his eye and says nothing for as long as it takes a gull to cross the square.
BERTRAND [thinking]: Eight leaves. No file marks. He never used a file where a chisel would do.
BERTRAND [neutral]: Fourteen years I've told people it was missing. I never once thought it was waiting.
[[if player.background == 'homecomer']]
{goto: hc_ask}
[[end]]
{goto: climb}

:: hc_ask
BERTRAND [thinking]: You'd have heard her strike, if you were here before she stopped. Did you?
>> CHOICE
- "I remember it." → {regard: bertrand +4}; {set: remembered_chime}; goto hc_remember
- "I never heard it." → {regard: bertrand +2}; goto hc_never

:: hc_remember
BERTRAND [warm]: Then you're one of the last people who can tell me whether I've got her voice right. Come up.
{goto: climb}

:: hc_never
BERTRAND [warm]: Then you're in for a surprise. Come up.
{goto: climb}

:: climb
BERTRAND [neutral]: Mind the third stair. It strikes a flat G.
N: Ninety-six steps, and the third one sings.
N: Under the face the works fill the room: wheels, arbors, a great brass barrel gone brown with waiting. On the bench, a tray of gears.
BERTRAND [thinking]: The motion work wants two meshes. The cannon pinion turns the minute wheel, and the minute wheel's pinion turns the hour wheel. Twelve to one, overall. Both meshes sit on the same two arbors, so each pair has to add up to the same number of teeth.
BERTRAND [neutral]: Your pinion goes in one of them. Choose.
{puzzle: PZ-15}
[[if puzzle.solved]]
{goto: run}
[[else]]
{goto: pending}
[[end]]

:: pending
{set: pz15_pending}
BERTRAND [warm]: She would rather you took your time. So would I. I'll lend her one chime to be going on with.
{sfx: clock_chime}
N: Four soft notes fall down the face of the tower. The minute hand twitches to eighteen past four and stops.
TIB [surprised]: (from the square, at a dead run) I heard it first!
PELL [surprised]: (in the Town Hall doorway, one hand flat on her chest) Heavens.
BERTRAND [neutral]: One. A loan. The gears will keep, and so will I.
{goto: coda}

:: run
N: The last gear seats with a small sound, like a held breath let go. Nothing happens.
BERTRAND [neutral]: We wait for four-seventeen. I want her to go on from where she stopped.
{wait}
N: You wait. Bertrand holds his pocket watch shut in his fist.
{sfx: clock_tick}
N: The minute hand moves. One minute, from seventeen to eighteen, after fourteen years.
BERTRAND [warm]: (very quietly) Going.
{sfx: clock_chime}
{cam: shake}
N: Four soft notes, one under another, falling down the face of the tower into the square.
N: A quarter chime. It isn't the hour. It doesn't need to be.
{fade}
N: Down in the square people have stopped where they were. A woman with a basket. Two gulls. Pell in the Town Hall doorway with one hand flat on her chest, as if for an anthem.
TIB [surprised]: (at a dead run across the cobbles) I heard it first! I heard it FIRST! I was in the alley! Fourteen steps and a drainpipe!
MARGO [surprised]: (arrives behind him, gloves in one hand) The lantern stamp. On the escapement cover. It's—
MARGO [neutral]: Write that down.
TIB [neutral]: Where?
MARGO [neutral]: Anywhere. Your arm.
PELL [surprised]: (comes down the steps with the tin of lamp wicks still under her arm) Heavens. Heavens, Bertrand.
BERTRAND [laugh]: Eddie. I've been trying to tell you for fourteen years. It's going.
N: Pell takes her glasses off, wipes them on her cardigan cuff, and puts them back on. The clock is still going.
N: At the edge of the square a tall, rangy man with a heavy grey moustache stands with a watch open on its chain. He has come down from Station Hill without a coat.
BERTRAND [neutral]: (doesn't turn round) What time is it, Hollis?
N: The square goes quiet in a way that has nothing to do with the chime.
HOLLIS [neutral]: (checks the watch with his thumb and takes his time) Sixteen thirty-one and nine seconds. By my watch.
BERTRAND [neutral]: And the tower?
HOLLIS [neutral]: Eleven seconds slow.
BERTRAND [warm]: Then it is the finest tower clock in the county, Hollis, and eleven seconds slow.
HOLLIS [neutral]: Late.
BERTRAND [laugh]: Fourteen years. I'm told it's the longest delay in the history of the branch.
HOLLIS [neutral]: (shuts the watch) Not on the timetable.
N: He turns and goes. At the corner he stops, walks back three steps, and says it to the pavement.
HOLLIS [neutral]: Sunday. Sixteen seventeen. It'll be going. I'd like to see it go.
BERTRAND [neutral]: I'll be at the window.
N: Bertrand puts the loupe in his pocket with unusual care.
{set: clock_running}
{set: pinion_fitted}
{set: hollis_bertrand_spoke}
{pillar: spirit +4}
{goto: coda}

:: coda
PELL [warm]: (quietly, as the square starts moving again) Fourteen days. I wasn't sure you'd last the week.
[[if regard.pell >= 40]]
PELL [warm]: {name}. Thank you. I'm not saying it well.
[[end]]
[[if flag.clock_running]]
{memory: bertrand, "The Fellow brought the lantern pinion and chose the gears. She is going. Four notes at sixteen seventeen. Hollis told me the time. Eleven seconds slow.", importance: 10}
{memory: hollis, "The tower chimed. Bertrand asked me the time. I told him, to the second. Sunday, sixteen seventeen. Late, I said, which was unkind. Fourteen years.", importance: 9}
{memory: margo, "The clock runs. The lantern pinion was real. A minor irregularity, I told Tib, and had to sit down. Write that down.", importance: 10}
{memory: pell, "The tower is going. Bertrand told me, after fourteen years. The Fellow did it. I said I wasn't sure they'd last the week.", importance: 10}
{memory: tib, "I heard the tower first. Fourteen steps and a drainpipe. Margo told me to write it on my arm. It's still there.", importance: 8}
[[else]]
{memory: bertrand, "The Fellow brought the pinion but the gears wouldn't settle. I lent her one chime. She is waiting for the right mesh, and so am I.", importance: 8}
{memory: hollis, "One chime from the tower, then stopped at sixteen eighteen. Bertrand has the part. Late again.", importance: 6}
{memory: margo, "The pinion is real and in Bertrand's hands. One chime, then nothing. I'd like the gears to be solved by someone with steadier hands than mine.", importance: 8}
{memory: pell, "One chime from the tower. The Fellow brought the pinion. I said I wasn't sure they'd last the week.", importance: 8}
{memory: tib, "I heard the one chime first. Obviously.", importance: 7}
[[end]]
{set: s07_done}
{set: clock_chimed}
```
