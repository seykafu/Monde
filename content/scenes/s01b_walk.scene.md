#### S01b · The Walk
```yaml
id: s01b_walk
day: 1
time: "10:40-11:30"
place: old_quarter.fountain_square
trigger: "flag.s01a_done && !flag.s01b_done"
backdrop: bg_fountain_square_dry
music: walk_theme
cast: [pell, bertrand]
sets: [s01b_done, met_bertrand, saw_tollmen_idle]   # plus bertrand_pinion_hint if chosen
```
```script
{fade}
N: Market Row first. It's a short street with long gaps in it.
N: Nine shutters down, six up, and you count them without meaning to. A bakery window steamed from the inside. A general store with its crates out. A pub with a slate that says CIDER 2 and nothing else.
PELL [neutral]: That's Fournier & Fille. You'll smell it before you see it. Rye's two coins, white's three. Buy the rye. She'll know if you don't.
PELL [neutral]: Dunmore's. The Gull & Anchor. Café Liss. I'd walk on the left.
N: The left is the side away from the bench outside the old ironmonger's. Two young men sit on it with their hands in their jackets, watching you pass with the patient interest of landlords.
N: Pell talks a little faster until the bench is behind you.
N: Bastien follows two paces behind, then sits down on the bakery step.
{set: saw_tollmen_idle}
{fade}
N: The street bends, and the Old Quarter is all at once cobbles and gas lamps and gulls on gutters.
N: Fountain Square. A basin of dry stone with a green stain on its lip, and in the middle a bronze heron on one leg, fishing in nothing.
N: Above the roofs, the clocktower. Its face says seventeen minutes past four. You check your own watch. It's twenty to eleven.
PELL [neutral]: Four-seventeen. It's said four-seventeen for fourteen years. The day the mill closed.
PELL [neutral]: Eighty-one lamps still light, out of a hundred and three. I count them at dusk. A habit, that's all.
N: An old man sits on the bench by the basin, folded at the shoulders, a jeweler's loupe on a ribbon round his neck and white hair standing up at the back. He is winding a pocket watch without looking at it.
BERTRAND [thinking]: (does not look up) Eddie. You've the look of someone about to count something.
PELL [neutral]: I've counted, Bertrand.
BERTRAND [neutral]: And?
PELL [neutral]: Now. This is the Fellow.
[[if player.background == 'homecomer']]
BERTRAND [surprised]: (looks up; the watch stops in his hand) You. The bicycle. You rode it straight into the heron on the— 
BERTRAND [thinking]: Where was I. Yes. You left on the Friday boat, the twelfth of September, with a rabbit in a box.
PELL [laugh]: There was no rabbit, Bertrand.
BERTRAND [neutral]: There was a rabbit, Eddie. I wound my watch while it was being loaded.
{regard: bertrand +3}
{set: bertrand_remembers_player}
[[else]]
BERTRAND [thinking]: (looks you over slowly, the way he'd look at a movement he hasn't opened yet) Young person. Do sit. The heron won't mind. He's had practice.
[[end]]
BERTRAND [thinking]: Tell me, my dear. The tower. Going, or not going?
>> CHOICE
- "Not going." → {regard: bertrand +3}; goto clock_stopped
- "Can it be fixed?" → {regard: bertrand +4}; {set: bertrand_pinion_hint}; goto clock_fixable
- "It's still beautiful." → {regard: bertrand +2}; goto clock_pretty

:: clock_stopped
BERTRAND [warm]: Stopped, my dear. Broken is a different complaint, and a clock this good would resent it.
{goto: clock_after}

:: clock_fixable
BERTRAND [surprised]: (the loupe swings on its ribbon) Fixed. Nobody says fixed. They say sad.
BERTRAND [warm]: It lacks one small part. A pinion. A lantern pinion, if you want to be exact, and I always do. Aurélien hid it, or I'd have made another long before—
BERTRAND [neutral]: Where was I. Yes. Sit. You're making the heron nervous.
{goto: clock_after}

:: clock_pretty
BERTRAND [thinking]: Pretty. (considers it the way he would a hairspring) The kindest word anyone's used on it in years, and the least useful.
BERTRAND [warm]: I'll take it.
{goto: clock_after}

:: clock_after
PELL [neutral]: Cottage. Kettle. Bertrand, your stairs—
BERTRAND [neutral]: My stairs and I have an understanding, Eddie.
N: Pell lets it go. She has the look of someone who has let it go before.
N: Behind you the heron stands on one leg, fishing in nothing, and the clock says seventeen past four.
[[if player.background == 'homecomer']]
{memory: bertrand, "The {name} kid is back. The bicycle, the rabbit in the box, the Friday boat. I stopped in the middle of a sentence and no one said so.", importance: 8}
{memory: pell, "Walked the {name} kid up Market Row on the left, away from the bench. Bertrand remembered a rabbit. There was no rabbit.", importance: 6}
[[else]]
{memory: bertrand, "Met the new Fellow at the fountain and asked the question: going, or not going? Eddie was counting.", importance: 5}
{memory: pell, "Walked the Fellow up Market Row on the left, away from the bench. Told them the price of rye.", importance: 4}
[[end]]
{set: s01b_done}
{set: met_bertrand}
```
