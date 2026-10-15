#### S02 · Monde's Marks
```yaml
id: s02_marks
day: 2
time: "10:00-12:00"
place: old_quarter.library
trigger: "!flag.s02_done && flag.s01c_done && player.zone == 'old_quarter'"
backdrop: bg_library_reading_room
music: library_hush
cast: [margo, tib]
sets: [s02_done, met_margo, met_tib, marks_log_open, charter_claim_heard]   # plus pz03_solved or pz03_deferred; charter_commons_known and margo_skeptic_noted if chosen
```
```script
{fade}
N: Monde Free Library fills the ground floor of a tall thin building. A skylight, a long reading-room table scarred by a century of elbows, and a desk where Margo Liang's pencils have taken most of the room.
N: Bastien lies on the windowsill, on top of a book.
MARGO [neutral]: (holds out a pair of white cotton gloves without looking up) Gloves. It's my paper and I'd like it back.
N: You put them on. She looks up then, looks at your hands, and nods once, as if a form has been countersigned.
MARGO [neutral]: Marguerite Liang. Margo. Library, archive, and the only person in Monde who has read the 1866 minute book to the end. You're the Fellow. Pell says you're here to help the town remember itself.
MARGO [neutral]: That's my sentence. She cut the rest of my draft and kept that one. I'll take one.
[[if player.background == 'homecomer']]
MARGO [thinking]: (walks her fingers down a drawer of cards) {name}. Borrower, juvenile. One overdue: A Child's Guide to Knots. Technically you owe the library a modest sum.
MARGO [neutral]: I'll waive it if you tie something for me. It's been a quiet decade.
{regard: margo +2}
[[end]]
MARGO [neutral]: Sit. Not there, that's foxed. There.
[[if flag.oq1_opened]]
MARGO [neutral]: Pell rang. She says you read the plate behind your knocker before you'd had tea. I'd like to shake your hand. Gloves stay on.
{regard: margo +3}
[[else]]
MARGO [neutral]: Pell rang. She says there's a plate behind your knocker. You haven't read it. I'd like to say that's fine. It's very hard to say.
[[end]]
MARGO [neutral]: Short version. Aurélien Monde, clockmaker and mapmaker. He laid out these streets in eighteen thirty-eight and built the tower. He died in eighteen sixty-five. Sixty-six. February.
MARGO [neutral]: Late in his life he wrote a Charter. The first council's minute book records it was "deposited." It doesn't say where.
MARGO [neutral]: (draws a flat folder toward her and opens it with two fingers) Then there's his letter. Gloves.
N: She reads from a sheet the color of tea. Her voice drops half a tone, the way people's do for hymns.
MARGO [neutral]: "To whoever is still here. I have put the Charter in six pieces and the pieces in six places, that no single hand may carry it off. Mark well the lantern. It is the only thing in this town that has never lied about the time."
MARGO [neutral]: And the line from the preamble, quoted in the same minute book. "A commons held for the people of Monde for as long as Monde has people."
N: She lets the sentence sit on the table between you.
>> CHOICE
- "Do you believe it's real?" → {regard: margo +2}; goto margo_believes
- "What's a commons, exactly?" → {regard: margo +3}; {set: charter_commons_known}; goto margo_commons
- "Sounds like a legend." → {regard: margo -2}; {set: margo_skeptic_noted}; goto margo_legend
- "Show me the Marks." → {regard: margo +3}; goto margo_marks

:: margo_believes
MARGO [neutral]: I believe the minute book. I believe the letter. I believe nineteen lantern stamps around town, because I've rubbed every one I could reach.
MARGO [neutral]: Whether the Charter exists is a separate question. I'd like it answered before the council scraps the brass.
{goto: margo_ledger}

:: margo_commons
MARGO [thinking]: Land held by everyone and owned by no one. In his letters he uses it for two places. The Wharf, because the sea belongs to whoever's standing in it, and the Commons, because he said so.
MARGO [neutral]: If the Charter says what the preamble says, neither can be sold. Not by the council. Not by anyone.
{goto: margo_ledger}

:: margo_legend
MARGO [neutral]: Record. The word is record.
MARGO [neutral]: (closes the folder with two fingers) Come back when you've read the minute book. Page two hundred and eleven.
{goto: margo_ledger}

:: margo_marks
MARGO [neutral]: (leans forward) Yes. Good. Under the table. The lip. Reach.
N: Under the lip of the reading-room table, where no elbow ever goes, there's a stamp the size of a thumbnail. A lantern.
MARGO [neutral]: I was nine. Found it with my chin. Technically that's his signature. There are others. Plaques. Brass. A verse on each.
{goto: margo_ledger}

:: margo_ledger
MARGO [neutral]: One more thing. Then Tib will arrive, because he always arrives, and I'll lose the thread.
N: She opens the founder's household ledger, a fat green book, to page forty. In the margin, in a hand like a row of tiny fence posts: 3.8 · 4.2 · 10.15 · 1.1 · 1.2 · 1.3 · 8.1 · 7.9 · 1.6.
MARGO [neutral]: Nine pairs. Not a date and not a sum; I've tried both. Eleven years I've had them. They want a text to be applied to, and I haven't got the text.
MARGO [neutral]: If I had the text I'd—
{sfx: door_bang}
TIB [surprised]: Margo! Don't be cross!
N: A boy of eleven comes through the door at a run, canvas satchel swinging, a magnifying glass with a cracked rim bouncing on his chest. He carries a damp book in both hands like a tray of eggs.
TIB [neutral]: The wobbly table in the children's corner. Eleven years it wobbled. I took the thing out from under the leg. Obviously I put a different thing back.
MARGO [worried]: What thing.
TIB [neutral]: This. It says Almanac. And 1861. And there's a ring on it from a cup. Or a clock. I'm not sure.
MARGO [surprised]: (very quietly) Tobias. Put it down. On the felt. Gloves.
MARGO [surprised]: Aurélien's Almanac. For the year eighteen sixty-one. It's been propping up a table for—
TIB [neutral]: Eleven years. I counted. Oh, and the table's fixed now. I used the dictionary.
MARGO [neutral]: You used the dictionary.
TIB [neutral]: Volume M. It's the thickest.
TIB [neutral]: Is that the Fellow? Mum says the mayor's gone broke and you're her last go. I said that's rude. Mum said it's also true.
MARGO [neutral]: Tobias.
TIB [warm]: Obviously I'm glad you came. I'm Tib. I know all the alleys. Fourteen steps, one drainpipe, Mrs. Quill's cat. Don't tell Mum.
MARGO [neutral]: (slides the ledger and the almanac side by side on the felt) Line, then word along the line. Nine pairs. My hands shake when it matters. They've no idea they're doing it.
>> CHOICE
- "Let me try." → {regard: margo +2}; goto pz03_now
- "Can I take them home? I want to think." → goto pz03_later

:: pz03_now
{puzzle: PZ-03}
[[if puzzle.solved]]
{set: pz03_solved}
N: The words fall into a line on the page, and for a moment neither of you reads it aloud.
MARGO [surprised]: "My map sleeps in the sixth book of tides."
TIB [surprised]: Volume six! High shelf, by the radiator!
N: Tib is up the ladder before Margo can say his name. He comes down with a flat gray volume, Tide Tables of the Grey Bay, VI. Margo takes it with two fingers and opens it on the felt.
N: Between two pages of tides, folded in eight: a map in brown ink. The streets of Monde, the river, the bay, and six small lanterns in six small districts.
MARGO [neutral]: (sits down on the bottom rung of the ladder) Technically it's a minor irregularity.
MARGO [neutral]: I'd like a moment.
N: Tib counts the lanterns aloud. Six. Then again, in case.
[[else]]
{set: pz03_deferred}
MARGO [neutral]: Take your time. Time is the one thing I'm not short of. The ledger and the almanac stay on the felt.
[[end]]
{goto: map_after}

:: pz03_later
{set: pz03_deferred}
MARGO [neutral]: The ledger doesn't leave the building. The almanac doesn't leave the felt. Come back and they'll be exactly here.
TIB [neutral]: I'll watch them. Obviously.
{goto: map_after}

:: map_after
[[if flag.pz03_solved]]
MARGO [neutral]: Six lanterns. One a district. Each district's first plaque, and each plaque's verse names the place where the next one hides.
MARGO [neutral]: The Old Quarter's is already on your door. The rest you'll have to walk to.
[[else]]
MARGO [neutral]: Even without the map, the Old Quarter's first plaque is on your door. Start there.
[[end]]
MARGO [neutral]: When you find one, wipe it. Brass catches the light. People walk past a bright thing more slowly.
N: A page of your Journal fills with a lantern and one word: MARKS.
{set: marks_log_open}
MARGO [neutral]: Ask me anything about him. I've waited a long time for the second question.
{ai_open: margo, topic: "Aurélien Monde's life and work, the first council's 1866 minute book, the Commons Charter (Margo calls it 'the record' or 'the claim', never 'the legend'), and the lantern Marks she has catalogued. Margo has never held a fragment and has no proof; she knows the lantern stamp is cut on the clocktower's escapement cover but does not know what the lantern pinion is, and says so. She gives hints at the player's current ladder level only and never solves a riddle. She is dry, exact and fast when excited. She distrusts Bertrand's silence about Aurélien but would never say so cruelly.", turns: 4}
TIB [neutral]: Oh, and the best way to the Wharf goes through the back of the chapel. I'll show you. Not today. Today I've to put the dictionary back under the table.
MARGO [neutral]: Tobias. The dictionary is not furniture.
TIB [neutral]: It is now.
N: Bastien shifts on the windowsill. The book beneath him stays warm.
{regard: tib +3}
[[if flag.pz03_solved]]
{memory: margo, "The new Fellow came to the library. Tib broke a table; Aurélien's Almanac was under it. The Fellow solved the ledger margin in one sitting. Map: sixth book of tides. A minor irregularity.", importance: 10}
{memory: tib, "Took the Almanac from under the wobbly table and used the dictionary. The Fellow and Margo found the map. Six lanterns. I counted twice.", importance: 8}
[[else]]
{memory: margo, "The new Fellow came to the library. Tib found the Almanac under a table. The ledger margin is on the felt, unsolved. The Fellow wanted to think. I respect that. I was not calm.", importance: 8}
{memory: tib, "Found the Almanac under the wobbly table. Margo and the Fellow haven't solved the numbers yet. I'm watching the felt.", importance: 7}
[[end]]
{set: s02_done}
{set: met_margo}
{set: met_tib}
{set: charter_claim_heard}
```
