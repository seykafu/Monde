#### E4 · Defeat
```yaml
id: e4_defeat
day: 100
time: "21:00-24:00"
place: old_quarter.fountain_square
trigger: "scene_call:s23_lantern_night && vote.winner == 'vane'"
backdrop: bg_fountain_square_night
music: lantern_night_bittersweet
cast: [pell, vane, ines, tib, margo, hollis, bertrand, odile, nell]
sets: [ending_e4, e4_checkpoint_offered]
```
```script
N: Pell reads the last line. She doesn't stop at the number. She reads the whole sheet to the bottom, because that's the job, and then she folds it in half.
PELL [sad]: Mr. Vane, {run.vane}. {name}, {run.player}. Mr. Ferrante, {run.moss}.
PELL [sad]: Mr. Vane is the Mayor-elect of Monde.
N: Quiet comes down on the square. Nobody drops a lantern.
N: Tib stands on the fountain rim with the chalk and the slate. He wants to rub out the last line. Margo puts a hand on his ankle.
MARGO [sad]: Leave it. It's accurate.
N: The fountain is running. On Station Hill a single lamp is lit above the platform. Along Market Row there are more shutters up tonight than on any Lantern Night in fourteen years. You put up most of them.
HOLLIS [neutral]: (lowers his hand from his coat pocket) Closer than I'd thought.
ODILE [angry]: (pushes bread into your hands, hard) Eat. Eat that. I'm not saying anything else.
N: Silas Vane steps onto the fountain's lowest step. There's no crate. He doesn't take the folder from Ines.
VANE [neutral]: Thank you.
VANE [neutral]: I had a speech. It's good. I won't give it.
VANE [warm]: Three things. The shutters on the Row stay up. The train keeps its Friday. And the door at the Town Hall stays open to anyone who wants to tell me I'm wrong. Ten to four, the second floor.
N: He steps down. Lowers his voice to you, no one else near.
VANE [neutral]: I came to buy a harbor from a dying town. It was still breathing. I should have checked.
VANE [neutral]: I'd like you to stay. Edwina would like it. So would the pie.
{insert: ins_not_registered}
{insert: ins_charter}
{insert: ins_vane_coin}
{insert: ins_rook}
{insert: ins_school}
{insert: ins_station}
{insert: ins_romance_1}
{insert: ins_romance_2}
{insert: ins_romance_3}
{insert: ins_pell}
N: Later. The square has emptied by a third. Pell sits on the lowest fountain step with her hat on her knee. You sit beside her. Tib sits beside you, with the slate.
PELL [warm]: I lost my first two runs for Council, you know. I was twenty-nine and I campaigned on a bicycle.
TIB [worried]: What if...
MARGO [neutral]: (the signature tin open in her lap, page one empty) Everyone has a day they'd walk back to. Yours would be the morning registration opened.
BERTRAND [thinking]: (watch open) A spring can only be wound back to the tooth it was set at. This one was set at the seventieth.
N: No one says it's possible. No one says it isn't. The tin sits open on Margo's knee.
{set: e4_checkpoint_offered}
>> CHOICE
- "What if..." → {load_checkpoint: campaign_season}
- "Stay with this." → goto e4_stay
:: e4_stay
PELL [warm]: (puts her hat back on) Good. It's a good town to lose in. There's bread.
N: Bastien steps over the tin and settles on your lap. He doesn't care who the mayor is.
{pillar: spirit +2}
{set: ending_e4}
{memory: pell, "The Fellow lost, and the town is better than it was in the spring. I told them. I don't know if they heard me.", importance: 10}
{memory: vane, "Won. I'll keep the shutters up. I'll keep the train. I asked the Fellow to stay.", importance: 9}
{memory: tib, "The Fellow lost. I wanted to rub out the numbers. Margo said leave it.", importance: 9}
{goto_scene: epilogue_e4}
```
