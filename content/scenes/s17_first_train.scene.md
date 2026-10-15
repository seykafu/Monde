#### S17 · First Train
```yaml
id: s17_first_train
day: 60
time: "11:00-12:30"
place: station_hill.platform
trigger: "!flag.s17_done && day >= 60 && flag.project_station_done"
backdrop: bg_station_platform_noon
music: station_open
cast: [hollis, pell, margo, tib, odile, bertrand, june, felix]
sets: [s17_done, station_open]
```
```script
// Requires the station Project. If it isn't done on Day 60, the engine prints the Dawn Report item in 13.5a and holds the scene until completion.
N: Station Hill, twenty past eleven. Wind off the bay, a new coat of green on the platform rail, and a sign that finally says MONDE in letters that stay put.
N: Thirty people, give or take. Pell sits on a folding chair with her hat on her knee. Odile has buns on a tray under a tea towel. Tib has strung paper bunting along the fence and is retying one end of it for the third time.
BERTRAND [thinking]: (pocket watch open) Station clock's four minutes slow. I'll see to it Tuesday.
MARGO [neutral]: Eleven forty-two, the schedule says.
BERTRAND [neutral]: Schedule says. We'll see what the schedule thinks.
N: Hollis Brandt is not on the platform. His coat hangs off the rail. Up the slope, the signal box has its door open and one light on.
>> CHOICE
- "Wait on the platform with everyone." → goto platform
- "Go up to the signal box." → {regard: hollis +6}; {set: hollis_signal_box}; goto signal_box

:: platform
PELL [neutral]: It's smaller than I remembered. The platform.
TIB [worried]: It's the same size. Margo measured it.
MARGO [neutral]: Eleven point four meters. It hasn't changed.
FELIX [warm]: (herding six pupils into a row behind the fence) Hands in pockets, please. Nobody's touching the rail.
JUNE [neutral]: (guitar case closed on her lap) I thought I'd play something. Then I looked at the platform. Now I don't think I should.
N: Odile lifts a corner of the tea towel, looks at the buns, and puts it back down.
{goto: arrival}

:: signal_box
N: The signal box smells of oil and wet iron. Six levers stand in a row, painted red, white, and yellow. One is polished bright. Hollis stands at it with his cap off.
HOLLIS [neutral]: You'll want to stand clear of the frame.
N: On the desk, a logbook open to the current page. Above today's blank line, in the same tidy hand, a column of entries going back up the page: "No train. No train. No train."
HOLLIS [neutral]: I put the date and the time. Then what came. Every day. Went without a break, but for a week with pneumonia.
HOLLIS [neutral]: (takes out a pocket watch, looks, puts it back) Eleven thirty-one.
{goto: arrival}

:: arrival
{wait}
N: First there's a note in the rails, before there's any sound. The steel changing its mind.
[[if flag.hollis_signal_box]]
HOLLIS [neutral]: (low) That's her.
N: He puts one hand on the lever. He pulls it down. Down the slope, the arm of the signal drops from the horizontal, clunk, clunk, and settles.
HOLLIS [neutral]: (counting under his breath) Ninety seconds. Sixty.
N: He takes his hand off the lever. Then he puts it back.
[[else]]
N: Up the slope, over everyone's heads, the signal arm drops from the horizontal. It goes down as if somebody has been practicing.
[[end]]
{sfx: train_horn_distant}
N: The railcar comes round the curve below the water tower: two cars, borrowed green, one tail lamp cracked. The platform goes quiet in a way thirty people shouldn't be able to manage.
{sfx: brakes_squeal}
{sfx: air_hiss}
N: It stops. It stops at Monde.
[[if flag.hollis_signal_box]]
HOLLIS [neutral]: Eleven forty-four.
HOLLIS [neutral]: Two minutes late.
N: He doesn't move his hand off the lever. You don't speak. Neither of you checks the window.
HOLLIS [neutral]: Pruett was always late.
N: The doors fold open. Hollis lets go of the lever one finger at a time.
HOLLIS [neutral]: (takes the pencil from behind his ear and writes in the log) Monde. Eleven forty-four. Arrived.
N: He looks at the page a long time. Above it, in a column nine years deep, the same two words.
HOLLIS [neutral]: I'll want a new book, I think.
{regard: hollis +4}
[[else]]
N: Through the window of the signal box, a single figure. A hand on a lever. The hand doesn't move for a very long time.
[[end]]
{sfx: door_open}
N: One passenger steps down onto the platform, a woman with a small suitcase and an unfolded map. She looks at the bunting. She looks at the thirty faces.
N: She looks at the sign.
N: "Is this Monde?" she asks. Her voice carries in the quiet.
ODILE [surprised]: (still holding the tea towel) It is, love. It is. Would you like a bun?
{pillar: spirit +6}
{pillar: charm +5}
{sfx: crowd_cheer_small}
N: It's Tib who breaks it. A single yell, and then the paper bunting is coming down and every one of the pupils is over the fence.
[[if flag.hollis_signal_box]]
N: Back in the box, Hollis puts the pencil behind his ear. He pulls the lever back up. Gently.
[[end]]
PELL [warm]: (to no one) That's one.
{wait}
N: Later. The railcar sits at the platform with its engine ticking. Nobody has gone home. Odile is feeding the engineer a bun through the window.
N: Hollis has come down at last, cap back on, to stand at the end of the platform where the rail runs out into the grass.
[[if flag.hollis_signal_box]]
HOLLIS [warm]: You can say it.
PLAYER: It stopped.
HOLLIS [warm]: It did.
[[else]]
HOLLIS [warm]: (to {name}, not looking) You've done a thing there. You'll want to remember the date.
[[end]]
HOLLIS [neutral]: Next one's Friday. Eleven forty. The company says there'll be a proper timetable by the week after.
N: He takes out the logbook, writes "Friday," and underlines it twice.
{set: station_open}
{set: s17_done}
{regard: hollis +8}
{regard: pell +3}
{memory: hollis, "On Day 60 a train stopped at Monde at 11:44, two minutes late. I wrote it in the log. I'll want a new book.", importance: 10}
{memory: pell, "First train came to Monde today. Hollis wrote it in his log. I wept in front of thirty people and nobody mentioned it.", importance: 9}
{memory: margo, "Monde Station opened with a test train on Day 60. Platform: 11.4 meters.", importance: 6}
{memory: tib, "The train stopped! I started the cheering. I was the first one.", importance: 8}
{memory: odile, "The first train. A lady got off and I gave her a bun. She was our first.", importance: 8}
{memory: bertrand, "The station clock is four minutes slow. I'll see to it Tuesday. The train stopped at 11:44.", importance: 7}
{memory: june, "I almost played at the first train. I didn't. I think that was right.", importance: 5}
{memory: felix, "Took the pupils to see the first train. All nine of them were silent. I've never known that to happen.", importance: 7}
```
