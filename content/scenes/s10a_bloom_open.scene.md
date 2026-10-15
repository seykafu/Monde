#### S10a · Bloom Fair (opening)
```yaml
id: s10a_bloom_open
day: 25
time: "12:00-14:00"
place: commons.sundial_lawn
trigger: "!flag.s10a_done && day == 25"       # festival scene: the engine summons the player to the Commons when the window opens
backdrop: bg_commons_fair_noon
music: fair_bright
cast: [pell, june, teo, margo, tib]
sets: [s10a_done, bloom_fair_open]   # plus exactly one of fair_band_low / fair_band_mid / fair_band_high; plus vane_tulips_displayed or vane_tulips_refused or vane_tulips_pond
```
```script
{fade}
N: The Commons on the twenty-fifth morning of spring. The Old Elm is in new leaf and everything else is fighting its way back through the grass.
N: The bandstand's roof lies where it fell. The Glasshouse glints in places. Somebody has weeded a path from the gate to the sundial and strung paper flags over it, and most of them are still up.
[[if pillar.spirit < 35]]
{goto: band_low}
[[elif pillar.spirit < 60]]
{goto: band_mid}
[[else]]
{goto: band_high}
[[end]]

:: band_low
{set: fair_band_low}
N: Seven stalls on a lawn built for forty. A trestle of Odile's buns, a trestle of Teo's seedlings, and a trestle of nothing under a sign that says RAFFLE (PRIZE: A HAIRBRUSH).
N: Forty people, perhaps, and half of them are stallholders eating each other's buns.
{ai_line: fair_roz_low, speaker: rosalind, brief: "Roz Hale, serving cider at the fair tent, murmurs one sentence to nobody in particular about how few people have come to Bloom Fair and how many cups she put out. Warm, a little wistful. 'Between us' is allowed. No mention of Vane, the Option Clause or the Tollmen."}
{fallback: "Between us, pet, I put out sixty cups. I'll be drinking the rest myself."}
N: June sits on the tailgate of Kasimir's flatbed beside the ruined bandstand, tuning a fiddle for an audience of Bastien.
JUNE [neutral]: (plays four bars and stops) Anyway. It's early.
{goto: ribbon}

:: band_mid
{set: fair_band_mid}
N: A dozen stalls, bunting up on both lampposts, a queue at the cider tent, a queue at Odile's, and a gap in the middle of the lawn where a crowd is deciding whether to be one.
N: Seventy people, perhaps. Children run through the middle of them like a dropped thread.
{ai_line: fair_roz_mid, speaker: rosalind, brief: "Roz Hale, serving cider at the fair tent, murmurs one dry sentence about how many more people have turned up than she guessed, with a small complaint about the cider queue or a barrel. 'Between us' or 'I couldn't say, but' is allowed. No mention of Vane, the Option Clause or the Tollmen."}
{fallback: "Between us, I'd have said fifty. There's near enough a hundred. Mind the barrel, pet, it's a talker."}
N: June sits on the tailgate of Kasimir's flatbed, and the flatbed has acquired a ring of small children.
JUNE [laugh]: (plays eight bars) Sure. Go on, ask for the pirate one.
{goto: ribbon}

:: band_high
{set: fair_band_high}
N: Twenty stalls and a queue for the queue. Paper flags on every post. The lawn is a crowd in spring clothes, and the Old Elm has a child in it.
N: A hundred and fifty, two hundred. You stop counting because Pell has stopped, and Pell is counting nothing at all. She stands in the middle of it with her mouth slightly open.
{ai_line: fair_roz_high, speaker: rosalind, brief: "Roz Hale, run off her feet at the fair's cider tent, says one delighted, breathless sentence about running out of cups. 'I couldn't say, but' is allowed. No mention of Vane, the Option Clause or the Tollmen."}
{fallback: "I couldn't say, but I've run out of cups. Run out, pet. I never run out."}
N: Kasimir's flatbed has a crowd around it three deep. June hasn't noticed. She's looking at her hands.
JUNE [surprised]: (stops mid-bar, looks up, sees them) Oh. Hi, friends. (starts again, louder)
{goto: ribbon}

:: ribbon
N: Pell stands on an upturned crate in front of the sundial with a ribbon, a pair of scissors and no notes.
N: Margo, beside the Marks table, closes her eyes.
MARGO [neutral]: The ribbon is the council's. It's been cut eleven years running. It's the same ribbon.
PELL [neutral]: (taps the scissors on the crate) A minute, if I may. I'll say it plain. It's Bloom Fair. Cider at Roz's, buns at Odile's, the riddle trail is Tib's and he has views.
[[if pillar.spirit < 35]]
PELL [warm]: There are fewer of us than I'd hoped for. It makes the buns go further.
{sfx: thin_applause}
[[elif pillar.spirit < 60]]
PELL [warm]: There are more of us than the last three years put together. I counted. Forgive me.
{sfx: fair_cheer}
[[else]]
PELL [surprised]: Well. (looks at the lawn, takes her glasses off) I had a speech.
TIB [laugh]: (from the elm) Cut the ribbon!
{sfx: fair_cheer}
[[end]]
N: She cuts the ribbon. It was already cut. She finds a new place to cut it, and Margo breathes out.
N: Across the lawn a delivery van has set a crate down at the Glasshouse gate and driven off. Teo stands over it the way you'd stand over a sleeping dog.
TEO [worried]: (reads the card) "With Mr. Vane's compliments." Sorry. It's, well. Forty tulips. Cut. Very good ones. Oh, bother.
TEO [sad]: I've grown for three years. They're better than mine. Sorry.
>> CHOICE
- "Set them out on the swap table. They're flowers." → {regard: teo +2}; {pillar: charm +2}; {set: vane_tulips_displayed}; goto tulips_shown
- "Send them back." → {regard: teo +3}; {regard: vane -1}; {set: vane_tulips_refused}; goto tulips_refused
- "Teo, what do you want to do with them?" → {regard: teo +5}; {set: vane_tulips_pond}; goto tulips_asked

:: tulips_shown
TEO [neutral]: (quietly lifts the first one out by the stem) They'll look nice. Sorry. They will. That's the trouble.
N: By two o'clock the tulips are the brightest thing on the lawn, and half the lawn has asked who sent them.
{goto: tulips_end}

:: tulips_refused
TEO [surprised]: Back? To the, to the trailer? (the corner of his mouth moves) I could carry them. I'd like to carry them.
N: He sets off for the Wharf with the crate held like a sleeping child, murmuring to the top tulip. Nobody on the lawn asks why.
{goto: tulips_end}

:: tulips_asked
TEO [thinking]: (hands busy with the crate's straw) By the pond. Where nobody's selling anything. I'd, I'd rather they weren't a present from anyone. Just there.
N: He plants them one by one in the damp bank of the duck pond. Nobody puts a sign.
{goto: tulips_end}

:: tulips_end
{ai_line: fair_nell_herring, speaker: nell, brief: "Nell Dunmore, selling fried herring in paper cones from a trestle at the fair, says one blunt sentence about the price of a cone or about the size of the crowd. Wharf voice. No mention of Vane, the Option Clause or the Tollmen."}
{fallback: "Look. Herring's two coins a cone, and I'll sell you three if you stand there looking hopeful."}
TIB [neutral]: (arriving at a run with a clipboard of his own) Riddle trail starts at the elm. Twelve clues. Prize is a jam sandwich. Obviously there are only eleven jam sandwiches.
N: Music at six, says the chalkboard by the gate. Closing at sunset.
{regard: tib +2}
{regard: teo +1}
{regard: june +1}
{memory: pell, "Cut the Bloom Fair ribbon on the sundial lawn. Margo winced. The Fellow was there and saw me count the crowd.", importance: 8}
{memory: teo, "Mr. Vane sent forty tulips to the fair with his compliments. The Fellow stood next to me while I decided what to do with them. Hortensia was no help.", importance: 7}
{memory: june, "Played the tailgate at Bloom Fair while the crowd decided whether to be a crowd. The Fellow stopped to listen. I said anyway too soon.", importance: 5}
{memory: tib, "Ran the riddle trail at Bloom Fair. Twelve clues, eleven jam sandwiches. Margo says that is a flaw in the design.", importance: 6}
{memory: margo, "The council's ribbon was cut for the twelfth time. It is the same ribbon. The Fellow stood beside the Marks table and didn't say a word.", importance: 4}
{set: s10a_done}
{set: bloom_fair_open}
```
