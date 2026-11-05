#### Weekly · Odile Asks
```yaml
id: wk_saturday_ask
day: 4
time: "06:00-13:00"
place: market_row.bakery
trigger: "flag.s03_done && !flag.odile_asked_saturday && !flag.saturday_round_seen && weekday != 'sat' && day < 12"   # before the second Saturday
backdrop: bg_bakery_interior
music: cottage_warm
cast: [odile]
sets: [odile_asked_saturday]   # plus promised_odile if the Fellow promises
```
```script
{fade}
N: The bakery before the rush. The case is full and the floor is swept, all but the corner by the umbrella stand.
[[if flag.sc_tutorial_won]]
ODILE [neutral]: (doesn't turn from the trays) The Haskett boy's been past twice. Doesn't come in. Looks at the umbrella stand.
[[elif flag.sc_tutorial_lost]]
ODILE [neutral]: (doesn't turn from the trays) Flour's out of the grain of the floor. Mostly. You'll still find some in March.
[[else]]
ODILE [neutral]: (doesn't turn from the trays) Door.
[[end]]
N: She slides a heel of rye along the counter. You take it. That is the whole greeting.
[[if flag.s03_paid]]
ODILE [neutral]: That twenty you put down on Thursday. I haven't forgotten whose it was.
N: It doesn't sound like a thank you. She never says thank you. It sounds like a sum she hasn't finished.
[[end]]
ODILE [neutral]: Saturday.
N: She wipes the counter where it is already clean.
ODILE [neutral]: They come after ten. Haskett, Szabo. The other one stays on the street, under the lamp. They take twenty and they go. Been going eleven years.
ODILE [neutral]: I don't want a fight. Pan, broom, umbrella, I've had my fill of that. I want someone in the doorway.
ODILE [neutral]: A witness. Somebody who'll stand there and be seen to have seen.
N: She looks at you for the first time. It's a baker's look: does it rise.
ODILE [neutral]: Saturday. Would you just be here?
>> CHOICE
- "I'll be here." → {set: promised_odile}; {regard: odile +3}; goto promised
- "I can't promise that." → goto no_promise

:: promised
ODILE [neutral]: Hm.
N: She turns a tray that doesn't need turning. Then she takes a currant bun out of the case and puts it in a paper bag and puts the bag in your hand.
ODILE [neutral]: After ten. Don't be early, you'll only stand about. Don't be late.
{memory: odile, "Asked the Fellow to be in the doorway on Saturday when the Tollmen come for the twenty. They said they'd be here. Eleven years and I asked a stranger. I gave them a bun so I wouldn't have to say anything else.", importance: 7}
{goto: the_end}

:: no_promise
ODILE [neutral]: Hm. Wise. Never promise a baker a Saturday.
ODILE [neutral]: If you're passing, the door's a door. If you're not, the twenty's still twenty.
N: She says it lightly. The tray she picks up next she puts down again.
{memory: odile, "Asked the Fellow to be here on Saturday for the Tollmen. They wouldn't promise. Fair. I said never promise a baker a Saturday. I'd have liked to hear yes.", importance: 6}
{goto: the_end}

:: the_end
N: Bastien watches the whole thing from the doorstep and then, to show he took no side, leaves.
{set: odile_asked_saturday}
```
