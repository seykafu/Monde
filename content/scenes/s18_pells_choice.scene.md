#### S18 · Pell's Choice
```yaml
id: s18_pells_choice
day: 66
time: "12:00-18:00"
place: station_hill.lookout_bench
trigger: "!flag.s18_done && day >= 66 && flag.pell_retiring"
backdrop: bg_lookout_bench_afternoon
music: quiet_resolve
cast: [pell]
sets: [s18_done, run_yes, run_notyet, run_no]
```
```script
// The Dawn Report carries a note on Day 66: "The Mayor asks the Fellow to meet her at the lookout bench, after noon."
// Exactly one of run_yes / run_notyet / run_no is set at any time. All three can be changed until Day 80 (see S19).
N: The lookout bench sits at the end of Station Hill where the grass gives up and the bay starts. Pell has brought a thermos and two tin cups. Bastien has brought himself.
PELL [neutral]: Sit. It's drafty and the view is free.
N: Bastien steps over the thermos and settles on Pell's left shoe.
PELL [neutral]: I'm going to ask you one thing and then I'll try to be quiet.
[[if flag.option_public]]
PELL [thinking]: You put my paper in the Lantern. I was angry for a week. I haven't slept better since Day 18 than I did the night after it ran.
[[else]]
PELL [thinking]: You kept my paper. I've thought about it a good deal. I can't tell if that was kindness. I've slept a little better. I've eaten a lot less.
[[end]]
PELL [neutral]: Will you run?
PELL [neutral]: I'll not tell you to. I'd make a terrible kingmaker. The last time I picked a successor it was Eddie Hendry, and he went to sea.
PELL [neutral]: Registration opens Day 70. Forty names from people who'd call you a friend, three hundred coins to the clerk, and your evenings from then to Lantern Night. Door shuts Day 80.
[[if flag.station_open]]
N: Down the slope the platform sits empty and freshly painted, with the Friday timetable pinned to the board. Beyond it, the Wharf, the cranes, and a lot of roofs.
[[else]]
N: Down the slope the old platform sits in the long grass, the rails still rusty. Beyond it, the Wharf, the cranes, and a lot of roofs.
[[end]]
>> CHOICE
- "Yes. I'll run." → {set: run_yes}; {unset: run_notyet}; {unset: run_no}; {regard: pell +8}; {item: +signature_book}; goto yes
- "Not yet. Ask me again." → {set: run_notyet}; {unset: run_yes}; {unset: run_no}; {regard: pell +2}; goto notyet
- "No. It isn't for me." → {set: run_no}; {unset: run_yes}; {unset: run_notyet}; goto no
- "What happens if I say no?" → goto ask_no

:: ask_no
PELL [neutral]: Silas Vane wins. Old Moss gets his handful. I'd like to be wrong about that, but I've counted.
PELL [neutral]: And you can change your mind. I want that said out loud, in case you only half hear me. The door at Town Hall stays open to five o'clock on Day 80. Say no today and walk in on the seventy-ninth, and I'll stamp you just the same.
PELL [neutral]: Nothing's carved.
{set: pell_explained_reversible}
>> CHOICE
- "Yes. I'll run." → {set: run_yes}; {unset: run_notyet}; {unset: run_no}; {regard: pell +8}; {item: +signature_book}; goto yes
- "Not yet. Ask me again." → {set: run_notyet}; {unset: run_yes}; {unset: run_no}; {regard: pell +2}; goto notyet
- "No. Not today." → {set: run_no}; {unset: run_yes}; {unset: run_notyet}; goto no

:: yes
PELL [warm]: Right.
N: She unscrews the thermos and pours two cups. The tea has gone stewed in the flask. Neither of you says so.
PELL [neutral]: Here. (hands over a flat biscuit tin with a lid that doesn't shut) I used it in my first run for mayor. Forty-one names. One of them was a dog.
PELL [neutral]: Don't ask people for their names. Ask them what's wrong. The names come later.
PELL [warm]: Mind you, ask Odile first. She'll tell you everyone else.
{goto: wrap}

:: notyet
PELL [neutral]: That's fair. People who say yes straight off, I've voted against.
PELL [neutral]: Ask yourself again at Harvest Supper. I'll not ask you twice, and if you want to be asked, you can come to the bench.
{goto: wrap}

:: no
N: Pell nods. She pours her own tea first, then yours, and holds hers in both hands.
PELL [neutral]: Then I'll say what I tell everyone. You can change your mind. The Town Hall door stays open to five o'clock on Day 80. The clerk locks up at five. The clerk is me. I've been known to lock early, so don't push it.
PELL [neutral]: Say no today, walk in on the seventy-ninth, and I'll stamp you the same as if you'd said yes at the ferry.
PELL [sad]: I'd miss Silas Vane's face, mind. When he found out.
{set: pell_explained_reversible}
{goto: wrap}

:: wrap
PELL [neutral]: I count chimneys from up here. You can't from the Town Hall, the angles are wrong.
[[if census >= 230]]
PELL [warm]: More smoking every week. I keep losing count. I go back to the start.
[[else]]
PELL [neutral]: Fewer than I'd like. More than in the spring.
[[end]]
N: The wind picks up off the bay. Bastien doesn't move from her shoe. She doesn't move the shoe.
{set: s18_done}
[[if flag.run_yes]]
{memory: pell, "On Day 66 on the lookout bench, the Fellow said yes. I gave them my first-mayoral-run signature tin. I hope I've not made a mistake.", importance: 9}
[[elif flag.run_notyet]]
{memory: pell, "On Day 66 on the lookout bench, the Fellow said not yet. I told them where the door is.", importance: 8}
[[else]]
{memory: pell, "On Day 66 on the lookout bench, the Fellow said no. I told them the door stays open to Day 80. I mean it.", importance: 9}
[[end]]
```
