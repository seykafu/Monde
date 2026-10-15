#### S09 · Pell's Confession
```yaml
id: s09_pell_confession
day: 18
time: "19:00-23:00"
place: old_quarter.pell_house
trigger: "!flag.s09_done && flag.s08_done && player.zone == 'old_quarter'"
backdrop: bg_pell_kitchen_night
music: pell_private
cast: [pell]
sets: [s09_done, pell_confessed]   # plus exactly one of: option_kept_secret + sable_week_promised | pell_announce_together | option_public + option_public
```
```script
{fade}
N: Pell's house is the narrowest on the lane, with a front door painted a green that has given up. On a nail beside it hangs a claw hammer with a worn handle.
N: She opens before you knock. She has been standing behind the door for some time.
PELL [worried]: (looks at your face, then at your sleeve, which still carries Sable's thumbprint) Ah. She showed you.
PELL [neutral]: Come in. Mind Arthur's hammer. It's hung there six years and nobody has moved it, including me.
N: A kitchen. A table under oilcloth, a ledger squared to its edge, a teapot in a knitted cozy, and a plate of shortbread nobody has touched.
PELL [neutral]: Odile's. She leaves them on the step like I'm a cat. Sit.
N: By the ledger lies a slip of paper with one typed line. I have page nine. Three days. S.M.
PELL [neutral]: She didn't even use the whole name.
N: Pell pours. The cup chatters on its saucer. She sets the pot down and waits for her hand.
PELL [neutral]: Now.
N: She hears herself. She puts both hands flat on the oilcloth.
PELL [neutral]: No. I'm not going to say that one tonight.
[[if flag.asked_pell_how_bad]]
PELL [sad]: You asked me on the slip how bad it was. I counted lamps at you. I'm sorry for that.
[[elif flag.pell_deflected_count]]
PELL [sad]: You asked why I count. I said habit. It's a habit now. It wasn't at the start.
[[elif flag.pell_told_census]]
PELL [sad]: I told you two hundred and ten in the first hour, on the slip. I didn't say why.
[[end]]
[[if flag.vanes_coin]]
PELL [worried]: Silas offered you something at the fountain. I saw the letter in her folder. I'd have said so if I were braver.
[[end]]
PELL [neutral]: Twelve years ago the payroll had four days of money in it. The lamplighters, Augusta, Mr. Amari's salary, the nurse. I sat in the mayor's office with the ledger, and the ledger said Friday.
PELL [neutral]: The bank in the city wouldn't lend. Then a young man came off the Tuesday boat with a case of sandwiches and a very good coat.
PELL [neutral]: Thirty-six. Ham sandwiches, enough for the whole council. He read the books at that table all night, and at four in the morning he said, "May I be frank, Mrs. Pell? The mill isn't coming back."
PELL [sad]: He was right. That was the worst of it. He was right, and he was kind.
PELL [neutral]: Forty thousand coins. The lamps stayed lit and the wages were paid. I signed page nine because it was three in the morning and it said two hundred, and we were nine hundred and something, and two hundred looked like the bottom of the sea.
PELL [sad]: Arthur read it over my shoulder. He said it would never come to anything. He died believing that. I let him.
N: She squares the ledger by a quarter inch that didn't need squaring.
PELL [neutral]: I told no one, because the moment I say two hundred out loud, everyone starts counting. I know what counting does. It did it to me.
PELL [sad]: Old Mr. Haldane passed in February. I counted before I sent the card.
N: She looks at you the way she looks at a lamp that's gone out and might only want a new wick.
>> CHOICE
- "You should have told someone." → {regard: pell -4}; goto r_should
- "You kept the lights on." → {regard: pell +6}; goto r_lights
- "What do we do?" → {regard: pell +4}; goto r_do

:: r_should
PELL [sad]: Yes. I should. I'd like you to know that I know.
{goto: the_ask}

:: r_lights
PELL [sad]: I kept them on with the Wharf, dear. That's a different sum.
{goto: the_ask}

:: r_do
PELL [neutral]: We keep the number up. That's what I have. A number, a ledger, and you.
{goto: the_ask}

:: the_ask
PELL [neutral]: Sable has given me three days. I need seven. I'd like to tell them myself, and I'd like it to be after the Fair. A Friday with bunting. Not a Monday.
PELL [worried]: She won't give the Mayor four more days. She might give the Fellow.
[[if regard.pell >= 40]]
PELL [warm]: {name}, I'm asking you to carry something I should have carried. I know exactly what that is.
[[end]]
>> CHOICE
- "I'll talk to Sable. You'll get your week. It stays between us." → {regard: pell +10}; {set: option_kept_secret}; {set: sable_week_promised}; goto c_quiet
- "Use Sable's three days. I'll stand beside you when you tell them." → {regard: pell +5}; {set: pell_announce_together}; goto c_together
- "They have a right to know. Sable can print it tomorrow." → {regard: pell -5}; {set: option_public}; goto c_public

:: c_quiet
PELL [warm]: (her breath goes out all at once) Thank you. I won't forget it. Heavens, I won't.
PELL [neutral]: Go to her tonight. She sets the forme after eleven. She'll shout. Let her.
N: You understand, from how she says it, that you've just promised something you can't yet do.
{goto: the_end}

:: c_together
PELL [warm]: Saturday, then. The Gull & Anchor, half past seven, when Roz has the room full and the cider's cold.
PELL [neutral]: I'll write it out tonight and read it to you first. (looks at the hammer) Arthur would have said stand up straight and say it once.
{goto: the_end}

:: c_public
PELL [sad]: (nods slowly, several times) Yes. All right.
PELL [neutral]: Tell Sable I'll make a statement. In my own words. She can print it under the clause.
N: She doesn't argue. That's what makes it hard.
{goto: the_end}

:: the_end
N: She walks you to the door, past the hammer.
PELL [neutral]: Eighty-one, tonight. I counted at dusk. I've always counted at dusk.
N: Out on the lane the lamps are lit. You count them. You can't help it.
[[if flag.option_kept_secret]]
{memory: pell, "Told the Fellow about the clause and the loan. They promised me the week and promised to talk to Sable. I'd forgotten what it was to be carried.", importance: 10}
[[elif flag.pell_announce_together]]
{memory: pell, "Told the Fellow everything at my kitchen table. They'll stand beside me on Saturday at the Gull & Anchor. I'll write it out tonight. Arthur would have said once.", importance: 10}
[[else]]
{memory: pell, "Told the Fellow everything. They said people have a right to know. They're right. I said all right. It was the hardest all right I've said.", importance: 10}
[[end]]
{set: s09_done}
{set: pell_confessed}
```
