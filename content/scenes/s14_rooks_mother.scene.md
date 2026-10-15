#### S14 · Rook's Mother
```yaml
id: s14_rooks_mother
day: 45
time: "09:00-18:00"
place: millbrook.mercer_house
trigger: "!flag.s14_done && flag.met_rook && player.zone == 'millbrook'"
backdrop: bg_mercer_front_room
music: quiet_strain
cast: [delphine, priya, rook]
sets: [s14_done, rook_track_open, delphine_ill_known]
```
```script
N: Third house in the Millbrook terrace, the one with the good curtains. They've been shut since Sunday.
N: Priya Ramaswamy is on the step with her nurse's bag, knocking for the third time.
PRIYA [worried]: (knocks) Mrs. Mercer. It's Priya Ramaswamy. I've brought eggs and I'm not leaving.
PRIYA [neutral]: Oh, good, a witness. One of Felix's little ones ran the whole length of the green to fetch me. Says nobody's opened a window here in three days and there's a noise.
PRIYA [worried]: A cough. Wet. Goes on too long.
{sfx: cough_behind_door}
PRIYA [thinking]: That one. I'd love to say I'm imagining it.
DELPHINE [angry]: (through the door) I'm decent, I'm busy, and I'm not receiving.
PRIYA [neutral]: Mrs. Mercer, I'm the nurse. I'll stand here all day.
DELPHINE [angry]: Then you've the wrong house. Nobody here's ill.
{sfx: cough_behind_door}
{wait}
>> CHOICE
- "Call through the door that you'd like to order curtains for the cottage." → {regard: delphine +4}; goto door_open
- "Let Priya keep talking. She's good at it." → {regard: priya +3}; goto door_open
- "Tell her you're coming in and she can fine you later." → {regard: priya +4}; {regard: delphine -3}; goto door_open

:: door_open
N: The chain rattles off. The door opens the width of one face.
[[if player.background == 'homecomer']]
DELPHINE [surprised]: I know that voice. You're the one who used to take buttons out of my tin.
PLAYER: Only the green ones.
DELPHINE [warm]: Only the green ones. (steps back from the door) Wipe your feet.
{regard: delphine +4}
[[else]]
DELPHINE [neutral]: The Fellow. Of course it is. Mind the thread on the floor, that isn't rubbish.
[[end]]
{fade}
N: The front room is all work. A treadle machine under the window, a dress form wearing half a coat, bobbins in a saucer. Lint sits on every sill like frost.
N: Delphine Mercer is in the chair beside the machine with a blanket over her knees and a hem in her hands. She hasn't sewn a stitch of it.
PRIYA [neutral]: I'm going to listen to your chest.
DELPHINE [angry]: You'll do no such thing in my front room.
PRIYA [warm]: Then I'll stand here and shout questions across it. Your neighbors will love that.
DELPHINE [neutral]: (lifts the cardigan an inch, no more) Be quick.
N: Priya's face does what nurses' faces learn to do. It stays exactly where it was.
PRIYA [worried]: It's the mill chest. Same as the carding girls who stayed on past forty. It comes and goes. This is a goes.
DELPHINE [neutral]: It comes and goes and I've a hem due Thursday.
PRIYA [neutral]: The hem'll keep.
DELPHINE [angry]: The customer won't.
PRIYA [thinking]: I can steam you. I can sit you up on pillows. What you need is a doctor with the right ears and a proper bottle of medicine, and that's across the bay.
DELPHINE [sad]: Ten coins each way on the boat. Forty for the doctor. I can add.
DELPHINE [neutral]: I won't have a collection taken up.
{sfx: boots_on_step}
N: Boots on the step. Priya looks at the door. Delphine looks at the window.
DELPHINE [neutral]: (sits straighter, smooths the blanket) That'll be Roland.
N: The door opens without a knock.
ROOK [worried]: Ma?
N: Rook fills the doorway the way he fills the Quarry. Then he sees his mother's color, and he doesn't.
ROOK [angry]: Who sent for the nurse?
PRIYA [neutral]: A seven-year-old with a plait.
ROOK [angry]: (puts a paper bag on the table) How long's she been like this?
DELPHINE [neutral]: Roland. Your boots.
N: He looks down at his boots. He goes back out onto the mat and wipes them, both feet, three times each.
N: The room is different. Priya has stopped moving. Delphine has found a voice she doesn't use on neighbors.
ROOK [worried]: Three days, the kid said. Three days, Ma.
DELPHINE [neutral]: I can count.
ROOK [angry]: You could've sent anyone. Dex would've run the whole way.
DELPHINE [angry]: I'd not send a Tollman to my own door for a cough. And you can take that bag back out with you.
ROOK [angry]: It's tea. It's peaches.
DELPHINE [angry]: It's Odile Fournier's twenty coins. I could tell you which Saturday.
N: Rook says nothing. His hand stays flat on the paper bag as if it might get up.
>> CHOICE
- "There's a boat across the bay. Somebody has to carry the bag. Rook?" → {regard: rook +4}; {regard: delphine -1}; {set: delphine_helped}; {set: delphine_ferry_booked}; goto ferry_plan
- "Mrs. Mercer, let me pay for the curtains. All twelve windows, money up front." → {coins: -60}; {regard: delphine +6}; {set: delphine_helped}; {set: delphine_commission}; goto commission
- "Whose peaches are those, Rook? Odile's, by the sound of it." → {regard: rook -5}; {regard: delphine +3}; goto sting
- "(Say nothing. It isn't your table.)" → goto quiet

:: ferry_plan
ROOK [neutral]: (doesn't look up) When's the boat?
PRIYA [neutral]: Friday. Old Moss leaves the slip at nine and he won't wait.
ROOK [neutral]: Nine.
DELPHINE [angry]: I never agreed to be carried anywhere.
ROOK [angry]: You agreed to be born in Millbrook. The rest was never up to you.
DELPHINE [neutral]: (looks at him a long moment) Don't be clever. It's the hat. It makes you think you are.
{goto: thread}

:: commission
DELPHINE [thinking]: Twelve windows. That's forty yards of good cloth, and you'll want them lined for the draft off the bay.
DELPHINE [neutral]: I'll take the work. I'll not take it up front. You pay when they hang.
PRIYA [warm]: She'll take forty coins up front for the cloth.
DELPHINE [angry]: Priya.
PRIYA [neutral]: Cloth's cloth. It isn't a collection.
DELPHINE [neutral]: (a pause) Forty, for the cloth.
N: She holds out her hand, palm sideways, the way a tradeswoman does when a price is agreed.
{goto: thread}

:: sting
ROOK [angry]: Say that again outside.
DELPHINE [angry]: You'll say nothing outside. You'll stand there and hear it, Roland. Somebody should have said it eight years ago.
N: Rook's jaw works. He doesn't say it outside.
{goto: thread}

:: quiet
N: You stay by the dress form and look at the half-made coat. Nobody asks you to speak.
{goto: thread}

:: thread
N: Delphine's eyes haven't been good enough for a needle since Sunday. That's why the hem is where it is.
N: Rook picks up the thread without looking at anyone. Spool pin, guide, tension disc, take-up lever, down to the needle. He doesn't think about it. His hands know where the thread goes.
DELPHINE [sad]: You always did pull it left of the disc.
ROOK [neutral]: It goes left of the disc.
DELPHINE [warm]: It does.
N: Nobody in the room says anything for the length of one treadle stroke.
ROOK [neutral]: (sets the threaded needle down) Anything she needs. You send Nettie. She'll find me.
[[if flag.delphine_ferry_booked]]
ROOK [neutral]: Friday. Nine. I'll carry the bag.
[[elif flag.delphine_commission]]
ROOK [neutral]: Pay her what she asks. She'll ask too little.
[[else]]
ROOK [angry]: I never asked either of you in here.
[[end]]
N: The door shuts behind him. He's wiped his boots going out as well.
{set: rook_track_open}
{set: delphine_ill_known}
PRIYA [thinking]: (at the gate, bag on her shoulder) I do the terrace Mondays and Thursdays. She'll say no every time. Keep asking anyway.
[[if flag.delphine_helped]]
PRIYA [warm]: That was well done in there. I thought I'd have to restrain someone.
{regard: priya +3}
[[else]]
PRIYA [neutral]: You can still help her. She's not going to make it easy. Try the Favor board at the Gull.
[[end]]
[[if flag.delphine_helped]]
{memory: delphine, "The Fellow came to my house when I was ill and found a way to help that left me my pride. Roland threaded my machine.", importance: 8}
[[else]]
{memory: delphine, "The Fellow came to my house when I was ill and stood by while Roland and I argued. Roland threaded my machine.", importance: 8}
[[end]]
{memory: rook, "Found the Fellow in my mother's front room. Ma is sick and didn't tell me. I wiped my boots.", importance: 9}
{memory: priya, "Mrs. Mercer has a bad chest and won't take help. The Fellow was there when Rook came in. I'm on the terrace Mondays and Thursdays.", importance: 7}
{set: s14_done}
```
