#### S03 · Tolls
```yaml
id: s03_tolls
day: 3
time: "10:00-14:00"
place: market_row.bakery
trigger: "!flag.s03_done && player.zone == 'market_row'"
backdrop: bg_bakery_interior
music: tension_light
cast: [odile, bru, nettie, rook]
sets: [s03_done, met_rook, met_tollmen]   # plus sc_tutorial_won or sc_tutorial_lost; s03_paid, asked_about_rook, odile_fille_hint_seen if chosen
```
```script
{fade}
N: You smell Fournier & Fille from the corner. Rye, scorched sugar, and the warmth of a room that has been hot since four in the morning.
N: Inside it's all trays. A glass case with two kinds of loaf. Behind the counter a broad woman with flour to the elbows and a pencil through her grey bun. A pink burn scar runs along her left forearm.
N: Bastien sits on the doorstep, just outside the reach of the bell.
ODILE [neutral]: (without turning round) Door.
N: You close it. The bell rings anyway, late.
ODILE [neutral]: You're Pell's. Sit or don't. Don't block the door.
N: You reach for your coins. She pushes a heel of rye across the counter before you can find them.
ODILE [neutral]: Rye's two. White's three. Today it's rye. Eat something, petit. You look like a coat on a hook.
ODILE [neutral]: Pell sent you to look at the Row. Look. Don't let anyone sell you anything.
N: The rye is still warm in the middle. You are about to say something about it when the bell rings again, and this time somebody meant it.
N: A very large young man fills the doorway and has to think about the lintel. His right hand is in his jacket pocket, turning something small and wooden over and over. Behind him comes a girl of nineteen in a hooded jacket, a slingshot hanging from her belt like a set of keys.
BRU [worried]: (takes his cap off, puts it on again) Morning, Madame. Sorry.
ODILE [neutral]: Thursday.
NETTIE [neutral]: (takes a currant off a bun in the case and eats it) Courtesy visit. Saturday's Saturday. This is hello.
NETTIE [neutral]: There's a new face in town. Rook thought the new face should see how it works. No hard feelings.
N: Across the street, under the lamppost, a lean man in a grey wool mill cap leans on the iron. A brass whistle hangs on a bootlace at his chest. He doesn't come in.
ODILE [neutral]: (doesn't look at the street) Hm.
BRU [worried]: It's twenty, Madame. Early. Saves the trip Saturday.
ODILE [neutral]: (opens the till, counts out twenty coins one at a time, and sets them in a row on the counter like a hand of cards) Twenty.
BRU [worried]: Sorry, Madame.
ODILE [angry]: Don't Madame me, Haskett.
N: Nettie scoops the row into her palm. Then she turns and finds you, and her eyes go over you like a customs officer's.
NETTIE [neutral]: Fellow. Pell's Fellow. There's a fee for new faces too. Twenty, for the privilege of walking the Row.
>> CHOICE
- "Step between Nettie and Odile." → {regard: odile +4}; goto stand
- "Fine. Here's twenty. Leave her alone." → {coins: -20}; {regard: odile -3}; {set: s03_paid}; goto paid
- "Odile? What do you want me to do?" → {regard: odile +3}; goto ask_odile

:: stand
N: It's a short step. It feels like a long one.
NETTIE [neutral]: Oh, she's going to be like that.
BRU [worried]: Please don't, Fellow.
{goto: fight_start}

:: paid
N: You put twenty coins on the counter beside Odile's empty patch of wood.
NETTIE [laugh]: (scoops them up) See? Easy. The new ones are always easy.
ODILE [angry]: I didn't ask.
N: Odile reaches under the counter. Nettie sees where her hand is going a second before you do.
NETTIE [neutral]: Ah. Now it's more than hello.
{goto: fight_start}

:: ask_odile
ODILE [neutral]: (low, not looking at you) Umbrella stand. Left of the door.
NETTIE [neutral]: What's she saying?
ODILE [neutral]: The weather, Szabo.
{goto: fight_start}

:: fight_start
N: Bru takes Odile's frying pan off its hook. He does it gently, the way you'd lift a sleeping child, and looks as if he'd like to apologize to it.
BRU [worried]: Sorry. It's what's here.
NETTIE [neutral]: (thumbing a pebble into the slingshot) Let's not make it long. Bru's got a thing at noon.
ODILE [neutral]: Everyone on this street knows it. Pan beats broom. Broom beats umbrella. Umbrella beats pan. Don't ask me why.
ODILE [neutral]: He's got my pan. You've got eyes.
{sfx: pan_clang}
{cam: shake}
{scuffle: sc_bakery_tutorial}
[[if scuffle.won]]
{set: sc_tutorial_won}
[[if scuffle.talked_down]]
N: Bru turns Odile's pan by the handle and hangs it back on its hook. Nettie lets the pebble fall into her pocket.
BRU [worried]: All right. We can leave it. Just today.
ODILE [neutral]: Today is a perfectly good place to start.
[[else]]
N: Bru sits down in the doorway, winded, his back against the frame and his cap over one eye. He holds the pan out to Odile, handle first.
BRU [worried]: Sorry, Madame.
ODILE [neutral]: (takes the pan and hangs it on its hook) There's a bun on the end. Take it. You're no use hungry.
NETTIE [angry]: (already half over the counter, a loaf of rye under her arm as if nobody can see it) This isn't over!
ODILE [neutral]: Hm. Take the one behind. That's yesterday's.
[[end]]
N: Odile's twenty coins sit in a row on the counter where Bru dropped them. She counts them twice and puts them back in the till.
{pillar: safety +1}
{regard: odile +8}
N: Across the street the man in the cap hasn't moved. He watches the way you watch weather. Then he pushes off the lamppost, crosses, and stops on the threshold. He doesn't come in.
ROOK [neutral]: Haskett. Szabo. Shift's over.
N: Bru gets up. Nettie reappears from behind the case with flour on her nose.
ROOK [neutral]: Fellow. (a small nod) Saturday.
N: He goes. The whistle on his chest swings once and hangs still. Bru touches his cap to Odile and follows. Nettie goes last and doesn't look at anyone.
[[else]]
{set: sc_tutorial_lost}
[[if scuffle.fled]]
N: You step out of the doorway. Odile watches you go, then puts the dustpan against the wall.
ODILE [neutral]: Tea later, Fellow. Catch your breath.
[[else]]
N: The floor arrives first. Then a sack of flour, which bursts, which is how you find out it was a good sack.
ODILE [surprised]: (hands on hips; the flour hasn't settled) You swing like you're hailing the ferry.
BRU [worried]: Sorry. Sorry, Fellow. Are you all right? Sorry.
NETTIE [neutral]: (palming Odile's twenty off the counter) Told you. New ones are always easy.
[[end]]
{regard: odile +3}
N: Across the street the man in the cap hasn't moved. He watches the way you watch weather.
ROOK [neutral]: Haskett. Szabo. Shift's over.
N: He doesn't look at the shop. At the corner he looks back once, and it's at you.
[[end]]
N: The bell rings behind them, late. Flour settles on the glass case.
ODILE [neutral]: (looks at the mess) Hm.
ODILE [neutral]: Eat something.
>> CHOICE
- "Who was by the lamppost?" → {set: asked_about_rook}; goto about_rook
- "What's the 'Fille' on your sign?" → {regard: odile -1}; {set: odile_fille_hint_seen}; goto about_fille
- "Let me sweep up." → {regard: odile +3}; goto sweep

:: about_rook
ODILE [neutral]: Nobody. (turns a tray that doesn't need turning) I've trays.
N: She turns a second one. That is the end of it.
{goto: the_end}

:: about_fille
ODILE [neutral]: The sign wants dusting. (picks up the broom) Ladder's out back.
N: She sweeps a clean patch of floor for some time.
{goto: the_end}

:: sweep
N: You take the broom. She says nothing. For ten minutes there's only the sound of bristles and the oven ticking as it cools.
ODILE [neutral]: (sets the heel of a fresh loaf on the counter) That's yours. Don't say anything.
{goto: the_end}

:: the_end
N: Bastien licks flour off the doorstep and sneezes.
[[if flag.sc_tutorial_won]]
{memory: odile, "The Tollmen came on a Thursday to show the Fellow how it works. Haskett had my pan. The Fellow took the umbrella and put him on the floor. Szabo ran off with a loaf of rye. I let her.", importance: 9}
{memory: bru, "Went to the bakery to show the new Fellow how it works. Lost to an umbrella. Madame gave me a bun. I said sorry about four times.", importance: 6}
{memory: nettie, "The Fellow beat Bru with an umbrella in the bakery. I took a loaf of rye. Rook said shift's over. He watched the whole thing and didn't come in.", importance: 6}
{memory: rook, "Stood by the lamp on Market Row and watched the Fellow put Haskett down with an umbrella. Didn't go in. Said Saturday.", importance: 8}
[[else]]
{memory: odile, "The Tollmen came on a Thursday to show the Fellow how it works. The Fellow lost to Haskett's pan and a sack of flour. I fed them anyway. They tried.", importance: 8}
{memory: bru, "Went to the bakery to show the new Fellow how it works. The Fellow went down on the flour. I said sorry about six times.", importance: 5}
{memory: nettie, "The Fellow went down in the flour in about four seconds. Rook watched from the lamp. Easy, I said. It felt wrong saying it.", importance: 5}
{memory: rook, "Stood by the lamp and watched the Fellow lose to Haskett in the bakery. Didn't go in. Looked back from the corner.", importance: 7}
[[end]]
{set: s03_done}
{set: met_rook}
{set: met_tollmen}
```
