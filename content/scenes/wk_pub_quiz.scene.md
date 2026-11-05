#### Weekly · Roz's Quiz
```yaml
id: wk_pub_quiz
day: 9
time: "20:00-22:00"
place: market_row.gull_and_anchor
trigger: "weekday == 'wed' && !flag.s10c_done"   # the MVP's Spring ends with the Straw Poll
backdrop: bg_gull_and_anchor_evening
music: harvest_fiddle
cast: [rosalind, june, moss, sable, hollis, kasimir, tib, rook]
sets: [quiz_night_seen, quiz_q1, quiz_q2, quiz_q3, quiz_won, quiz_bastien_joke_seen]   # quiz_won only on a win; quiz_bastien_joke_seen on the first Day 23+ night
repeats: true
```
```script
{fade}
{unset: quiz_q1}
{unset: quiz_q2}
{unset: quiz_q3}
[[if !flag.quiz_night_seen]]
N: Wednesday, eight o'clock, and the slate over the bar has been rubbed out and rewritten. QUIZ. WEDNESDAYS. TEA INCLUDED. Underneath, smaller: Please.
ROSALIND [warm]: (wiping a glass that is already dry) Sit, pet. I'm restarting the quiz. The pub is quiet and I'm not.
N: Four regulars, four tables, one fire. Moss and Kasimir have pushed two tables together without a word, which is how they do everything. Sable has a pencil behind each ear and a Lantern proof folded in her cardigan. Hollis sits exactly under the clock.
HOLLIS [watch_check]: (thumbs his watch) Twenty hundred. Roz, you said eight.
ROSALIND [laugh]: It is eight, Hollis.
HOLLIS [grumble]: Twenty hundred is the correct way to say it.
N: By the fire, in the chair with its back to the wall, sits Rook, cap low, a pint he hasn't touched. He is not playing. Roz put the pint down without asking and he let her.
SABLE [ink_smudge]: (leaning over with a spare pencil) Rook. We're a man short.
N: Rook looks at the pencil as if it were a summons. He shakes his head once. Sable withdraws it with dignity.
SABLE [ink_smudge]: (to you) You'll join us, then. Hollis, move up.
HOLLIS [grumble]: I'm on time. I'm not moving.
N: The sheet is a torn-off page. Sable writes the team name. Hollis crosses it out and writes another. Sable writes the first one back, smaller, in brackets.
N: STOP PRESS (ON TIME). You, Sable and Hollis. Across from you, Moss and Kasimir have named theirs THE SLOWEST BOAT.
[[else]]
N: Wednesday, eight o'clock. The slate says QUIZ and, under it, in Roz's hand, a second Please that wasn't there last week.
ROSALIND [warm]: Sit, pet. Same teams as before if nobody's got ideas.
N: Moss and Kasimir hold the long table. Sable has her pencils. Hollis sits exactly under the clock and has checked it against his watch twice.
[[if flag.quiz_won]]
HOLLIS [grumble]: Last week we won. I'm not saying it was on the timetable. I'm saying it was on time.
[[else]]
SABLE [ink_smudge]: Last week we lost. I've counted the wrong answers. There were more than I'd like on the record.
[[end]]
N: By the fire, Rook has the chair with its back to the wall. The pint is full. It will still be full at ten.
[[end]]
[[if day >= 23]]
{goto: set3}
[[elif day >= 16]]
{goto: set2}
[[else]]
{goto: set1}
[[end]]

:: set1
ROSALIND [warm]: Three rounds, three questions. Teas at the interval. Pens down at the bell.
ROSALIND [warm]: Question one. The clocktower has said the same time for fourteen years. What time?
>> CHOICE
- "Seventeen past four." → {set: quiz_q1}; goto s1q1a
- "Twenty to eleven." → goto s1q1b
- "Whenever Hollis says it is." → goto s1q1c

:: s1q1a
HOLLIS [watch_check]: Sixteen seventeen. Correct. By my watch.
{goto: s1q2}

:: s1q1b
ROSALIND [knowing_look]: That's your own watch, pet. The tower has more patience.
{goto: s1q2}

:: s1q1c
HOLLIS [grumble]: That's not on the timetable.
ROSALIND [laugh]: It's half a point for the compliment, Hollis. I'm not giving it.
{goto: s1q2}

:: s1q2
ROSALIND [warm]: Question two. Fournier and Fille. What does a loaf of rye cost?
>> CHOICE
- "Three coins." → goto s1q2b
- "Whatever Odile decides when she sees your face." → goto s1q2c
- "Two coins." → {set: quiz_q2}; goto s1q2a

:: s1q2a
SABLE [ink_smudge]: Two. White's three. I'll print that. On the record, rye is cheap and the baker is not.
{goto: interval}

:: s1q2b
ROSALIND [warm]: Three's the white, pet. Rye's two. She'll know if you buy the wrong one.
{goto: interval}

:: s1q2c
ROSALIND [laugh]: Nearest to the truth all night, and I'm still marking it wrong.
{goto: interval}

:: s1q3
ROSALIND [warm]: Question three, and it's for the carpenter. The fountain in Fountain Square needs how many pipe fittings?
>> CHOICE
- "Four." → {set: quiz_q3}; goto s1q3a
- "Two. Dunmore's say the rest are spoken for." → goto s1q3b
- "Two hundred." → goto s1q3c

:: s1q3a
KASIMIR [neutral]: Four. (taps the table twice) Wrote it on a plank.
MOSS [engine_ear]: More fountain.
{goto: scoring}

:: s1q3b
KASIMIR [neutral]: They're not spoken for.
ROSALIND [warm]: Two's what Barney's got. It isn't what the fountain wants, pet.
{goto: scoring}

:: s1q3c
KASIMIR [sheepish]: Two hundred is the Fund. Coins. Not fittings.
ROSALIND [laugh]: Kasimir's explaining. Mark that down, Sable. First time since March.
{goto: scoring}

:: set2
ROSALIND [warm]: Three questions. This week's are about people. Gently.
ROSALIND [warm]: Question one. A gentleman in a long grey car offered the Fellow fifty coins a week. In return for what?
>> CHOICE
- "Carrying Ms. Delacroix's folder." → goto s2q1b
- "Telling him what Monde needs, over coffee." → {set: quiz_q1}; goto s2q1a
- "Standing very still on his bonnet." → goto s2q1c

:: s2q1a
SABLE [ink_smudge]: Coffee. Weekly. Honest opinions, particularly the unflattering ones. I'd pay for the unflattering ones myself.
{goto: s2q2}

:: s2q1b
ROSALIND [knowing_look]: That's Delacroix's job, and from what I hear she'd say it's heavy.
{goto: s2q2}

:: s2q1c
MOSS [engine_ear]: Bilge.
ROSALIND [laugh]: The bonnet had an occupant already. Which brings me to question two.
{goto: s2q2}

:: s2q2
ROSALIND [warm]: Which of Monde's residents stepped onto that bonnet before the car had stopped?
>> CHOICE
- "Bastien." → {set: quiz_q2}; goto s2q2a
- "Old Moss, looking for the gap." → goto s2q2b
- "The bronze heron, on one leg." → goto s2q2c

:: s2q2a
SABLE [ink_smudge]: Left one paw print on the grey paint. I've considered a front page.
{goto: interval}

:: s2q2b
MOSS [neutral]: Mind the gap. (pause) There isn't one.
ROSALIND [laugh]: You'll get no argument from me, Moss. You're still wrong.
{goto: interval}

:: s2q2c
HOLLIS [grumble]: It's cast bronze. It does not step. It is not on the timetable.
{goto: interval}

:: s2q3
ROSALIND [warm]: Question three. Ms. Delacroix says her door is on the second floor of which building?
>> CHOICE
- "The Town Hall." → goto s2q3b
- "The Gull & Anchor." → {set: quiz_q3}; goto s2q3a
- "The clocktower. Third stair." → goto s2q3c

:: s2q3a
ROSALIND [knowing_look]: Second floor. Over my head, weekdays. I couldn't say what she types. Between us.
SABLE [coffee_stare]: She types late. I've counted.
{goto: scoring}

:: s2q3b
ROSALIND [warm]: Edwina has the Town Hall and a tin of lamp wicks. No spare floor, pet.
{goto: scoring}

:: s2q3c
HOLLIS [watch_check]: The third stair strikes a flat G. It does not strike second floors.
{goto: scoring}

:: set3
[[if !flag.quiz_bastien_joke_seen]]
N: Before the first question, there's a commotion by the long table. Tib has appeared with the team sheet and a pencil nearly as long as his arm. Bastien sits on a stool by the stove, washing a paw, and looks as if he would like it noted that he came of his own accord.
TIB [gap_grin]: Moss and Kasimir are a man short. So I put Bastien down. Obviously.
TIB [neutral]: I did it properly. Census number two hundred and twelve. Resident.
ROSALIND [knowing_look]: (puts down the glass) Tib. Bastien is a cat.
TIB [neutral]: The census says every resident's an agent. Mum says Pell counts everyone. Bastien's an agent. Obviously he's counted. I read the form.
ROSALIND [warm]: (looks at the cat, then at the ceiling) He's a person for quiz purposes only. Ruling's final. He answers if he wants to.
SABLE [ink_smudge]: (already writing) I'll print a correction. "The Lantern regrets that the census count of two hundred and ten omitted the cat."
N: Bastien finishes the paw and does not look at anybody.
{set: quiz_bastien_joke_seen}
[[else]]
N: Bastien is back on his stool by the stove. Tib has written 212 on the team sheet again, in ink this time.
[[end]]
ROSALIND [warm]: Three questions, all about the tower. Pens ready.
ROSALIND [warm]: Question one. How many steps up the clocktower to the works under the face?
>> CHOICE
- "Fourteen, with a drainpipe." → goto s3q1b
- "Four-seventeen." → goto s3q1c
- "Ninety-six." → {set: quiz_q1}; goto s3q1a

:: s3q1a
TIB [gap_grin]: Ninety-six! I counted twice. Obviously.
{goto: s3q2}

:: s3q1b
TIB [surprised]: That's the alley! Fourteen steps and a drainpipe is the ALLEY!
{goto: s3q2}

:: s3q1c
HOLLIS [watch_check]: That is a time, not a number of steps. I'll allow that it is a time.
{goto: s3q2}

:: s3q2
ROSALIND [warm]: Question two. Which stair in the tower strikes a flat G?
>> CHOICE
- "The ninety-sixth." → goto s3q2b
- "The third." → {set: quiz_q2}; goto s3q2a
- "The one Hollis stands on." → goto s3q2c

:: s3q2a
N: In her corner, June finds the note on the fiddle on the first go and holds it, humming.
JUNE [humming]: Flat G. Mm. Lovely stair. Anyway.
{goto: interval}

:: s3q2b
ROSALIND [laugh]: The ninety-sixth is the top. At the top you're mostly out of breath, pet. No note.
{goto: interval}

:: s3q2c
HOLLIS [grumble]: I stand on nothing in that tower. I have been up it once. It was on time.
{goto: interval}

:: s3q3
ROSALIND [warm]: Question three. Margo found the lantern stamp on part of the clock. Which part?
>> CHOICE
- "The underside of the reading-room table." → goto s3q3b
- "Bertrand's loupe." → goto s3q3c
- "The escapement cover." → {set: quiz_q3}; goto s3q3a

:: s3q3a
SABLE [ink_smudge]: The escapement cover. Margo said write that down. Tib wrote it on his arm. I took it from the arm.
{goto: scoring}

:: s3q3b
ROSALIND [warm]: That's the first stamp. Different question, pet. Right town, wrong lantern.
{goto: scoring}

:: s3q3c
KASIMIR [neutral]: Loupe's glass. Doesn't take a stamp.
{goto: scoring}

:: interval
ROSALIND [warm]: Interval! Teas up. June, pet, if you would.
N: June takes the stool by the stove, tucks the fiddle under her chin, and says "One, two," to nobody. The first bar is low and slow. Then it picks up and walks.
N: The room goes quiet in the good way. Moss taps a boot. Kasimir watches the bow. Hollis checks his watch and, for once, doesn't mind how long it takes.
N: By the fire, Rook keeps his eyes on the flames. At the end of the tune his boot has been tapping for a quarter of a minute without his knowing it. He notices. It stops.
[[if day >= 23]]
{goto: s3q3}
[[elif day >= 16]]
{goto: s2q3}
[[else]]
{goto: s1q3}
[[end]]

:: scoring
ROSALIND [warm]: Pens down! Sable, Kasimir, hand them in.
[[if (flag.quiz_q1 && flag.quiz_q2) || (flag.quiz_q1 && flag.quiz_q3) || (flag.quiz_q2 && flag.quiz_q3)]]
{set: quiz_won}
N: Roz reads the sheets aloud, slowly, for the drama. STOP PRESS (ON TIME) takes it by a head.
ROSALIND [laugh]: Stop Press, with brackets! Prize is a pie on the house. Sable, stop crying into the proof.
HOLLIS [watch_check]: Twenty-one fourteen. We won in good time.
SABLE [ink_smudge]: On the record, I'd like it known I always knew we would.
MOSS [neutral]: Slowest Boat. Lost. (pause) More quiz.
{regard: rosalind +2}
{regard: sable +2}
{regard: hollis +2}
{memory: rosalind, "Wednesday quiz. The Fellow's team, Stop Press (On Time), won. The room was full of laughing and the fire was warm and it was past ten before anyone remembered to go home. Pub's not quiet.", importance: 6}
{memory: sable, "Quiz night at Roz's. The Fellow's team won. I wrote the headline in my head before the last answer. Hollis said we won in good time.", importance: 5}
{memory: hollis, "Quiz at the Gull & Anchor, Wednesday. The Fellow's team won by a head. Twenty-one fourteen. I did not say late.", importance: 5}
[[else]]
{unset: quiz_won}
N: Roz reads the sheets aloud. It's a close thing, which is to say it isn't.
ROSALIND [laugh]: Slowest Boat takes it. Moss, you've won something. Don't look so alarmed.
MOSS [neutral]: (looks at the pie) Hm. Ferry's faster.
HOLLIS [grumble]: Twenty-one fourteen. We lost in good time.
SABLE [ink_smudge]: Next week. Same team. Fewer brackets.
{memory: rosalind, "Wednesday quiz. The Fellow's team lost to Moss and Kasimir. Nobody minded. The snug was half full and the fire was warm. Pub's not quiet.", importance: 5}
{memory: sable, "Quiz night at Roz's. The Fellow's team lost to the Slowest Boat. It was funnier than it should have been.", importance: 4}
{memory: hollis, "Quiz at the Gull & Anchor, Wednesday. We lost. I'd like it entered that the losing was on time.", importance: 4}
[[end]]
{pillar: spirit +1}
N: Roz puts a kettle on at the end of the bar. Rook is gone from the fire, and the chair is turned back to face the room.
{set: quiz_night_seen}
```
