#### S01c · The Cottage
```yaml
id: s01c_cottage
day: 1
time: "11:30-13:00"
place: old_quarter.lamplighter_cottage
trigger: "flag.s01b_done && !flag.s01c_done"
backdrop: bg_cottage_door
music: cottage_warm
cast: [pell]
sets: [s01c_done, cottage_keys_given]   # plus oq1_opened or oq1_deferred
```
```script
{fade}
N: Lamplighter Lane is the narrowest street in the Old Quarter, and the lamps on it are the oldest.
N: The cottage is the last on the left: a slate roof with a tidy hole in it, a door the color of strong tea, and a brass knocker shaped like a lantern.
PELL [neutral]: (tries a key, jiggles it, tries a second) The first key is the front door. The second is the front door as well. Mr. Quill had them cut twice in case. The third I don't know. It was on the ring.
N: The door gives with a sound like someone clearing their throat.
N: One room. A bed under the hole in the roof, with a bucket on the bed. A stove. A table with one chair. A window, and in the window, the clocktower.
PELL [neutral]: The Fund put coal in. The roof's on the list. It's a long list.
PELL [neutral]: Twenty coins a day, paid Fridays. It's what the Fund can spare.
PELL [worried]: (looks at the bucket) I'd hoped to have the hole done before you came. Kasimir said give it a day. That was Sunday.
N: On the table, under a tin of rolls, a brown envelope with FELLOW on it in careful capitals. Inside, twenty coins and a note: For today. E.P.
{coins: +20}
PELL [neutral]: (touches the knocker on her way past, the way you touch a doorframe in a house you've known) Every house on the lane has one of these. Lanterns. They're older than the lamps.
PELL [neutral]: There's a plate behind this one. Margo will tell you it's a clue. Margo tells everyone everything's a clue.
N: Behind the knocker is a brass backplate no bigger than a playing card, stamped with a lantern. Under the lantern, in letters you have to tilt your head for, five lines of verse.
PELL [neutral]: Go on. I'm not stopping you. I just can't see the use of it before tea.
>> CHOICE
- "Read the plate." → {set: oq1_opened}; goto read_plate
- "Tea first." → {set: oq1_deferred}; goto tea_first

:: read_plate
{riddle: OQ-1}
N: You read it twice. It doesn't get shorter.
PELL [surprised]: (reading over your shoulder, lips moving) Well. I've walked past this door for forty years. It rhymes more than I expected.
PELL [neutral]: Margo will want a rubbing. Don't let her have your pencil.
{goto: cottage_end}

:: tea_first
PELL [warm]: Tea first. Good. The plate's waited this long. It'll wait for the kettle.
{goto: cottage_end}

:: cottage_end
PELL [neutral]: Supper's at the Gull & Anchor if you like. Roz does a pie on Tuesdays. Otherwise there's a tin on the table. Odile's rolls. She'll deny it.
PELL [warm]: (at the door, one hand on the frame) I'm glad you came. I'd say more, but I'd say it badly.
PELL [neutral]: Library's at ten tomorrow. Margo's expecting you. So, I'm told, is Tib.
PELL [neutral]: Now. The lamps.
N: She goes down the lane with her head tilted, already counting.
N: Bastien walks in, inspects the bucket, and takes the only chair.
N: From the window the clocktower still says seventeen past four. The kettle hasn't started yet.
[[if flag.oq1_opened]]
{memory: pell, "Showed the Fellow the cottage. Gave them the wrong key first. They read the plate on the knocker before the kettle boiled. Margo will be unbearable.", importance: 5}
[[else]]
{memory: pell, "Showed the Fellow the cottage. Gave them the wrong key first. They chose tea over the plate on the knocker. I approve.", importance: 5}
[[end]]
{set: s01c_done}
{set: cottage_keys_given}
```
