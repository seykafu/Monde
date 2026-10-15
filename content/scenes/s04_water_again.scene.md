#### S04 · Water Again
```yaml
id: s04_water_again
day: 5
time: "09:00-17:00"
place: old_quarter.fountain_square
trigger: "!flag.s04_done && flag.s02_done && player.zone == 'old_quarter'"
backdrop: bg_fountain_square_dry
music: fountain_work
cast: [kasimir, bertrand, tib]
sets: [s04_done, met_kasimir, fountain_started]   # plus pz01_solved or pz01_deferred
```
```script
{fade}
N: Saturday. From Market Row comes the noise of your first market: trestle legs, a crate dropped, somebody arguing about eels.
N: In Fountain Square a pair of boots sticks out of the dry basin.
KASIMIR [neutral]: (from inside the drain) Hm. Could be.
BERTRAND [thinking]: (to the boots, from the bench) You've been saying that for twenty minutes, Mr. Wolanski.
KASIMIR [neutral]: Still could be.
N: The boots withdraw. A barrel-chested man climbs out of the basin with sawdust in his eyebrows and a flat pencil behind one ear. He looks at you, then at his hands. He wipes them on his trousers, which doesn't help.
KASIMIR [neutral]: Kasimir. Fountain.
BERTRAND [warm]: He's being brief. He means: good morning, you're very welcome, and the heron wants water.
KASIMIR [neutral]: Pipe's sound.
BERTRAND [neutral]: That too.
[[if player.background == 'tinkerer']]
KASIMIR [neutral]: (looks at your hands, then at the drain, then at your hands) Hm. Could be.
BERTRAND [laugh]: From him that's a medal. Put it in the Lantern.
{regard: kasimir +3}
[[end]]
KASIMIR [neutral]: Pell signed the chit at seven. (taps his breast pocket) Read the sum twice. She doesn't, usually.
KASIMIR [neutral]: Three columns.
N: He tilts a plank against the basin and writes on it with a stub of chalk, one word at a time, as if each costs him something.
KASIMIR [neutral]: (writes FUND) Two hundred. The Fund pays. Pell signs.
KASIMIR [neutral]: (writes PARTS) Four pipe fittings. Dunmore's has two. Rest, ask around.
KASIMIR [neutral]: (writes HANDS) Six hours. A tenth of your day is an hour. Anyone else who turns up counts two.
N: He stops. He takes the folding rule from his breast pocket and turns it over in his fingers.
KASIMIR [neutral]: (writes VALVES and underlines it twice) That's the part I can't do.
BERTRAND [thinking]: Aurélien laid the waterworks out like a movement, my dear. Nothing opens until something else has opened first. Mr. Wolanski can turn any valve you like. He can't turn them in order.
KASIMIR [neutral]: Neither can he.
BERTRAND [neutral]: My knees won't go down the hatch. They have opinions about ladders.
N: At the bottom of the plank Kasimir draws a small heron with one long leg and, under it, a wavy line. He doesn't label it.
KASIMIR [neutral]: Then it runs.
{project: fountain}
{set: fountain_started}
TIB [neutral]: (over the churchyard wall, hair first) I heard fountain! How many hours? Obviously I'm hours.
KASIMIR [neutral]: Two a day. If you turn up.
TIB [surprised]: Two! I did four on the library table. And a dictionary.
KASIMIR [neutral]: Fine.
TIB [warm]: Fine is his yes. He said it to Mrs. Quill's door for a year and then he fixed her door.
KASIMIR [neutral]: (turns the rule over again) Hatch.
N: He hooks a bar into an iron ring in the paving at the foot of the heron's plinth. Shoulder, a groan of old iron, and a square of cobbles lifts on a hinge, onto darkness and the smell of cold stone.
N: Under the Square is a vault the size of a small kitchen. In it, laid out in a five-by-five grid like a tray of dominoes: iron pipes. Elbows, straights, tees, each with a brass hand-wheel. The main comes in from the west. Somewhere above you the heron waits.
BERTRAND [thinking]: (leaning over the hatch as far as his knees allow) Turn them till nothing leaks, my dear. That's the whole of it.
>> CHOICE
- "I'll go down." → goto pz01_now
- "Parts first. I'll be back." → {set: pz01_deferred}; goto pz01_later
- "What happens if it leaks?" → goto pz01_leak

:: pz01_leak
KASIMIR [neutral]: Wet.
BERTRAND [neutral]: Considerably. Aurélien's valves have a sense of humor.
>> CHOICE
- "I'll go down." → goto pz01_now
- "Parts first. I'll be back." → {set: pz01_deferred}; goto pz01_later

:: pz01_now
{puzzle: PZ-01}
[[if puzzle.solved]]
{set: pz01_solved}
N: Somewhere under your boots, water thinks about it. A long cold gurgle goes up the plinth and stops at the heron's feet. Nothing comes out. Not yet. The pipes hold.
KASIMIR [neutral]: (peers down, then up at you) Holds.
KASIMIR [warm]: Out of true by nothing.
TIB [surprised]: He said out of true by nothing! That's a medal!
BERTRAND [warm]: (winds his watch) It will run when the fittings come and the hours are in. Not before. A fountain, like a clock, won't be hurried.
{regard: kasimir +4}
{regard: bertrand +3}
[[else]]
{set: pz01_deferred}
N: You come up wet to the elbow. Tib laughs. Kasimir lets him.
KASIMIR [neutral]: Give it a day. It'll keep.
[[end]]
{goto: wrap}

:: pz01_later
KASIMIR [neutral]: Give it a day. The hatch keeps.
{goto: wrap}

:: wrap
KASIMIR [neutral]: Dunmore's. Two fittings. Nell'll sell them. Her brother'll say they're spoken for.
KASIMIR [neutral]: They're not.
TIB [neutral]: I'll ask everyone for hours.
KASIMIR [neutral]: Don't ask everyone.
TIB [neutral]: I'll ask the right ones. Obviously.
N: Kasimir holds out the stub of chalk. You take it.
KASIMIR [neutral]: Tick it as you go.
N: From Market Row, a shout, a laugh, and under both a flatter sound: a man's voice counting coins. Kasimir doesn't look up the street.
KASIMIR [neutral]: Saturday.
{regard: kasimir +3}
{regard: tib +2}
{regard: bertrand +2}
[[if flag.pz01_solved]]
{memory: kasimir, "The Fellow came to the fountain and went down the hatch. Turned the valves in order. Pipe holds. Out of true by nothing. Chalk's with them now.", importance: 7}
{memory: bertrand, "The Fellow solved Aurélien's valves in a morning. The heron will have its water. I wound my watch twice for luck.", importance: 7}
{memory: tib, "Kasimir said 'out of true by nothing' to the Fellow. I'm hours now. Two a day.", importance: 6}
[[else]]
{memory: kasimir, "The Fellow came to the fountain. Looked in the hatch, got wet. Chalk's with them. Give it a day.", importance: 6}
{memory: bertrand, "The Fellow went down Aurélien's hatch and came up wet. Nobody laughed except Tib. That is the correct way to begin.", importance: 6}
{memory: tib, "I'm hours for the fountain. Two a day. The Fellow got wet and I laughed too long.", importance: 6}
[[end]]
{set: s04_done}
{set: met_kasimir}
```
