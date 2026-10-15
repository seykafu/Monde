#### E3 · Squeaker
```yaml
id: e3_squeaker
day: 100
time: "21:00-24:00"
place: old_quarter.fountain_square
trigger: "scene_call:s23_lantern_night && vote.winner == 'player' && vote.share < 55"
backdrop: bg_fountain_square_night
music: lantern_night_tense
cast: [pell, vane, ines, tib, margo, hollis, augusta, odile, bertrand]
sets: [ending_e3, recount_public]
```
```script
N: Pell reads the last line and stops. She looks at the sheet. She looks at Margo. Margo looks back.
PELL [worried]: {name}, {run.player}. Mr. Vane, {run.vane}.
PELL [worried]: That's {vote.share} per cent.
N: Nobody cheers. For a second no one is sure they're allowed.
HOLLIS [worried]: (barely audible) By {vote.margin}.
N: Then a sound begins from somewhere behind the Row, a cheer with a question mark on the end of it, and the square takes it up.
VANE [neutral]: (stepping to the fountain rim, not loudly) Edwina. By the by-law I'm entitled to ask. I'd like a recount.
PELL [neutral]: You are. It's in the by-law. It's in my handwriting.
N: Every head turns to you. It isn't yours to refuse, and everyone knows it. What you do with it is up to you.
>> CHOICE
- "Welcome it. Count again, here, aloud, in front of everyone." → {set: recount_public}; {pillar: spirit +4}; {regard: vane +6}; goto recount
- "Tell Pell to do whatever the by-law says." → goto recount
- "Say a recount insults the people who counted." → {pillar: spirit -3}; {regard: vane -5}; {unset: recount_public}; goto recount
:: recount
N: Augusta stands at the fountain steps with two men and the ballot box. Margo takes the first stack. Hollis takes the second. Tib sits on the rim with the chalk and the slate and doesn't touch either.
N: It takes forty minutes. Nobody leaves. Odile passes bread down the rows again, and this time people eat it.
[[if flag.recount_public]]
N: Where the square is thinnest, a few of Vane's voters have come across the water to stand beside the counters. Nobody remarks on it.
[[end]]
N: Bastien has walked into the middle of the table and sat on a stack of ballots. Augusta looks at him. She counts around him.
HOLLIS [neutral]: (under his breath, lips moving, a long time) ...and that's the last.
N: He has the total before Margo does. He doesn't say it. He watches her get there, and then he nods once.
PELL [neutral]: The recount confirms the count.
PELL [neutral]: {name}, {run.player}. Mr. Vane, {run.vane}. Mr. Ferrante, {run.moss}. By {vote.margin}.
[[if flag.pinion_found]]
BERTRAND [neutral]: (watch in his hand, to the dark clock) Not tonight. Let it rest.
[[end]]
N: Vane shakes your hand. It's a dry, brief handshake. Both of you are very tired.
VANE [neutral]: I'd have asked, too.
VANE [neutral]: I'll be in the second row at council. Every session. You'll hear me.
{insert: ins_charter}
{insert: ins_vane_coin}
{insert: ins_rook}
{insert: ins_school}
{insert: ins_station}
{insert: ins_romance_1}
{insert: ins_romance_2}
{insert: ins_romance_3}
{insert: ins_pell}
PELL [neutral]: (at the fountain's edge, the keys in her hand) Half the square voted for him. You'll want to go and meet them. I'd start with the ones who brought lanterns and didn't light them.
N: The lanterns burn down. The wind from the bay is cold now. Nobody has moved.
{pillar: spirit +3}
{set: ending_e3}
{memory: pell, "A recount, in the square, at midnight, with a cat on the ballots. The Fellow won by a hair. I gave them the keys and told them the truth about the other half.", importance: 10}
{memory: vane, "Lost by a hair and asked for the recount. The Fellow let me have it. I'll sit in the second row.", importance: 9}
{memory: hollis, "Counted the recount under my breath. Same number. I got there first.", importance: 8}
{goto_scene: epilogue_e3}
```
