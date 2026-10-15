#### Inserts

Each insert is a short block (3–10 rendered lines per variant) spliced in with `{insert: id}`. Only the variant whose condition is true plays. Inserts use `vote.winner` where the tone must change between a win and a loss.

```yaml
id: inserts_endings
kind: insert_library
```
```script
:: ins_charter
[[if flag.charter_found && vote.winner == 'player']]
MARGO [warm]: (at the edge of the crowd, the satchel held against her chest) It's in the Town Hall safe and there's a copy in the library. The Wharf and the Commons can't be sold. Not by Vane. Not by you, mind.
TIB [laugh]: She made me promise to say that last part.
N: Somebody in the crowd repeats it a half-sentence at a time, the way a rumor goes round. "...for as long as Monde has people."
[[elif flag.charter_found]]
VANE [neutral]: (to Margo, across a gap of lanterns) I've read the paper. It holds. Port Vane will have to be built somewhere that isn't here.
MARGO [surprised]: He's right, you know. That's the strangest part.
N: She holds the satchel a little tighter.
[[else]]
MARGO [sad]: I never found the sixth piece. I'd like that said tonight, in case anyone asks. Five of six. The Folly is still shut.
[[if census >= 200]]
MARGO [thinking]: The Option's still in the archive. As long as we stay above two hundred it can't bite. We're at {census}.
[[else]]
MARGO [worried]: The Option's still in the archive, and we're at {census}.
[[end]]
[[end]]

:: ins_rook
[[if flag.rook_turned]]
N: At the edge of the square Rook stands behind his mother's chair with a lantern he has finally decided to light.
DELPHINE [warm]: (without turning her head) Mind that wick, Roland.
ROOK [neutral]: Yes, Ma.
N: Monday, he starts on the mill floor. Nobody has asked him to wipe his boots at the door. He does it anyway.
[[elif flag.rook_exposed]]
AUGUSTA [neutral]: (low, to {name}, at the edge of the square) Mercer's hearing is in the spring. He'll plead. He asked me to say his mother's chair is on the left side of the fountain.
N: Delphine has set a second lantern beside her own, unlit. She doesn't look at it.
[[elif flag.rook_defeated]]
N: Delphine hasn't opened the letter in her lap. She turns it over once. The postmark is from across the bay.
[[else]]
N: By the lamp-post at the edge of the square Rook stands with his hat low and Nettie at his elbow. The Tollmen haven't gone anywhere. They're quiet.
ROOK [neutral]: (when you catch his eye, a nod, small, without a smile) Saturday.
N: You don't know if that's a warning or an appointment.
[[end]]

:: ins_school
[[if flag.school_saved]]
FELIX [warm]: (herding his pupils into a row with their lanterns) Twenty-one. And a waiting list. I've had to buy a second register.
N: One of the smallest has fallen asleep standing up, lantern tilted. Felix straightens it without a break in his sentence.
[[else]]
FELIX [sad]: (quietly, to {name}) We close at the end of term. Eight of them go to the mainland school in January.
N: He has a pencil case for every child in his pocket. He hands them out one at a time, in the dark, and nobody asks what they're for.
[[end]]

:: ins_station
[[if flag.station_open]]
HOLLIS [neutral]: Friday's at eleven forty. Two minutes late, as a rule.
N: He has the new logbook under his arm. He's written the date on the first page, and nothing else yet.
[[else]]
HOLLIS [neutral]: No train today.
N: He says it the way he writes it. Then, after a second, he adds the last word.
HOLLIS [neutral]: Yet.
[[end]]

:: ins_romance_1
[[if flag.romance_1_bloomed]]
N: {romance_pair_1.a} and {romance_pair_1.b} are sharing a lantern, and neither will say whose it is.
{ai_line: rom1_remark, speaker: pair1_a, brief: "One short, shy sentence said by {romance_pair_1.a} to {romance_pair_1.b} while they hold a lantern between them on election night. Warm, a little embarrassed, in the speaker's own voice. Nothing about the result. A kiss on the cheek at most is implied."}
{fallback: "Mind the wick."}
N: {romance_pair_1.b} reaches over and steadies the pole. Their hands stay there a second longer than the pole needs.
[[end]]

:: ins_romance_2
[[if flag.romance_2_bloomed]]
N: {romance_pair_2.a} and {romance_pair_2.b} are arguing about whose turn it is to hold the lantern. They have been arguing about it since the Row.
{ai_line: rom2_remark, speaker: pair2_a, brief: "One short, teasing sentence said by {romance_pair_2.a} to {romance_pair_2.b} about who holds the lantern. Affectionate bickering in the speaker's own voice. Nothing about the result."}
{fallback: "It's my turn. It's been my turn for an hour."}
N: {romance_pair_2.b} gives in. The lantern goes into {romance_pair_2.a}'s hands, and so does a thermos.
[[end]]

:: ins_romance_3
[[if flag.romance_3_bloomed]]
N: {romance_pair_3.a} and {romance_pair_3.b} are sitting on one of Kasimir's benches, not saying anything, which for them is a speech.
{ai_line: rom3_remark, speaker: pair3_b, brief: "One quiet sentence said by {romance_pair_3.b} to {romance_pair_3.a} while they sit beside each other on election night. Understated, tender, in the speaker's own voice. Nothing about the result."}
{fallback: "It's a good night for sitting."}
N: {romance_pair_3.a} moves a hand an inch along the plank. {romance_pair_3.b} takes it.
[[end]]

:: ins_vane_coin
[[if flag.vanes_coin && !flag.vanes_coin_returned]]
[[if vote.winner == 'player']]
VANE [neutral]: (takes a pale blue slip from his coat) I still have this. You'll want it.
N: He tears it in half and hands you the halves. His face doesn't move at all.
[[else]]
VANE [neutral]: (takes a pale blue slip from his coat) The retainer. I showed it to the town once. That was enough.
N: He holds the corner of it to the flame of a nearby lantern. It goes slowly, then all at once.
[[end]]
[[end]]

:: ins_pell
[[if vote.winner == 'player']]
PELL [warm]: (presses a ring of iron keys into your hand, twenty-six of them) Third drawer sticks. The stamp has a temper. Don't let it see you're nervous.
[[if flag.option_public]]
N: Someone at the back calls "Edwina!" and then a dozen others do. She takes her hat off to them.
[[else]]
N: Only four people in the square know what she carried for twelve years. She meets the eye of each, one by one, and says nothing.
[[end]]
PELL [neutral]: I'll stay on as clerk, if the Council will pay me. I've done it unpaid for eleven years.
[[else]]
PELL [neutral]: (hands Vane the ring of iron keys, twenty-six of them) Third drawer sticks. The stamp has a temper.
PELL [warm]: (to {name}, once he's turned away) I'll stay on as clerk. I'll teach you the stamp, in case it's ever needed.
[[end]]

:: ins_not_registered
[[if !flag.registered]]
PELL [warm]: (to {name}, as the square empties) I should tell you. A good many people wrote your name on their ballot anyway, in pencil. Tib counted.
TIB [surprised]: {write_in_count}. I counted twice.
N: He holds up the slate. At the bottom, in smaller letters than the rest, there's a number and a tiny lantern.
[[end]]
```
