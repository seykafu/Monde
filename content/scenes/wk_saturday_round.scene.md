#### Weekly · The Saturday Round
```yaml
id: wk_saturday_round
day: 5
time: "10:00-13:00"
place: market_row.bakery
trigger: "flag.s03_done && !flag.tollmen_broken && !flag.s10c_done && weekday == 'sat'"   # the MVP's Spring ends with the Straw Poll
backdrop: bg_bakery_interior
music: tension_light
cast: [odile, bru, nettie, rook]
sets: [saturday_round_seen]   # plus round_stood, stood_with_odile | round_paid | round_watched (one per visit; the round_* flags are cleared before each choice)
repeats: true
```
```script
{fade}
[[if !flag.saturday_round_seen]]
N: Saturday on Market Row. Trestles going up, a crate dropped, somebody arguing about eels. The bakery case is half empty. It is half empty every Saturday by ten.
N: From the doorway you can see down the north side of the street. The crew works it in order, like a postman.
N: Dunmore's back door first. Barney Dunmore counts twenty from the till with his lips moving and writes it in a book. SUNDRIES, it says. Out on the flags his sister Nell is weighing herring at her stall and doesn't turn round.
N: The Gull & Anchor next. Roz pays through the hatch without being asked, and wipes a glass afterwards that is already dry.
N: Café Liss pays last and slowest, with the face of milk about to turn.
N: Across the street a lean man in a grey mill cap leans on the lamppost. The brass whistle hangs at his chest. He watches the Row the way you watch weather. He doesn't come in.
[[if flag.promised_odile]]
ODILE [neutral]: (not looking round) You came.
ODILE [neutral]: Hm. Stand where you like. Not in front of the case.
[[else]]
ODILE [neutral]: (not looking round) Door. You may as well come in or go out.
[[end]]
N: The bell rings. This time they mean it.
BRU [worried]: Morning, Madame. Sorry about the bell.
NETTIE [neutral]: Saturday's Saturday. Twenty.
[[else]]
[[if flag.round_stood]]
BRU [worried]: (the bell rings; he takes his cap off) You again. Sorry. Good morning, Madame.
NETTIE [neutral]: (eyeing the doorway) Same spot as last week, Fellow. Fine. Row's clear.
[[elif flag.round_paid]]
NETTIE [laugh]: (the bell rings) Fellow. Brought your purse again?
ODILE [angry]: I pay my own fines, Szabo.
BRU [worried]: Sorry, Madame.
[[elif flag.round_watched]]
NETTIE [neutral]: (the bell rings; she nods at the counter) Same seat as last week, Fellow. Enjoying the view?
BRU [worried]: Twenty, Madame. Sorry.
[[else]]
BRU [worried]: (the bell rings; he takes his cap off) Morning, Madame. Sorry about the bell.
NETTIE [neutral]: Saturday's Saturday. Twenty.
[[end]]
[[if flag.promised_odile && !flag.stood_with_odile]]
ODILE [neutral]: (low, to you) You came. Hm.
[[end]]
[[end]]
N: Across the street, under the lamp, Rook hasn't moved.
N: Odile opens the till and counts out twenty coins one at a time. She sets them in a row on the counter like a hand of cards. She doesn't push them across. She waits.
{unset: round_stood}
{unset: round_paid}
{unset: round_watched}
>> CHOICE
- "Step into the doorway beside Odile." → goto stand
- "Put your own twenty down. Leave her out of it." → goto pay
- "Stay by the counter and watch." → goto watch

:: stand
N: You take the two steps to the doorway and stand next to Odile. It is a short walk and it feels like a long one.
NETTIE [sidelong]: Oh, she's got a doorstop now.
[[if tollmen >= 2]]
BRU [worried]: (to the floor) Please don't, Fellow. I'd rather you didn't.
NETTIE [neutral]: (thumbs a pebble into the slingshot) Bru. Do it quick.
BRU [worried]: Sorry. Sorry. (lifts Odile's pan from its hook, very gently) It's what's here.
ODILE [neutral]: Pan beats broom. Broom beats umbrella. You know it.
{sfx: pan_clang}
{cam: shake}
{scuffle: sc_market_saturday}
[[if scuffle.won]]
[[if scuffle.talked_down]]
N: Bru hangs the pan on its hook by the handle. Nettie lets the pebble fall into her pocket.
BRU [worried]: All right. We can leave it, Madame. Just today.
ODILE [neutral]: Today's a fine place to start.
[[else]]
N: Bru sits down in the doorway, winded, cap over one eye, and holds the pan out to Odile handle first.
BRU [worried]: Sorry, Madame.
NETTIE [angry]: Blast. This isn't over.
ODILE [neutral]: Take the loaf behind. It's yesterday's.
[[end]]
{regard: odile +6}
N: Odile's twenty sit in their row. She counts them twice and puts them back in the till. Across the street Rook pushes off the lamp and walks away, and doesn't look back.
{memory: odile, "A Saturday. The Fellow stood in my doorway and the crew went home with nothing from my till. Eleven years. I fed the Fellow and didn't say a word about it.", importance: 9}
{memory: bru, "Went for the bakery's twenty. The Fellow stood in the door and we went the other way. Sorry about the pan.", importance: 6}
{memory: nettie, "The Fellow stood with the baker and beat us. Row's not what it was. Rook just walked off. Blast.", importance: 6}
{memory: rook, "Watched from the lamp. The Fellow stood in the bakery door and my crew came away empty. I went before anyone could look at me.", importance: 8}
[[else]]
[[if scuffle.fled]]
N: You step out of the doorway. Odile watches you go, and doesn't say anything.
[[else]]
N: The floor arrives first. Then a sack of flour, which bursts, which is how you find out it was a good sack.
[[end]]
{regard: odile +3}
N: Nettie palms the twenty off the counter. Odile watches her do it with a face like closed shutters.
ODILE [neutral]: (to you, quietly) You were here. That's more than Thursday.
{memory: odile, "Saturday. The Fellow stood in my door and it didn't hold. They were here, though. That's more than I expected of a Fellow. I gave them tea afterward.", importance: 7}
{memory: bru, "Went for the bakery's twenty. The Fellow stood in the door and lost. Said sorry about eight times.", importance: 5}
{memory: nettie, "Took the baker's twenty. The Fellow stood in the door and went down. Easy, I said. It felt wrong again.", importance: 5}
{memory: rook, "Watched from the lamp. The Fellow stood in the baker's door and lost to my crew. They got up on their own.", importance: 6}
[[end]]
[[else]]
N: Nobody reaches for a pan. Bru looks at the doorway, then at Nettie. Nettie looks at you, and at Odile, and at the street through the window.
N: Across the street Rook lifts two fingers off the lamp, a sign so small you wouldn't see it if you hadn't been watching for one.
NETTIE [neutral]: (to the row of coins, not to you) Keep it, Madame. For this week.
BRU [worried]: Next week, Madame. Sorry.
ODILE [neutral]: Hm. Don't be sorry, Haskett. Be late.
N: They go, and the bell rings after them. Bru touches his cap to the doorframe, as if it might mind.
{pillar: safety +1}
{regard: odile +5}
{memory: odile, "A Saturday. The crew came for the twenty, saw the Fellow in my door, and went home without it. Nobody lifted a pan. Rook made a sign across the street. Next week, Haskett said. I am not a fool.", importance: 8}
{memory: bru, "Went for the bakery's twenty. The Fellow stood in the door, so we left. I said next week. Sorry, Madame.", importance: 5}
{memory: nettie, "Walked out of the bakery with nothing because of a Fellow in a doorway. Rook gave the sign. I'll say the Row was too busy.", importance: 6}
{memory: rook, "Gave the sign. The baker's twenty stays in the till this week because of the Fellow. Said nothing. Will hear about it from the others.", importance: 7}
[[end]]
{set: round_stood}
{set: stood_with_odile}
{goto: close}

:: pay
N: You put twenty coins on the counter, in the row beside Odile's.
{coins: -20}
ODILE [angry]: (the knife-edge quiet that is her loud) No.
NETTIE [laugh]: (scooping the lot) Easy. The new ones are always easy.
ODILE [angry]: I pay my own fines, Fellow. I don't need rescuing in my own shop.
N: She puts her own twenty back in the till. She doesn't look at you again until Bru and Nettie have gone, and the bell has stopped.
ODILE [neutral]: (at last) It wasn't a kindness. Don't let anyone tell you it was.
{regard: odile -2}
{regard: nell -2}
{memory: odile, "A Saturday. The Fellow put twenty on my counter before I could. I pay my own fines. I put mine back in the till. It wasn't a kindness. I think it was meant as one.", importance: 7}
{memory: nell, "Heard it from the street: the Fellow paid the baker's Tollmen twenty on a Saturday. Barney says that's how the Row ends up. I don't know whether to thank them or not.", importance: 5}
{memory: nettie, "Fellow paid for the baker. Easy, I said. The baker looked at the Fellow like they'd spat in the dough.", importance: 5}
{memory: bru, "The Fellow paid twenty in the bakery. Madame didn't take it kindly. Sorry. I don't think anyone did.", importance: 5}
{set: round_paid}
{goto: close}

:: watch
N: You stay by the counter, with the heel of rye, where you can see the lot.
N: Odile pushes the row of coins across with one finger at a time. Bru takes them with two hands, like eggs. Nettie counts them again, aloud, and the baker waits for her to reach twenty.
ODILE [neutral]: Twenty.
NETTIE [neutral]: Twenty. Row's clear, Madame. See you next Saturday.
N: It takes under two minutes. Nobody raises a voice. It is the quietest thing you have seen on Market Row, and you watch it all, down to Nettie's sleeve on the glass and the crumb in Odile's jaw.
N: Across the street Rook turns from the lamp and, for an instant, looks at the window.
ODILE [neutral]: (after the bell, to the counter) That's how it works. Now you've seen it.
{memory: odile, "A Saturday. The Fellow stood at the counter and watched me pay. Said nothing. Now they know how it's done. I wanted them to and I didn't.", importance: 6}
{memory: rook, "Watched from the lamp. The Fellow stood by the counter and watched the baker pay, all of it. They were looking at the window when I looked.", importance: 5}
{set: round_watched}
{goto: close}

:: close
N: The flour settles. Bastien comes in with the cold and sits where the bell can't reach him.
ODILE [neutral]: Eat something.
{set: saturday_round_seen}
```
