#### S11 · The Station
```yaml
id: s11_station
day: 30
time: "06:15-08:00"
place: station_hill.station
trigger: "!flag.s11_done && day >= 30"       # summoned at 06:15 by the Dawn Report invitation; the Station Hill road gate is unlocked by Hollis during the scene
backdrop: bg_station_platform_dawn
music: station_wind
cast: [hollis]
sets: [s11_done, met_hollis, station_hill_open, station_project_active]   # plus hollis_waiting if chosen
```
```script
{fade}
N: The road up Station Hill was locked for nine years and was unlocked for you at six this morning by a man with a key on a bootlace.
N: Wind. A long view down the whole of Monde: the roofs, the tower, the Wharf cranes, and the Grey Bay lying out beyond them like a cloth somebody forgot to fold.
N: Monde Station. A low brick building with a canopy. A platform with weeds in the cracks, a signal box with its window glass whole, a water tower on iron legs. The rails run off both ways into long grass.
N: Hollis Brandt stands at the end of the platform in a railwayman's cap, the badge sanded smooth by his thumb. He has a broom in one hand and a watch in the other, and he isn't holding either like a man who needs them.
[[if day > 30]]
HOLLIS [angry]: Late. I said the thirtieth. Not whenever.
[[else]]
HOLLIS [neutral]: (thumbs the watch open, looks, shuts it) Oh-six-fifteen. On the dot. I'll note it.
[[end]]
N: He takes a notebook from his breast pocket and writes. Upside down you can read it: SERVICE: NONE.
HOLLIS [neutral]: Nine years, four months. None. None. None. I log it every day.
[[if flag.hollis_bertrand_spoke]]
HOLLIS [neutral]: I told Achterberg the time the day his tower went. First thing I've said to him in fourteen years. Don't mention it.
[[end]]
HOLLIS [neutral]: Mind the boards. The platform's sound for forty feet. After that it has views.
N: He leads you along the platform, sweeping as he goes, though there's nothing on it to sweep.
HOLLIS [neutral]: Nine years ago they cut the stop. Said Monde wasn't worth the brake pads. Forty-one years I drove this branch and I was late twice. Cows.
N: The signal box smells of oil and cold iron. A row of levers, polished to a shine at the grips. Hollis puts your hand on the third one.
[[if player.background == 'tinkerer']]
HOLLIS [thinking]: You've read a lever frame before. (watches your hand) Don't pull it. Feel it.
{regard: hollis +3}
[[elif player.background == 'scrapper']]
HOLLIS [neutral]: Don't hit anything. It's been oiled.
[[elif player.background == 'organizer']]
HOLLIS [neutral]: Platform wants forty pairs of hands. You get people to turn up. I've heard.
[[end]]
N: The lever moves an inch with a clunk that goes a long way down the line and doesn't come back.
HOLLIS [neutral]: She answers. Nine years, and she answers. The line's sound. It only wants a driver.
N: Beyond the water tower the rails are bright where trains once polished them and brown where nobody has. The grass has swallowed the sleepers.
HOLLIS [neutral]: What the Branch Board wants is three things. A platform they can put a foot on without a lawsuit. A signal that answers. And a reason.
HOLLIS [neutral]: The reason is people. Forty on the morning train and the Board will stop it. They won't stop it for me.
HOLLIS [neutral]: (unfolds a sheet from his notebook) Itemized. Three thousand coins. Forty hours of hands. Rail spikes, signal parts, paint. I've done it twice, and the second time the answer was the same.
N: The sheet is in a ruler-straight hand, with the total underlined once.
HOLLIS [neutral]: I'll hold the kettle till half past. After that the platform's cold.
>> CHOICE
- "Yes. Let's get a train to stop here." → {regard: hollis +6}; {pillar: spirit +2}; goto yes
- "It's a lot. Tell me what it needs, in order." → {regard: hollis +4}; goto order
- "Not yet. The ferry first." → {regard: hollis +1}; {set: hollis_waiting}; goto notyet

:: yes
HOLLIS [neutral]: (a pause that lasts exactly four seconds) Hm.
HOLLIS [neutral]: First thing is paint. A station board with a name on it. A train driver reads the board.
{goto: the_end}

:: order
HOLLIS [warm]: In order. Yes. Nobody has asked me in order in nine years.
HOLLIS [neutral]: Board and paint. Lamp lens for the signal box. Platform boards. Sleepers where the water tower ends. Then the signal. Then the Board, with a letter from the mayor.
{goto: the_end}

:: notyet
HOLLIS [neutral]: The ferry sails Tuesdays and Fridays. A train would run daily. By my reckoning the order's clear.
HOLLIS [neutral]: Fine. I'll be here. I'm always here. That's the difficulty.
{goto: the_end}

:: the_end
{project: station}
{set: station_project_active}
HOLLIS [neutral]: (writes) Service: none. Visitor: one. The Fellow. (checks the watch) Forty-one minutes.
HOLLIS [neutral]: First entry in nine years that isn't none all the way down.
N: He shuts the notebook and puts it away.
N: The wind comes up the line from the bay and sings in the rail for a second, two, and stops. Hollis lays his palm flat on the rail the way you'd put it on a horse.
HOLLIS [neutral]: Wind. Not on the timetable.
{memory: hollis, "The Fellow came up Station Hill at oh-six-fifteen and stayed forty-one minutes. I showed them the lever and the sheet. First visitor in the log. Service: none, but it's the first line that has company.", importance: 9}
{set: s11_done}
{set: met_hollis}
{set: station_hill_open}
```
