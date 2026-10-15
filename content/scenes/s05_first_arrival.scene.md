#### S05 · First Arrival
```yaml
id: s05_first_arrival
day: 7
time: "07:45-09:30"
place: wharf.ferry_slip
trigger: "!flag.s05_done && day >= 7 && ferry_day && appeal >= 35"   # first sailing day on/after D7 with Appeal >= 35 (earliest D8)
backdrop: bg_ferry_slip_morning
music: slip_morning
cast: [pell, moss, sable, arrival]
sets: [s05_done, first_arrival_seen, met_sable]   # plus arrival1_walked, pell_deflected_count if chosen
```
```script
N: The *Gannet* comes round the breakwater with someone standing at the rail: a bag between their feet, one hand on their hat.
MOSS [neutral]: (throws the rope; it lands on the bollard the first time, and he looks at it like a stranger) One passenger. Heavy bag.
[[if flag.s05_b_seen]]
PELL [worried]: (has stopped breathing a little) You were here when the slip was empty. I'd like you here for this.
[[else]]
PELL [worried]: (has stopped breathing a little) Oh. Oh, heavens.
[[end]]
N: Sable Moreau, ink to the wrists, a box camera on a strap, is at the foot of the slip already. She's been there since seven, in case.
N: The passenger comes down the planks, watching their feet. At the bottom they stop in front of Pell, who is holding the clipboard to her chest like a hymn book.
{ai_line: arrival_intro, speaker: arrival, brief: "A newcomer steps off the Monde ferry and tells the mayor their name and why they came, in one or two plain sentences, using their own persona card (trade, last town, something they carried). A little nervous, a little dry. No mention of the Fellowship, Vane, the Option Clause or any brand. 35 words at most."}
{fallback: "Name's {arrival.name}. {arrival.trade}, mostly. {arrival.reason} Is this the right slip?"}
PELL [warm]: (takes their hand in both of hers and keeps it a beat too long) Edwina Pell. Mayor. You're very welcome.
PELL [neutral]: (almost to herself) One more.
SABLE [neutral]: Name. Spell that.
N: The camera flashes. Bastien walks into the shot and stays in it.
N: The newcomer spells their name. Sable writes it down wrong. She turns to you.
SABLE [neutral]: You're the Fellow. On the record? Good. Spell your name. I'll get it wrong anyway.
N: You spell it. She does.
{ai_line: arrival_ask, speaker: arrival, brief: "The same newcomer asks the mayor for one practical thing in a single sentence: a bed, a hot meal, directions to somewhere that might need hands. Plain, no thanks yet. 25 words at most."}
{fallback: "Is there somewhere to sleep that isn't a bench? I'm not fussy about the roof."}
PELL [warm]: There's a house. It's dry. Kasimir did it on Sunday for nothing and then said nothing about it. End of Lamplighter Lane, two doors from the Fellow's.
SABLE [neutral]: Front page. Photograph, above the fold. Six words for a headline. I'd give a tooth for sixty.
>> CHOICE
- "I'll walk you up." → {regard: arrival +5}; {set: arrival1_walked}; goto a_walk
- "Pell, you should take them. It's your boat." → {regard: pell +5}; {regard: arrival +2}; goto a_pell
- "Eat first. Odile's will be open." → {regard: arrival +3}; {regard: odile +2}; goto a_odile

:: a_walk
N: You take the heavy bag, and the newcomer lets you, and neither of you mentions it.
{ai_open: arrival, topic: "The newcomer's first impressions of Monde on the walk up from the slip, what they hoped to find, and one thing they are afraid to ask. They know only what they have seen since stepping off the boat. They know nothing of the Option Clause, the Tollmen as a crew, or the Charter. Warm but guarded.", turns: 2}
{goto: a_join}

:: a_pell
N: Pell opens her mouth, shuts it, and looks at the clipboard as if it might have an opinion. Then she hands it to you.
PELL [warm]: Hold this. (offers the newcomer her arm) It's a short walk. I'll point at things.
N: It's the first time you've seen her put the clipboard down.
{goto: a_join}

:: a_odile
PELL [neutral]: Rye's two coins. Tell her Pell sent you and she'll charge you three.
N: The newcomer laughs, startled, and looks at Pell, and sees she isn't joking, and laughs again.
{goto: a_join}

:: a_join
{pillar: spirit +3}
{pillar: charm +1}
MOSS [neutral]: Twice a week. Could be more.
PELL [neutral]: Moss.
MOSS [neutral]: I'm only saying.
N: The newcomer goes up the slip with the walk of someone who doesn't yet know where the pavement ends. Sable follows with the camera, asking a question over her own shoulder.
N: Pell stays at the end of the slip. She is looking at the water.
>> CHOICE
- "You counted. Out loud." → {set: pell_deflected_count}; goto count_deflect
- "One more." → {regard: pell +3}; goto count_echo
- "(Stand beside her and say nothing.)" → {regard: pell +2}; goto count_quiet

:: count_deflect
PELL [neutral]: Habit. Mayors count things. Lamps, mostly.
PELL [neutral]: Now. I've a house to open and a kettle to find. Come and be useful.
{goto: a_end}

:: count_echo
PELL [surprised]: You heard. (takes her glasses off, puts them back on) Yes. One more.
PELL [warm]: It was the same number for such a long time. I'd forgotten what the next one looked like.
{goto: a_end}

:: count_quiet
N: The tide goes out a little way. A gull lands on the bollard Bastien has just left. Pell does not count anything.
{goto: a_end}

:: a_end
{memory: pell, "The first new resident stepped off the boat. I took their hand in both of mine and held it too long. One more, I said, out loud. The Fellow was on the slip.", importance: 10}
{memory: sable, "First new face on the Wharf in four years that I've photographed. The Fellow spelled their name. I got it wrong anyway. Front page, above the fold.", importance: 8}
{memory: moss, "Carried a passenger who stayed. Said twice a week could be more. Pell said Moss.", importance: 5}
{memory: arrival, "Stepped off the ferry at Monde. A woman held my hand too long. Someone photographed me. Someone offered to carry my bag. It's a small town.", importance: 7}
{set: s05_done}
{set: first_arrival_seen}
{set: met_sable}
```
