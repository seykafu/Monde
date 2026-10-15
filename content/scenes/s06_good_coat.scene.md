#### S06 · The Man in the Good Coat
```yaml
id: s06_good_coat
day: 10
time: "11:00-16:00"
place: old_quarter.fountain_square
trigger: "!flag.s06_done && day >= 10 && flag.s04_done && player.zone == 'old_quarter'"   # Vane drives in Tue/Thu/Sat; D10 is a Thursday
backdrop: bg_fountain_square_work
music: vane_theme
cast: [vane, ines, pell, kasimir]
sets: [s06_done, met_vane, met_ines]   # plus ONE of: vanes_coin + vanes_coin | vane_offer_open | vane_declined; vane_asked_about_pell if chosen
```
```script
{fade}
N: A long grey car rolls into Fountain Square at walking pace, and the pigeons make room.
N: Bastien is on the bonnet before it has stopped. The driver's door opens. A tall man in a charcoal coat gets out, looks at the cat, and lets the cat look back.
N: Silver at the temples. A pocket square folded to a point. He smiles half a second before he speaks.
VANE [warm]: Don't move him. He's earned it.
N: The other door opens. A young woman in a charcoal skirt suit puts a heel on the cobbles, tests it, and changes her mind about the second.
INES [neutral]: Forgive me. I'm told the cobbles are original. I'd have preferred a note.
VANE [laugh]: My assistant, Delacroix. Delacroix, the Fellow.
INES [neutral]: Fellow. To be clear, I'm only here to carry the folder.
N: The folder is thick and brown. She carries it like something that might spill.
VANE [neutral]: Silas Vane. Vane Consolidated. The trailer on the Wharf with the good aerial. I've wanted to meet you since the ad ran.
VANE [warm]: I'll say "Fellow" today. It's rude to use a name before it's offered.
VANE [warm]: You've been busy. (looks at the chalk plank leaning on the basin) Clean columns. I like a plan on a plank.
KASIMIR [neutral]: It's a plank.
VANE [laugh]: It is. A very honest one.
KASIMIR [neutral]: (turns the rule over in his fingers) Don't lean on it.
N: Vane steps back from the plank with every sign of gratitude.
N: Across the square, Pell comes out of the Town Hall with a tin of lamp wicks under her arm. She sees the car. She stops walking.
VANE [warm]: Edwina!
N: Pell lifts one hand, the way you lift a hand to a bus that has already gone by.
PELL [neutral]: Mr. Vane. The lamps.
N: She turns around and goes back inside the Town Hall, with the wicks still under her arm.
VANE [warm]: (watches the door close) She's the busiest woman I know. I find that restful in a person.
N: Ines writes something in a small notebook. It takes one line.
VANE [neutral]: Walk with me.
N: He doesn't wait to be followed. Four steps from the plank, he stops, and you have stopped too.
VANE [neutral]: May I be frank?
VANE [neutral]: I grew up in a town like this one. First the shops went. Then the school. Then my father's job.
VANE [neutral]: Everyone who stayed was lovely, and it made no difference. A place can be loved and still be empty.
VANE [warm]: So when I look at Monde I don't see a failure. I see something dear that's tired. The kind thing to do for a tired place is to plan for it.
VANE [neutral]: That's all Vane Consolidated is. A small field office, a great many drawings, and a neighbor who'd like to be useful.
N: You nod. It's hard not to. He says the true things first.
VANE [neutral]: Here's what I'd like. Fifty coins a week. In return, once a week over coffee, you tell me what Monde needs and what it doesn't. Honestly. Particularly the unflattering parts.
VANE [warm]: People rarely tell me when I'm wrong.
N: Ines has a sheet out of the folder before the sentence is over. LETTER OF ENGAGEMENT, typed, with a blank for a signature. The first line reads: Advisory services concerning the development potential of the Wharf. The second page is longer than the first.
N: When Vane said fifty, her pen stopped. It starts again.
>> CHOICE
- "Fifty a week for coffee? Where do I sign?" → {set: vanes_coin}; {coins: +50}; {regard: vane +8}; goto v_accept
- "Let me think about it." → {set: vane_offer_open}; {regard: vane +2}; goto v_defer
- "No, thank you." → {set: vane_declined}; {regard: vane +1}; goto v_decline
- "Does the Mayor know about this?" → {set: vane_asked_about_pell}; goto v_pell

:: v_pell
VANE [warm]: Vane Consolidated has long been a friend of the town. Edwina knows that better than anyone.
N: That's an answer to a different question. Ines's pen scratches once and stops.
VANE [neutral]: The offer's between friends, Fellow. I'd like to keep it that way.
>> CHOICE
- "Fifty a week for coffee? Where do I sign?" → {set: vanes_coin}; {coins: +50}; {regard: vane +8}; goto v_accept
- "Let me think about it." → {set: vane_offer_open}; {regard: vane +2}; goto v_defer
- "No, thank you." → {set: vane_declined}; {regard: vane +1}; goto v_decline

:: v_accept
N: You sign. The coins come out of the folder in an envelope: fifty, counted twice, in her handwriting.
VANE [warm]: Splendid. Coffee Thursday. Delacroix will find a time.
INES [neutral]: I'll see that it's minuted.
N: She doesn't look up. She writes the date, the sum, and your name, and underlines nothing.
{goto: v_exit}

:: v_defer
VANE [warm]: Of course. Let's be sensible. Delacroix will hold the letter for a week. After that I'll assume you're busy, which is a good thing to be.
INES [neutral]: To be clear, I'll bring it to the cottage.
{goto: v_exit}

:: v_decline
N: Vane pauses for exactly as long as it takes to decide that he doesn't mind.
VANE [neutral]: Quite right to say it plainly. Thank you.
VANE [warm]: The door stays open all the same. Tuesdays, Thursdays, Saturdays. No hard feelings, ever.
INES [neutral]: (closes the folder) I'll see that it's minuted.
{goto: v_exit}

:: v_exit
VANE [warm]: Lovely square. I mean that. (nods at the plank) Honest plank.
KASIMIR [neutral]: Hm.
N: Vane looks once at the clocktower. Seventeen past four.
VANE [thinking]: A good movement, I'm told. A pity.
N: Bastien steps off the bonnet only when the engine starts. There's a single paw print on the grey paint. Vane looks at it for one second.
INES [neutral]: (halfway into the car, quietly) My door's the second floor of the Gull & Anchor. Weekdays. If you ever need anything minuted.
N: The car goes down toward the Wharf. The square comes back a bit at a time.
[[if flag.vanes_coin]]
KASIMIR [neutral]: Fifty.
KASIMIR [neutral]: Buys a lot of pipe.
[[else]]
KASIMIR [neutral]: Hm. Could be.
[[end]]
[[if flag.vanes_coin]]
{memory: vane, "Met the Fellow at the fountain. They took the retainer without a fuss. Fifty a week. Coffee on Thursdays. They asked nothing I couldn't answer.", importance: 8}
{memory: ines, "The Fellow signed the letter of engagement at the fountain. I wrote down the sum and the date. The second page is longer than the first, and they didn't ask for it.", importance: 8}
[[elif flag.vane_offer_open]]
{memory: vane, "Met the Fellow at the fountain. They want to think about the retainer. A week. That's reasonable. I rather like them.", importance: 7}
{memory: ines, "The Fellow asked for a week on the letter of engagement. I'm to bring it to the cottage. I wrote the date. I didn't write why my pen stopped.", importance: 8}
[[else]]
{memory: vane, "Met the Fellow at the fountain. They declined the retainer plainly and without heat. The door stays open.", importance: 7}
{memory: ines, "The Fellow declined the letter of engagement at the fountain. Mr. Vane didn't mind. I wrote that down and then crossed it out.", importance: 8}
[[end]]
{memory: pell, "Vane's car came into Fountain Square. I went back inside with the wicks. The Fellow saw me go.", importance: 7}
{memory: kasimir, "Vane stood by the plank. Said clean columns. Offered the Fellow money. Hm.", importance: 5}
{set: s06_done}
{set: met_vane}
{set: met_ines}
```
