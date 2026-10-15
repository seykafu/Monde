#### S01a · The Ferry
```yaml
id: s01a_ferry
day: 1
time: "09:50-10:40"
place: wharf.ferry_slip
trigger: "day == 1 && !flag.s01a_done"          # fires on New Game
backdrop: bg_ferry_slip_morning
music: arrival_theme
cast: [pell, moss, ada]
sets: [s01a_done, met_pell, met_moss, met_ada]  # plus one of return_ticket_kept / return_ticket_torn; plus pell_told_census and pell_remembers_player if chosen
```
```script
N: The *Gannet* comes in sideways, the way she always does, and Old Moss lets her.
N: Gulls on the rail. A diesel cough. A bump, and a second bump to be sure. The slip is a long wet ramp of planks, and at the end of it a small woman holds a clipboard in front of herself like a tray.
N: Bastien sits on the nearest bollard and watches the boat come in.
MOSS [neutral]: (throws a loop of rope at the bollard and misses the cat by a hand) Monde. Mind the gap.
MOSS [neutral]: There isn't one. Mind it anyway.
MOSS [neutral]: Two hours late. Tide. Don't blame the boat.
N: Bastien lets the rope land beside him and does not look at it.
N: You step onto the planks. Salt, diesel, and bread from somewhere uphill.
PELL [worried]: (lowers the clipboard, raises it again) You came. Heavens. On the Tuesday boat, too. That's the right one.
PELL [warm]: Edwina Pell. I'm the mayor. I'm also the welcoming committee and the bunting.
N: She points her pencil at a string of paper flags between two lampposts. Most of the flags are on the ground.
PELL [sad]: There was more. Sunday's wind had other plans.
>> CHOICE
- "It's a lovely welcome." → {regard: pell +3}; goto bunting_kind
- "Is that all the bunting?" → {regard: pell +2}; goto bunting_joke
- "How many people live here?" → {regard: pell +2}; {set: pell_told_census}; goto bunting_count

:: bunting_kind
PELL [warm]: It's one string, dear. But thank you. I'll tell Odile you said lovely. She'll go quiet and bake something.
{goto: form}

:: bunting_joke
PELL [laugh]: (a short, surprised bark) That's all of it. Eleven flags, two lampposts and one mayor on a ladder at six this morning.
PELL [warm]: Nobody's teased me in a while. Arthur used to.
{goto: form}

:: bunting_count
PELL [neutral]: Two hundred and ten. Eleven, if you're staying. I counted this morning.
PELL [worried]: (turns the clipboard over) That's no way to greet someone off a boat. Forgive me.
{goto: form}

:: form
MOSS [neutral]: (tosses your bag onto the slip; it lands upright) That's yours.
PELL [neutral]: Now. Before anything else there's a form. There's always a form. The council insists on them and then doesn't read them.
PELL [thinking]: (unclips a single sheet) "Revitalization Fellow." I wrote that at two in the morning. I haven't been able to look at it since.
N: The sheet is hand-lettered, with boxes. A pencil stub hangs from the clipboard on a bootlace.
PELL [warm]: Take your time. The boat's going nowhere till Friday.
MOSS [neutral]: I can go.
PELL [neutral]: Moss.
MOSS [neutral]: Friday, then.
{charcreate}
N: Pell reads the sheet at arm's length, then at nose's length, and finally through the half-moon glasses on their chain, which is where she should have started.
PELL [warm]: {name}. Good. That's a name you can shout across a harbor.
[[if player.why == 'fresh_start']]
PELL [warm]: "A fresh start." (taps the box) We've plenty in stock. Nobody comes to collect them.
[[elif player.why == 'to_help']]
PELL [warm]: "To help." (taps the box) Write it smaller next time, dear. People get suspicious of help.
[[elif player.why == 'running']]
PELL [neutral]: "Running from something." (reads the box and says nothing about it) The kettle's on at the cottage. I ask whether people take sugar. I don't ask the rest.
[[else]]
PELL [thinking]: "Curious." Good. Margo will be insufferable about it.
[[end]]
[[if player.background == 'homecomer']]
PELL [surprised]: (reads the line again and takes the glasses off) Homecomer. Lived here till twelve.
PELL [surprised]: Heavens. You're the {name} kid. The bicycle with no brakes. Every morning down Lamplighter Lane at the minute Mr. Quill opened his shutters.
PELL [laugh]: He never forgave you for the minute.
PELL [warm]: You came back. (puts the glasses on, takes them off again) I'd a speech. It's gone.
{set: pell_remembers_player}
{regard: pell +3}
[[elif player.background == 'tinkerer']]
PELL [thinking]: Tinkerer. We've a clocktower, a fountain, a lighthouse and a mill. The council owns one spanner.
PELL [warm]: You'll be wanted.
[[elif player.background == 'scrapper']]
PELL [worried]: Scrapper. (reads the line twice) Well. There are some young men on Market Row you'd do best to admire from across the road. For a few days.
[[else]]
PELL [warm]: Organizer. That's the box I was hoping for. It takes four people to hold a jumble sale here, and we have three.
[[end]]
N: A hatch bangs open in the ticket booth. A woman with a pencil behind each ear leans out.
ADA [neutral]: Ada Okafor. Booth. The return half of your ticket's good for Friday's boat. Say if you want it stamped.
PELL [worried]: Ada.
ADA [neutral]: It's printed on the ticket, Edwina.
>> CHOICE
- "I'll keep it." → {set: return_ticket_kept}; {regard: ada +1}; goto ticket_kept
- "Tear it up. I'm staying." → {set: return_ticket_torn}; {regard: ada +3}; {regard: pell +3}; goto ticket_torn
- "Does anyone use theirs?" → {regard: ada +2}; goto ticket_ask

:: ticket_kept
ADA [neutral]: Sensible. (stamps it) Friday, ten o'clock. Don't wait on the slip if it's raining. It's slippery.
{goto: leave}

:: ticket_torn
N: You tear it down the middle. Ada puts both halves in a tin marked STUBS. Pell looks hard at a gull.
ADA [neutral]: Hm. Your money.
{goto: leave}

:: ticket_ask
ADA [neutral]: Last six who came to look at the town. Six returns, all used by the Friday.
PELL [worried]: Ada, please.
ADA [neutral]: It's a count, Edwina. You like counts.
>> CHOICE
- "Then I'll hang on to mine. Ask me Friday." → {set: return_ticket_kept}; {regard: ada +2}; goto leave
- "Then I'd better tear it up." → {set: return_ticket_torn}; {regard: ada +3}; {regard: pell +3}; goto ticket_torn_late

:: ticket_torn_late
N: You tear it down the middle. Ada puts both halves in a tin marked STUBS.
ADA [surprised]: That's the first one in the tin this year.
{goto: leave}

:: leave
PELL [neutral]: Now. Cottage. Kettle. Come up with me and I'll point at things.
N: Bastien jumps off the bollard and leads the way up the slip.
[[if player.background == 'homecomer']]
{memory: pell, "The {name} kid came back on the Tuesday boat. Same walk. I held the clipboard like a tray and lost my speech.", importance: 9}
[[else]]
{memory: pell, "The new Fellow stepped off the Tuesday boat. One string of bunting, eleven flags. I forgot half of what I meant to say.", importance: 8}
[[end]]
{memory: moss, "Brought the Fellow in on the Tuesday boat. Mind the gap, I said. There isn't one.", importance: 4}
[[if flag.return_ticket_torn]]
{memory: ada, "The Fellow tore up the return half in front of me and said they're staying. The tin got its first stub of the year.", importance: 6}
[[else]]
{memory: ada, "The Fellow kept the return half and had it stamped for Friday. Sensible. I'll watch the Friday boat.", importance: 5}
[[end]]
{set: s01a_done}
{set: met_pell}
{set: met_moss}
{set: met_ada}
```
