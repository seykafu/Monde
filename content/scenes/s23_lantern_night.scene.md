#### S23 · Lantern Night
```yaml
id: s23_lantern_night
day: 100
time: "19:30-23:30"
place: old_quarter.fountain_square
trigger: "!flag.s23_done && day >= 100 && player.zone == 'old_quarter'"
backdrop: bg_fountain_square_dusk
music: lantern_night
cast: [pell, vane, ines, rook, margo, tib, bertrand, hollis, odile, nell, sable, priya, june, kasimir, augusta, delphine, felix, rosalind, teo, moss, ada]
sets: [s23_done, lit_first_tib, lit_first_pell, lit_first_bertrand, lit_first_hollis]
```
```script
// Engine values after each {tally: district}: {d.player} {d.vane} {d.moss} (this district), {run.player} {run.vane} {run.moss} {run.total} (running),
// tally.d_leader and tally.run_leader ('player' or 'vane'), tally.decided (remaining ballots cannot change the winner). The scene never states the winner before tally.decided or the final.
// Residents appear if flag.met_<id> is set. This is the full roster of who the player has met.
N: Dusk on Day 100. Every lantern in Monde has been taken off its hook and carried to Fountain Square: paper lanterns on poles, glass ones on strings, one tin one that's been in the Lantern office since before Sable.
[[if flag.project_fountain_done]]
N: The fountain is running. The bronze heron stands in a ring of spray with water on its wings, the way it must have stood when someone first thought of it.
[[else]]
N: The fountain is dry. Someone has filled the bowl with candles.
[[end]]
N: The ballots were taken at the Town Hall from eight to six. Since then the doors have been shut, and the lamps have been on in the high windows. At eight the box will be carried across the square.
N: Everyone you've met in Monde is here. The ones you haven't are here too, holding lanterns, and they know your name.
N: Tib comes through the legs of the crowd with a taper in his fist.
TIB [worried]: You light the first one. The Fellow always lights the first one. I wrote it in the book.
N: You haven't been told whose.
>> CHOICE
- "Light Tib's. He drew a lantern on it, same as a Mark." → {regard: tib +4}; {set: lit_first_tib}; goto lit_tib
- "Light Pell's." → {regard: pell +4}; {set: lit_first_pell}; goto lit_pell
- "Light Bertrand's." → {regard: bertrand +4}; {set: lit_first_bertrand}; goto lit_bertrand
- "Light Hollis's." → {regard: hollis +4}; {set: lit_first_hollis}; goto lit_hollis
:: lit_tib
TIB [warm]: (holds up the lantern) It's not a real Mark. Don't tell Margo.
{goto: roll_call}
:: lit_pell
PELL [neutral]: My hands are cold. You do it. Go on.
PELL [warm]: Twenty-six years of these. I've never once had someone else hold the match.
{goto: roll_call}
:: lit_bertrand
BERTRAND [thinking]: Wick wants trimming. (trims it with a thumbnail) There. A clockmaker has to be useful for something.
{goto: roll_call}
:: lit_hollis
HOLLIS [neutral]: Quick, please. I'll need both hands free.
N: He doesn't say what for.
{goto: roll_call}

:: roll_call
N: The light goes up through the square in a slow tide, lantern by lantern, hand to hand.
[[if flag.met_odile]]
N: Odile has brought bread in a cloth and hands it down the row without asking whether anyone's hungry.
[[end]]
[[if flag.met_margo]]
N: Margo stands at the fountain's edge with a sealed ledger under her arm, the Town Hall's witness. She hasn't looked at the Town Hall once.
[[end]]
[[if flag.met_nell]]
N: Nell Dunmore has the Wharf men around her in a block, caps in their pockets, the way they stand at a funeral or a launch.
[[end]]
[[if flag.met_june]]
N: June sits on the lip of the fountain with her guitar across her knees. She isn't playing. Her fingers keep finding the strings anyway.
[[end]]
[[if flag.met_teo]]
N: Teo has brought lanterns from the Glasshouse, little ones, each with a flower pressed in the paper. He is giving them to children and not talking to anyone.
[[end]]
[[if flag.met_priya]]
N: Priya's father is beside her in a wheelchair with a blanket, holding a lantern in both hands as if it were soup.
[[end]]
[[if flag.met_kasimir]]
N: Kasimir has built two benches overnight and nobody has asked him how. He stands behind them with his arms crossed.
[[end]]
[[if flag.met_felix]]
N: Felix counts his pupils twice. They're all there. He counts them a third time anyway.
[[end]]
[[if flag.met_bertrand && flag.pinion_found]]
BERTRAND [neutral]: (patting the wall of the clocktower as he passes) She's got one chime in her. I've told her not to waste it tonight.
[[end]]
[[if flag.met_delphine]]
[[if flag.rook_turned]]
N: Delphine Mercer sits in a folding chair near the front in her good coat. Rook stands behind her with his cap in his hands. Her hand is on his sleeve.
[[elif flag.rook_exposed]]
N: Delphine Mercer sits in a folding chair near the front in her good coat. She has lit one lantern, and set a second beside it, unlit.
[[elif flag.rook_defeated]]
N: Delphine Mercer sits in a folding chair near the front in her good coat. A letter from the mainland is folded in her lap. It hasn't been opened.
[[else]]
N: Delphine Mercer sits in a folding chair near the front in her good coat. At the far edge of the square, beside a lamp-post, a big man in a mill-hand's jacket stands with his hat low. Nettie is at his elbow. Neither of them lights a lantern.
[[end]]
[[end]]
[[if flag.met_augusta]]
N: Captain Reyes and her one deputy walk the edge of the square. She nods to everyone. She has not stopped scanning the crowd.
[[end]]
N: At the far side of the fountain, Silas Vane stands in a good coat with a lantern he isn't holding. Ines is beside him with the folder. He catches your eye across the water. He crosses to you in no hurry.
VANE [neutral]: Fellow.
VANE [neutral]: Whoever it is tonight. It was well run.
VANE [neutral]: I mean that. Don't look at me like that.
N: He goes back around the fountain. Ines stays a second longer.
[[if flag.ines_trust_up]]
INES [worried]: He asked me to give you that. He didn't say how to. I've said it.
[[end]]
N: Eight o'clock. The Town Hall doors open. Augusta and two men carry out the ballot box between them, shoulder-high, through the middle of the crowd, and the crowd closes behind it.
N: Pell takes the fountain steps with a stack of tally sheets. Margo takes the corner of the top sheet. Her own hands are not steady.
PELL [neutral]: Six districts. Read in the order the boxes were sealed. I didn't pick the order. Sable drew it from a hat, and Sable cheats at hats.
SABLE [neutral]: (from the press table) I do not.
N: Tib climbs onto the fountain rim with a stub of chalk and a slate that was a door last week.
N: Hollis stands in the second row with one hand in his coat pocket, lips already moving.

:: d_oq
{tally: old_quarter}
PELL [neutral]: Old Quarter. {name}, {d.player}. Mr. Vane, {d.vane}. Mr. Ferrante, {d.moss}.
[[if tally.d_leader == 'player']]
N: A noise goes up from the front of the square and dies back as if embarrassed. No one wants to be the first to cheer.
[[else]]
N: A low sound from by the grey caps, the sound of people who expected it.
[[end]]
[[if tally.d_moss == 0]]
N: Moss lifts his hat to the empty column.
[[else]]
MOSS [surprised]: {d.moss}! Somebody's been listening.
[[end]]
N: Tib writes the first line on the slate with his tongue between his teeth. {name}, {run.player}. Vane, {run.vane}. Ferrante, {run.moss}.

:: d_mr
{tally: market_row}
PELL [neutral]: Market Row. {name}, {d.player}. Mr. Vane, {d.vane}. Mr. Ferrante, {d.moss}.
[[if tally.d_leader == 'player']]
ODILE [neutral]: (a hand flat on her chest, as if checking something is still there) Hm.
[[else]]
ODILE [neutral]: (folds her arms) Everyone on the Row promised me they'd tell the truth in a booth. I might have to count them against the pie list.
[[end]]
[[if tally.d_moss == 0]]
N: Moss writes the zero on his cuff.
[[else]]
MOSS [laugh]: {d.moss} on the Row. Roz, was that you?
ROSALIND [neutral]: I'm not saying.
[[end]]
N: Tib rubs out a number with his sleeve, writes it again. {name}, {run.player}. Vane, {run.vane}. Ferrante, {run.moss}.
HOLLIS [neutral]: (under his breath, not looking at anyone) ...{run.total}.

:: d_wf
{tally: wharf}
PELL [neutral]: The Wharf. {name}, {d.player}. Mr. Vane, {d.vane}. Mr. Ferrante, {d.moss}.
[[if tally.d_leader == 'player']]
NELL [neutral]: (over the heads, loud) Count it again, Pell. I like the sound of it.
[[else]]
NELL [neutral]: (quietly, to the men around her) Three hundred jobs. That's what some of you heard, and that's what you voted on.
[[end]]
[[if tally.d_moss >= 6]]
MOSS [laugh]: The Wharf! The Wharf remembers the Slowest Boat!
N: The fishermen roar, to a man. It's the loudest noise of the night so far, and it isn't for either of the two serious candidates.
[[else]]
N: Moss looks around the Wharf block with a hurt, faintly accusing air.
[[end]]
N: The slate. {name}, {run.player}. Vane, {run.vane}. Ferrante, {run.moss}.
[[if tally.decided]]
N: Nobody does the arithmetic out loud. A few people have already put their lanterns down.
[[else]]
N: Nobody does the arithmetic out loud. Everyone does it.
[[end]]

:: d_cm
{tally: commons}
PELL [neutral]: The Commons. {name}, {d.player}. Mr. Vane, {d.vane}. Mr. Ferrante, {d.moss}.
N: Somewhere in the dark behind the square a duck says something. The crowd laughs, which is a relief for everyone.
[[if tally.d_moss == 0]]
MOSS [neutral]: A duck has more sense than I thought.
[[else]]
MOSS [surprised]: {d.moss} from the Commons. The pond people are with me.
[[end]]
[[if flag.met_teo]]
TEO [worried]: (holds his lantern against his chest) I don't want to know yet.
[[end]]
N: Tib has run out of slate. He starts a second column down the side of the fountain. {name}, {run.player}. Vane, {run.vane}. Ferrante, {run.moss}.
HOLLIS [neutral]: (under his breath) ...{run.total}.

:: d_mb
{tally: millbrook}
N: Pell's voice catches. She has to start again.
PELL [neutral]: Millbrook. This is the big box. {name}, {d.player}. Mr. Vane, {d.vane}. Mr. Ferrante, {d.moss}.
[[if tally.d_leader == 'player']]
N: Millbrook makes the sound of a place that has waited fourteen years to be counted.
[[else]]
N: Millbrook makes no sound at all. A hundred lanterns, held very still.
[[end]]
[[if flag.met_felix]]
FELIX [warm]: (to the child on his shoulders) Don't wriggle. Hold your lantern straight. It's an important lantern.
[[end]]
[[if flag.met_priya]]
PRIYA [neutral]: (low, to her father) Dad. Dad, you can breathe.
[[end]]
[[if tally.d_moss == 0]]
MOSS [sad]: Millbrook never had a ferry. I should have known.
[[else]]
MOSS [surprised]: {d.moss}! In Millbrook. They don't have a ferry. They've got principles.
[[end]]
N: The slate. {name}, {run.player}. Vane, {run.vane}. Ferrante, {run.moss}.
[[if tally.decided]]
N: Pell looks up from the sheet. She looks across the square. She doesn't say anything yet. She has one district left to read, and she reads it.
[[else]]
N: One district left. Pell turns over the last sheet and holds it flat with both hands.
[[end]]

:: d_sh
{tally: station_hill}
PELL [neutral]: Station Hill. The smallest box. Eleven houses and a signal box.
PELL [neutral]: {name}, {d.player}. Mr. Vane, {d.vane}. Mr. Ferrante, {d.moss}.
[[if tally.d_moss == 0]]
MOSS [neutral]: A railway district. I should have known.
[[else]]
MOSS [laugh]: {d.moss}! Hollis, did you...
HOLLIS [neutral]: No.
[[end]]
N: Tib writes the last line. He doesn't read it out. He holds the chalk, and looks at the slate, and looks at Pell.
N: Hollis's lips have stopped.

:: final
{tally: final}
N: Pell's voice drops. It's the one she uses on a doorstep when something has to be said without an audience.
PELL [neutral]: Total, all six districts. {name}, {run.player}. Mr. Vane, {run.vane}. Mr. Ferrante, {run.moss}.
MARGO [neutral]: (her hand still on the corner of the sheet) Pell. Read the rest.
PELL [neutral]: Of {run.total} ballots cast.
{set: s23_done}
{memory: pell, "Lantern Night. I read the count in my own square. I'd like to say it was easy.", importance: 10}
{memory: tib, "I chalked the whole count on a slate that used to be a door. I didn't make a single mistake.", importance: 9}
{memory: hollis, "I counted under my breath all night. I stopped when the last district was read.", importance: 8}
{memory: margo, "Lantern Night. I held the corner of the sheet while Pell read. My hands weren't mine.", importance: 8}
{memory: vane, "Lantern Night. I told the Fellow it was well run. It was.", importance: 8}
{memory: odile, "Lantern Night. I brought bread. Nobody ate it until the count was done.", importance: 6}
{memory: bertrand, "Lantern Night. I trimmed a wick. I didn't spend the chime.", importance: 6}
{wait}
[[if vote.winner == 'vane']]
{goto_scene: e4_defeat}
[[elif vote.share >= 65]]
{goto_scene: e1_landslide}
[[elif vote.share >= 55]]
{goto_scene: e2_mandate}
[[else]]
{goto_scene: e3_squeaker}
[[end]]
```
