#### E1 · Landslide
```yaml
id: e1_landslide
day: 100
time: "21:00-23:30"
place: old_quarter.fountain_square
trigger: "scene_call:s23_lantern_night && vote.winner == 'player' && vote.share >= 65"
backdrop: bg_fountain_square_night
music: lantern_night_joy
cast: [pell, vane, ines, tib, margo, hollis, bertrand, odile, nell]
sets: [ending_e1]
```
```script
N: Pell reads the last line. The paper shakes in her hands, and Margo takes the bottom corner to hold it still.
PELL [surprised]: {name}, {run.player}. That's {vote.share} per cent.
N: For about the length of one breath there is no sound anywhere in Monde.
N: Then Tib falls off the fountain rim, and the square goes up.
{sfx: crowd_roar}
N: Hats, lanterns, a pie tin. Odile is crying and shouting the same word over and over. Nell's men lift her off the ground without asking.
HOLLIS [neutral]: (to no one, hand coming out of his pocket) I had it a district ago.
[[if flag.pinion_found]]
N: Up in the dark, the clocktower strikes. Once. One bell, round and a little cracked, across all of the Old Quarter.
BERTRAND [surprised]: (hand over his mouth, watch open in the other) Oh, you old fool. You spent it.
{regard: bertrand +5}
[[end]]
{insert: ins_charter}
N: Silas Vane comes round the fountain through a crowd that parts for him and doesn't speak. Ines is behind him with the folder shut.
VANE [neutral]: Congratulations.
VANE [neutral]: The Wharf went to you. I'd not have bet on that.
VANE [warm]: (turns, lifts his voice to the square) Friends, you've chosen. I won't insult you with a recount. The Mayor-elect will have my hand tonight and my plans for the harbor in the morning, which they're free to burn.
{sfx: applause_warm}
N: He lowers his voice. Only you can hear it.
VANE [neutral]: I'll sell the harbormaster's house.
VANE [neutral]: No. I won't. The gulls know me.
{insert: ins_vane_coin}
{insert: ins_rook}
{insert: ins_school}
{insert: ins_station}
{insert: ins_romance_1}
{insert: ins_romance_2}
{insert: ins_romance_3}
{insert: ins_pell}
N: Late. The lanterns are going out one at a time, and nobody is in a hurry to go home.
N: Bastien has come from somewhere and is sitting on your feet. He doesn't move for anyone.
{pillar: spirit +10}
{set: ending_e1}
{memory: pell, "I handed the Fellow the keys. They're Mayor now. I think I will sleep.", importance: 10}
{memory: tib, "The Fellow won by a landslide. I fell off the fountain.", importance: 10}
{memory: vane, "Lost, and by a lot. I'm not surprised I minded less than I'd planned.", importance: 9}
{goto_scene: epilogue_e1}
```
