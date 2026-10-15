#### E2 · Mandate
```yaml
id: e2_mandate
day: 100
time: "21:00-23:30"
place: old_quarter.fountain_square
trigger: "scene_call:s23_lantern_night && vote.winner == 'player' && vote.share >= 55 && vote.share < 65"
backdrop: bg_fountain_square_night
music: lantern_night_warm
cast: [pell, vane, ines, tib, margo, hollis, bertrand, odile, nell]
sets: [ending_e2, olive_branch]
```
```script
N: Pell reads the last line. She steadies the sheet against her chest, and then she reads the number again, in case it's changed.
PELL [warm]: {name}, {run.player}. That's {vote.share} per cent.
N: The cheer comes in a wave, from the Old Quarter end of the square first, and crests over the fountain. On the far side of the water, a large block of people stay quiet. They're holding their lanterns very correctly.
HOLLIS [neutral]: Fifty-eight and a bit. I'd have said fifty-six.
TIB [laugh]: (up on the rim, waving the slate) We won! We won, we won, we won!
[[if flag.pinion_found]]
N: Up in the dark, the clocktower strikes. Once. A single, slightly cracked bell.
BERTRAND [surprised]: Oh, you old fool. You spent it.
[[end]]
{insert: ins_charter}
N: Vane crosses the square without his coat buttoned. Ines carries the folder like a tray with nothing on it.
VANE [neutral]: Congratulations. You have the Row, you have the Wharf, you have Millbrook.
VANE [neutral]: A good deal of this square voted for me. Remember them on Monday.
>> CHOICE
- "Invite his voters to the first council meeting, by name." → {set: olive_branch}; {pillar: spirit +3}; {regard: vane +5}; goto e2_branch
- "Thank everyone, and go home." → goto e2_home
:: e2_branch
VANE [surprised]: (a pause the length of one breath) That's either very clever or very kind.
VANE [neutral]: I'll tell them to come.
N: Along the far edge of the square, one or two lanterns turn to look.
{goto: e2_after}
:: e2_home
N: You thank them. The square cheers again, politely, the way one cheers a speaker who has finished.
{unset: olive_branch}
{goto: e2_after}
:: e2_after
{insert: ins_vane_coin}
{insert: ins_rook}
{insert: ins_school}
{insert: ins_station}
{insert: ins_romance_1}
{insert: ins_romance_2}
{insert: ins_romance_3}
{insert: ins_pell}
N: Midnight, or close to it. The fountain is still running. Someone has hung a lantern on the heron's beak, and it stays.
{pillar: spirit +6}
{set: ending_e2}
{memory: pell, "The Fellow won with a clear majority. I gave them the keys. A third of the square voted for Silas, and I think the Fellow noticed.", importance: 10}
{memory: vane, "Lost by a clean margin. A third of the square was mine. I'll remember that on Monday.", importance: 9}
{goto_scene: epilogue_e2}
```
