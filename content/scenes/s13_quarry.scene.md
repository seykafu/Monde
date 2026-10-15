#### S13 · The Quarry
```yaml
id: s13_quarry
day: 40
time: "14:00-18:00"
place: briar_woods.quarry
trigger: "!flag.s13_done && day >= 40 && player.zone == 'briar_woods'"       # Saturday afternoon is count day at the quarry
backdrop: bg_quarry_floor
music: quarry_wind
cast: [rook, bru, nettie, dex, dom, weasel]
sets: [s13_done, quarry_known, rook_first_talk, met_rook, met_tollmen]   # plus sc_quarry_won or sc_quarry_lost; if won, ONE of quarry_jars_returned / quarry_odile_jar / quarry_jars_left; rook_asked_who_pays if chosen
```
```script
{fade}
N: The path from the charcoal clearing runs through ferns, then through a gap in a drystone wall somebody has repaired recently and badly, and then drops.
N: The Old Quarry is a bowl of grey stone with rainwater lying in the bottom like a dropped coin. Ledges step down the sides. On the lowest ledge, a camp.
{sfx: pebble_clack}
N: A pebble lands a hand's width from your boot and rolls away down the slope. It was meant to.
NETTIE [neutral]: (from a ledge above, slingshot loose in her hand) That's the warning. Visitor! Boss! It's the Fellow, and they've walked up on their own like a mug!
N: Canvas lean-tos against the rock. An oil drum with a fire in it. A line of washing. Two hammocks, one with a boot in it. And a trestle table holding a row of jam jars, each labeled in pencil.
N: Weasel Pike sits at the trestle with a pencil behind his ear, tipping coins into the jars one at a time.
WEASEL [warm]: Fellow! A genuine pleasure. If you've come about the arrangement, I'm the man to see. There's a very reasonable contribution schedule—
ROOK [neutral]: Pike.
N: Weasel shuts his mouth and goes on counting with great concentration.
N: Rook sits on a block of quarried stone, eating soup out of a tin. Grey wool mill cap pulled low. The brass whistle on its bootlace hangs against his chest.
N: Dex and Dom Calloway are drumming on the oil drum with two wooden spoons, and not quite to the same rhythm. Bru sits in the sun against a block, turning a half-carved wooden wren over in his big hands.
ROOK [neutral]: (doesn't stand; the spoon doesn't stop) Say what you came to say, Fellow.
>> CHOICE
- "The Row's had enough. The dues stop today." → {regard: rook -2}; goto say_demand
- "I wanted to see where you sleep." → {regard: rook +3}; goto say_curious
- "Twenty coins is a loaf and a half. Who's paying you?" → {regard: rook -4}; {set: rook_asked_who_pays}; goto say_who

:: say_demand
ROOK [neutral]: Everyone's had enough, Fellow. That's what the money's for.
ROOK [neutral]: Haskett.
{goto: fight_start}

:: say_curious
ROOK [surprised]: Ha.
ROOK [neutral]: Under the lean-to on the left. Dry on a good night. Calloways, be nice.
N: The Calloways aren't nice. They stand up with the spoons in their fists, which is their version of it.
{goto: fight_start}

:: say_who
ROOK [neutral]: Don't.
N: He puts the tin down on the stone. He stands. It takes him a while.
ROOK [neutral]: Haskett. Szabo. Calloways. Fair fight. Nobody touches a person once they're down.
{goto: fight_start}

:: fight_start
N: Weasel moves the jars to the far end of the trestle, and then himself.
NETTIE [neutral]: I'm not shooting at you. I never shoot at people. I'm shooting at whatever's in your hand!
DEX [angry]: Rook said be nice.
DOM [angry]: Rook said Calloways be nice.
DEX [angry]: (hefts the broom) This is nice.
BRU [worried]: (tucks the wren in his pocket and takes up the pan) Sorry, Fellow.
ROOK [neutral]: (sits back down on the block with the tin in his lap) I'm not in it. This is theirs.
{sfx: pan_clang}
{cam: shake}
{scuffle: sc_quarry_first}
[[if scuffle.won]]
{goto: won}
[[else]]
{goto: lost}
[[end]]

:: won
{set: sc_quarry_won}
{pillar: safety +2}
N: The quarry goes quiet except for rain dripping off a ledge.
N: Bru sits down against the block, winded, and takes the wren out of his pocket to check it for damage. Dex and Dom lie on their backs with their feet together, still holding the broom and the umbrella. Nettie slides down the last ledge on her backside and stays at the bottom.
NETTIE [surprised]: (from the dirt) I never miss. I didn't miss. You moved.
N: Rook hasn't moved. The soup in the tin hasn't spilled. He looks at you for a long time, and it looks like arithmetic.
ROOK [neutral]: Nobody's come up the quarry road in two years that wasn't carrying a clipboard.
N: Behind him Weasel hugs the nearest jar with both arms and the face of a man who has never been near a fight.
>> CHOICE
- "Take the jars. They're going back to the shops." → {regard: rook -8}; {pillar: safety +1}; {set: quarry_jars_returned}; goto jars_all
- "Take the bakery's. Only the bakery's." → {regard: rook +2}; {regard: odile +4}; {set: quarry_odile_jar}; goto jars_odile
- "Leave them. That's not what I came for." → {regard: rook +5}; {set: quarry_jars_left}; goto jars_left

:: jars_all
ROOK [angry]: (very quietly) Those are ours.
WEASEL [worried]: (to the jar in his arms) Not the labeled ones. Not the labeled ones.
N: You carry the jars down the quarry road and nobody stops you. Behind you Rook doesn't say a word, and that's worse.
N: By Monday the twenties are back in the tills, and nobody asks how.
{regard: odile +3}
{regard: nell +3}
{regard: rosalind +3}
{goto: talk}

:: jars_odile
N: You pick up the jar marked BAKERY. Rook's eyes follow it.
ROOK [neutral]: Take it. She's the one that I—
N: He stops there, and he doesn't start again.
N: The other jars stay where they are. Weasel breathes out.
{goto: talk}

:: jars_left
ROOK [neutral]: (looks at the jars, then at you) You didn't take them.
ROOK [neutral]: Hm.
{goto: talk}

:: lost
{set: sc_quarry_lost}
{coins: -20}
N: The ground arrives. Dex and Dom stand over you with the broom and the umbrella, breathing hard and looking, for the first time, uncertain about the next part.
ROOK [neutral]: Enough. Nobody touches a person once they're down.
N: Bru puts the pan down at once. Nettie comes off the ledge with a cup of water that she's clearly been carrying a while.
NETTIE [neutral]: (not looking at you) Drink that. You hit the dirt weird.
N: Twenty coins have come out of your pocket in the fall. Weasel picks them up with great delicacy and puts them in a jar. Rook watches him do it, and says nothing, and you watch him say nothing.
N: Rook gets up, crosses the camp, and sits on the ground beside you with the tin of soup. He holds out the spoon.
ROOK [neutral]: Eat. It's bad. It's hot.
{goto: talk}

:: talk
N: The rain starts in the bowl of the quarry, small and neat.
ROOK [neutral]: You want to know why. Everyone does, eventually.
ROOK [neutral]: Lissworth closed on a Friday. I was nineteen. Second shift, doffer. You know what a doffer is?
ROOK [neutral]: You take the full bobbins off the frame and put the empties on. Forty frames. Six hundred of us. The whistle went at ten in the morning and nobody said what for.
ROOK [neutral]: Monday after, there was a man at the gate at six with his lunch pail. Thirty years on the looms. Nobody'd told him.
ROOK [neutral]: I stood with him a while. Then I went home.
ROOK [neutral]: Nobody was hiring. Then somebody was. Steady coins for anyone who'd walk the Row of a Saturday.
N: He stops before the next word. You can see it there and see him decide to leave it.
ROOK [neutral]: Twenty's a loaf and a half. Nobody's bleeding over a loaf and a half.
ROOK [neutral]: Somebody collects. Better it's us. We know their names. There's worse than us, Fellow. You haven't met them.
N: Dex and Dom have stopped drumming. Bru is watching the wren in his hand.
>> CHOICE
- "You could stop. Tomorrow." → {regard: rook +1}; goto stop_tomorrow
- "What would you do, if you could do anything?" → {regard: rook +2}; goto what_would
- "(Say nothing. Eat the soup.)" → {regard: rook +3}; goto quiet

:: stop_tomorrow
ROOK [neutral]: And then what? Who's hiring?
N: The question stays on the ground between you. He doesn't want an answer. He'd like you to notice there isn't one.
{goto: handoff}

:: what_would
ROOK [neutral]: (the whistle swings; he catches it) Shift's over.
N: Bru, without looking up, makes a small noise. It might be a laugh. Rook turns his head toward it, and it stops.
{goto: handoff}

:: quiet
N: The soup is bad. It's hot. You eat it. Rook looks at the spoon in your hand and says nothing, which for him is a long speech.
{goto: handoff}

:: handoff
ROOK [neutral]: Ask your question. One. Then you're off my ledge.
{ai_open: rook, topic: "Why Rook took the Tollmen work and what he makes of the Fellow coming up the quarry road alone. Rook is flat, short and hot underneath; he stops sentences before the true part, and 'Don't.' ends a topic. He never says 'sorry' or 'please', never says 'Mum' or 'Mother' (he says 'she' or 'at home'), never names Vane or Greyline, and never admits the Tollmen are wrong. If pressed hard he may admit the crew is paid separately by 'a man' on Saturday nights, without a name. He ends the talk himself with 'Shift's over.'", turns: 3}
ROOK [neutral]: Shift's over. The quarry road's open. Next time bring a reason.
N: Nettie, on her ledge, watches you all the way to the wall. Bru raises the wren in a kind of salute, then looks embarrassed about it. Weasel pretends to count.
[[if flag.sc_quarry_won]]
{memory: rook, "The Fellow walked up the quarry road alone and beat my crew with a broom and an umbrella. I told them nobody touches a person who's down. Ate soup in front of them like it was a Tuesday. The Fellow ate mine.", importance: 10}
[[else]]
{memory: rook, "The Fellow walked up the quarry road alone and lost to my crew. I told them nobody touches a person who's down. The Fellow ate my soup. I haven't done that for anyone in nine years.", importance: 10}
[[end]]
[[if flag.quarry_jars_returned]]
{memory: rook, "The Fellow took the jars back down the road. Every jar, every label. I let them go. Pike hasn't stopped talking about it.", importance: 9}
{memory: weasel, "The Fellow took the jars. Every one. I said 'not the labeled ones' to a jar. I need to reconsider my position.", importance: 7}
[[elif flag.quarry_odile_jar]]
{memory: rook, "The Fellow took Odile's jar and left the rest. I let them. I didn't finish the sentence.", importance: 10}
[[elif flag.quarry_jars_left]]
{memory: rook, "The Fellow left the jars where they were. Hm.", importance: 8}
[[end]]
{memory: bru, "The Fellow came up the quarry road. I said sorry about four times, then I checked the wren. It wasn't damaged.", importance: 6}
{memory: nettie, "Fired a pebble at the path to warn them. Never at a person. I said it loud. I'd rather it was true than loud.", importance: 6}
{memory: dex, "The Fellow came to the quarry. Dom and I held the broom and the umbrella. Rook said be nice. We did our version.", importance: 5}
{memory: dom, "The Fellow came to the quarry. Dex and I held the broom and the umbrella. Rook said be nice. We did our version.", importance: 5}
{set: s13_done}
{set: met_rook}
{set: met_tollmen}
{set: quarry_known}
{set: rook_first_talk}
```
