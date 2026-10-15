#### S10b · Bloom Fair (closing)
```yaml
id: s10b_bloom_close
day: 25
time: "17:30-21:00"
place: commons.bandstand
trigger: "!flag.s10b_done && day == 25"       # festival scene: summoned
backdrop: bg_commons_fair_dusk
music: fair_dusk
cast: [pell, june, kasimir, hollis, bertrand, tib, felix]
sets: [s10b_done, bloom_fair_closed]   # plus june_hope (high band only); plus ONE of june_helped_pack / hollis_station_hint / tib_trail_done
```
```script
{fade}
N: Sunset on the Commons. The stalls are half-folded. Somebody has lit oil lamps along the sundial path, and the Old Elm has gone the color of toast.
N: Kasimir has backed the flatbed up to the ruined bandstand and dropped the tailgate into a stage. Nobody asked him to.
KASIMIR [neutral]: (checks the tailgate with his rule) True.
JUNE [neutral]: (climbs up and sits on the edge with the fiddle across her knees) Friend. Is this a stage?
KASIMIR [neutral]: It's a tailgate.
JUNE [laugh]: It's a stage.
[[if flag.fair_band_low || (!flag.s10a_done && pillar.spirit < 35)]]
{goto: close_low}
[[elif flag.fair_band_high || (!flag.s10a_done && pillar.spirit >= 60)]]
{goto: close_high}
[[else]]
{goto: close_mid}
[[end]]

:: close_low
N: Thirty-odd people on the lawn, and Roz at the back with her arms folded, like a bouncer for an empty room.
JUNE [neutral]: (looks at the lawn, at the ruined bandstand, at the fiddle) Mm. Maybe I'll do the short set.
N: Four songs. The thirty people sing the second one because they know it. The fiddle goes a little thin under the Elm.
TIB [neutral]: Thirty-one. I counted twice. Obviously it's not a lot.
PELL [warm]: Thirty-one. I'll put every one of them in the Lantern by name.
JUNE [neutral]: (stands and tucks the fiddle under her arm) Anyway. Thanks for the tailgate.
N: She's off the flatbed and halfway to the gate before the applause has finished.
{pillar: spirit +3}
{goto: close_join}

:: close_mid
N: Seventy-odd people on the lawn: sitting, standing, lying down. Children asleep on coats. The cider tent has closed because the cider has.
JUNE [laugh]: (to the lawn, a full set ahead of her) Sure. This one's for whoever lost their hat.
N: She plays nine songs. On the sixth, half the lawn knows the chorus. On the ninth, that half does, and then the other half finds it.
N: By the Old Elm a man in a grey wool cap has been standing for an hour with his hands in his pockets, buying nothing. When June starts the last song, he's gone.
TIB [neutral]: Seventy-three. And a dog.
JUNE [warm]: (looking at the fiddle) That's the best I've played in this town. Anyway.
{pillar: spirit +5}
{goto: close_join}

:: close_high
N: Nearly everyone you know, and a good many you don't, spread across the lawn and the path and the lower branches of the Old Elm.
N: June plays. The Commons sings the chorus of the first song before she's reached the second line. She looks up, laughs, and lets them have it.
N: Bertrand dances with Pell, a stiff, careful waltz with a great deal of attention paid to the cobbles. Hollis doesn't dance. Hollis checks his watch, which is a kind of dancing.
N: By the Old Elm a man in a grey wool cap has been standing for an hour with his hands in his pockets, buying nothing. When June starts the last song, he's gone.
TIB [surprised]: A hundred and ninety! And Bastien! That's almost everyone!
JUNE [surprised]: (very quietly, to the fiddle) Huh.
{set: june_hope}
{pillar: spirit +4}
{goto: close_join}

:: close_join
{ai_line: fair_close_felix, speaker: felix, brief: "Felix Amari, folding the school banner at the end of Bloom Fair, says one gentle sentence about the pupils and how they spent the day. He uses a pupil's name or says 'nine'. Mock-solemn, never sarcastic. No mention of Vane, the Option Clause or the Tollmen."}
{fallback: "Goodness. Nine of them, and every one fell asleep on a different coat."}
PELL [warm]: (from the crate, in a small, level voice) Thank you for coming. Eat the rest of the buns. Odile will pretend she didn't see.
N: The oil lamps burn along the sundial path. Pell counts them under her breath, and for once it's a number she likes.
>> CHOICE
- "Help Kasimir and June pack the flatbed." → {regard: kasimir +3}; {regard: june +4}; {set: june_helped_pack}; goto last_pack
- "Sit with Hollis and Bertrand on the bench." → {regard: hollis +4}; {regard: bertrand +3}; {set: hollis_station_hint}; goto last_bench
- "Walk the end of Tib's riddle trail with him." → {regard: tib +4}; {set: tib_trail_done}; goto last_trail
- "Stand with Pell while the lamps burn down." → {regard: pell +4}; goto last_pell

:: last_pack
KASIMIR [neutral]: (hands you the end of a bench) Lift on three.
JUNE [neutral]: You're good at this. Kasimir won't say so. He thinks it, though. I can hear it.
KASIMIR [neutral]: Hm.
{goto: the_end}

:: last_bench
BERTRAND [neutral]: (not looking at Hollis) Mr. Brandt. A fine evening for it.
{ai_line: fair_close_hollis, speaker: hollis, brief: "Hollis Brandt, on a bench beside Bertrand at the end of Bloom Fair, says one dry sentence that gives the exact time of something. He does not address Bertrand directly. No mention of Vane, the Option Clause or the Tollmen."}
{fallback: "Nineteen forty-two. The fair opened at twelve. Seven hours and forty-two minutes, and nobody late."}
N: Bertrand pretends the bench is giving him a lecture. Hollis pretends not to listen.
HOLLIS [neutral]: (to you, not turning his head) Wednesday. Station Hill. Oh-six-fifteen. Bring boots.
HOLLIS [neutral]: Not oh-six-twenty.
{goto: the_end}

:: last_trail
TIB [neutral]: The twelfth clue is the Elm, obviously. I wrote it so you couldn't miss it, because it's for the little ones.
N: The prize is the last jam sandwich. Tib holds it out. You take half. He takes the rest, and neither of you mentions that he gave you the bigger half.
{goto: the_end}

:: last_pell
PELL [warm]: (quietly, with the lamps in her glasses) Eight lamps lit, out of eight. It's the one count I like.
N: You stand there until the last one gutters. She doesn't say anything else, and neither do you.
{goto: the_end}

:: the_end
N: Bastien sleeps on the flatbed, under a bench somebody lifted over him.
{memory: pell, "Bloom Fair closed at sunset. I stood on the crate and thanked them. I counted the lamps, and for once the number was one I liked.", importance: 8}
{memory: june, "Played the tailgate at the Bloom Fair closing. Kasimir called it true. I called it a stage.", importance: 7}
{memory: kasimir, "Backed the flatbed to the bandstand. Called the tailgate true. June called it a stage.", importance: 5}
{memory: tib, "Ran the riddle trail at Bloom Fair. Twelve clues, eleven jam sandwiches. A good day.", importance: 6}
{memory: felix, "Bloom Fair. Nine pupils, nine different coats. A good day for the school.", importance: 5}
[[if flag.hollis_station_hint]]
{memory: hollis, "Bloom Fair, nineteen forty-two. Nobody late. Sat on the bench by Bertrand and said nothing to him, loudly. Told the Fellow oh-six-fifteen on the hill. Not oh-six-twenty.", importance: 7}
{memory: bertrand, "Sat on a bench by Hollis Brandt at the Bloom Fair and said it was a fine evening. He said the time. It will do.", importance: 7}
[[else]]
{memory: hollis, "Bloom Fair. Nineteen forty-two at the last song. Nobody late.", importance: 5}
{memory: bertrand, "Bloom Fair. A fine evening. Hollis Brandt looked at his watch from across the lawn. It will do.", importance: 6}
[[end]]
{set: s10b_done}
{set: bloom_fair_closed}
```
