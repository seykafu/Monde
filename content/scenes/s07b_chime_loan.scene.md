#### S07 · Quarter Chime (variant B: one borrowed chime)
```yaml
id: s07b_chime_loan
day: 14
time: "16:00-17:45"
place: old_quarter.clocktower
trigger: "!flag.s07_done && day >= 14 && !flag.pinion_found && player.zone == 'old_quarter'"
backdrop: bg_clocktower_square
music: clock_hush
cast: [bertrand, pell, margo, tib, hollis]
sets: [s07_done, clock_chimed, clock_pending_pinion]   # plus remembered_chime if chosen. The later fitting is PZ-15 (§15), fired when OQ-5 is solved.
```
```script
{fade}
N: Four o'clock on the fourteenth day, and the Old Quarter is doing what it does at four: nothing, thoroughly.
N: Bertrand waits at the foot of the clocktower with a small leather roll under his arm and a stick he doesn't lean on. Bastien sits on the bottom step.
BERTRAND [warm]: Young person. Fourteen days. I told Eddie fourteen days was my guess. I've lost a bet and I'm delighted.
BERTRAND [thinking]: I can't make her run. She lacks the lantern pinion, and Aurélien hid it where only he could be sure of finding it again.
BERTRAND [neutral]: What I can do is borrow a pinion off a travelling clock, fit it for one afternoon, and let her say one thing before she stops.
BERTRAND [neutral]: Call it encouragement. For her, and for the rest of you.
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
BERTRAND [warm]: Then you can tell me whether I've borrowed the right voice. Come up.
{goto: climb}

:: hc_never
BERTRAND [warm]: Then you're in for a surprise. Come up.
{goto: climb}

:: climb
BERTRAND [neutral]: Mind the third stair. It strikes a flat G.
N: Ninety-six steps, and the third one sings.
N: Under the face the works fill the room. Bertrand sets a small brass wheel into the empty seat with the tenderness of a man tucking in a child, and checks the watch he winds without looking at.
BERTRAND [neutral]: Four-seventeen, as near as I can make it.
{wait}
{sfx: clock_tick}
N: The minute hand moves. One minute, from seventeen to eighteen.
{sfx: clock_chime}
{cam: shake}
N: Four soft notes, one under another, falling down the face of the tower into the square.
N: Then the hand twitches once more and holds still at eighteen past four.
{fade}
N: Down in the square people have stopped where they were. Pell in the Town Hall doorway, one hand flat on her chest.
TIB [surprised]: (at a dead run across the cobbles) I heard it first! I was in the alley! Fourteen steps and a drainpipe!
MARGO [thinking]: (arrives behind him, gloves in one hand) One. And then it stops.
MARGO [neutral]: The lantern stamp is cut on the escapement cover. Old Quarter chain. The Hours. Five Marks, and the fifth is somewhere that strikes. I'd put a month's pencils on it.
PELL [warm]: (comes down the steps with the lamp wicks under her arm) Heavens, Bertrand. One is more than I had.
BERTRAND [neutral]: A loan, Eddie. Not a gift.
N: At the edge of the square a tall, rangy man with a heavy grey moustache stands with a watch open on its chain. He has come down from Station Hill without a coat.
HOLLIS [neutral]: (checks the watch with his thumb) One. Sixteen eighteen and four seconds.
BERTRAND [neutral]: A loan, Hollis.
HOLLIS [neutral]: Late. And short.
N: He shuts the watch and goes. He doesn't look at Bertrand, and Bertrand watches him all the way to the corner.
{pillar: spirit +2}
{pillar: charm +1}
PELL [warm]: (quietly, as the square starts moving again) Fourteen days. I wasn't sure you'd last the week.
[[if regard.pell >= 40]]
PELL [warm]: {name}. Thank you. I'm not saying it well.
[[end]]
{memory: bertrand, "Borrowed a pinion off a travelling clock and gave the tower one chime for the Fellow's fourteenth day. She stopped at eighteen past. The real one is still hidden. Hollis said short.", importance: 8}
{memory: hollis, "One chime from the tower on the fourteenth day. Sixteen eighteen and four seconds. Late and short. Bertrand watched me to the corner.", importance: 7}
{memory: margo, "One chime from the tower. The Old Quarter chain ends in a place that strikes. I said so out loud. Tib wrote it on his arm.", importance: 8}
{memory: pell, "One chime from the tower on the Fellow's fourteenth day. I said I wasn't sure they'd last the week. They had.", importance: 8}
{memory: tib, "I heard the one chime first. Obviously. It stopped again at eighteen past.", importance: 7}
{set: s07_done}
{set: clock_chimed}
{set: clock_pending_pinion}
```
