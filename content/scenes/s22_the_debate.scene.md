#### S22 · The Debate
```yaml
id: s22_the_debate
day: 95
time: "19:00-21:30"
place: market_row.market_hall
trigger: "!flag.s22_done && day >= 95 && flag.registered"
backdrop: bg_market_hall_debate
music: debate_theme
cast: [pell, vane, ines, tib, odile, nell, felix, priya, augusta, rook, delphine, margo, sable, moss]
sets: [s22_done, charter_revealed, coin_confessed, overpromised]
```
```script
// {debate_score: n} moves the player's debate score. {campaign: key} records a choice for the vote model. Blocs named in comments are applied by the engine (§10).
// Four Q slots use speaker auto:<default>. The engine substitutes the resident with the highest-weighted open concern on that topic; the default speaker is used in Quiet Mode.
N: The Market Hall has been cleared of stalls and refilled with every chair in Monde. Two lecterns on the stage, a third for Moss, which is a milk crate with a handkerchief on it.
N: Pell sits at a card table in the middle with a bell. Tib has the bell. He's been told he is allowed to ring it. He's been told he is not allowed to enjoy it.
N: Sable at the press table. Ines in the second row, folder on her knees. The grey caps along the back wall, arms folded, in hats.
PELL [neutral]: (taps the table) Four questions from this hall, two minutes to answer. An attack apiece, one minute. Closing statements. I'm the moderator, so everyone's on their best behavior or I shout.
PELL [neutral]: Opening statements. Mr. Vane, you've won the coin toss.
N: Vane steps to his lectern, opens his coat button, and doesn't look at his notes. There aren't any.
VANE [warm]: Thank you, Edwina. Friends.
VANE [warm]: Ninety-five days ago a young person got off the ferry with a bag and a job title nobody could define. Look what they've done with it. I mean that. A fountain. A bakery. A train on a line I'd have sworn was dead.
VANE [warm]: And I look at the shutters on the Row, and I count the ones still down, and I ask myself what a person of good will would do with the other half. I think they'd build the thing this town can't build for itself.
VANE [warm]: Port Vane is a harbor with a gate and a railhead and three hundred people in hard hats on a Monday morning. It's a drawing, and I have the drawing here.
VANE [warm]: A town doesn't grow on hope. It grows on a payroll. Jobs. Order. A future.
{sfx: applause_mixed}
[[if flag.ines_trust_up]]
N: In the second row, Ines doesn't clap. She turns a page of her folder without reading it.
[[end]]
PELL [neutral]: Mr. Ferrante.
MOSS [neutral]: (stands behind the milk crate, hat in both hands) More ferry.
N: He sits down. The applause is genuine.
{set: moss_spoke_debate}
PELL [neutral]: And the Fellow. Pick your planks. Three. I can't make you say more than that in two minutes.
{pick_planks: 3}
// Planks: plank_jobs (Jobs through co-ops) · plank_safe (Safe streets) · plank_reopen (Reopen what we closed) · plank_young (Bring the young back) · plank_commons (Keep the commons common) · plank_books (Honest books).
// Each pick applies {campaign: plank_X} and sets flag.plank_X. Blocs: jobs -> workers; safe -> shopkeepers, elders; reopen -> families, elders; young -> young, newcomers; commons -> elders, Commons residents; books -> undecided, newcomers.
N: You step up to the lectern.
[[if flag.plank_jobs]]
PLAYER: The cannery co-op, the mill, the shops on the Row. People own their work, and the work stays here.
[[end]]
[[if flag.plank_safe]]
PLAYER: Captain Reyes has one bicycle and one deputy. Give her six, and a lamp on every lane, and nobody on the Row pays a Saturday fee again.
[[end]]
[[if flag.plank_reopen]]
PLAYER: The clinic, the school, the station. What closed, we reopen. In that order, with a date on each.
[[end]]
[[if flag.plank_young]]
PLAYER: Sixty-one empty houses. Rent them cheap to anyone under thirty who'll stay and work. Fill the bandstand on weekends.
[[end]]
[[if flag.plank_commons]]
PLAYER: The Wharf and the Commons stay what they are. Nobody sells the elm. Nobody paves the pond.
[[end]]
[[if flag.plank_books]]
PLAYER: The Town Fund gets printed in the Lantern every month, every coin in and every coin out. Anyone can come check it at the library.
[[end]]
PELL [neutral]: Thank you. Questions.

:: q1
{ai_line: q1_jobs, speaker: auto:nell, brief: "The resident whose top open concern is work and money (default Nell Dunmore) stands in the audience and asks both candidates one direct question about jobs: where the work will come from, who will own it, and whether it will stay in Monde. One or two sentences. Draw on that resident's real situation. Do not name other residents."}
{fallback: "Mr. Vane says three hundred jobs. Fellow, say how many, and where. I've a boat I'd like to keep."}
>> CHOICE
- "Give three real numbers: the co-op, the mill, the Row. Say what each has already hired." → goto q1_real
- "Promise a number you can't yet prove." → {debate_score: +1}; {set: overpromised}; goto q1_after
- "Turn it on Vane: ask where his three hundred jobs live." → goto q1_turn
- "Say you don't know the number yet, and say how you'll find out." → {debate_score: +1}; {regard: nell +2}; goto q1_after
:: q1_real
[[if pillar.prosperity >= 40]]
N: Nods in the third row. Someone at the back says "That's right" out loud, and is shushed.
{debate_score: +2}
[[else]]
N: Your numbers are small and the room can tell. The silence is polite.
{debate_score: -1}
[[end]]
{goto: q1_after}
:: q1_turn
VANE [neutral]: (on his feet before Pell has finished the sentence) In the plan. Page eleven.
[[if flag.jobs_plan_leaked]]
N: In the second row, Ines closes her folder very slowly.
{debate_score: +2}
[[else]]
{debate_score: +1}
[[end]]
{goto: q1_after}
:: q1_after
// q1: workers, shopkeepers. Real numbers with Prosperity >= 40 is the strongest answer; overpromising is remembered (flag overpromised).
N: Tib rings the bell, perhaps a little harder than needed.

:: q2
{ai_line: q2_safety, speaker: auto:odile, brief: "The resident whose top open concern is safety (default Odile Fournier, shaken down by the Tollmen) asks both candidates how and when the Saturday collections will stop. One or two sentences. Tired, polite, specific."}
{fallback: "Every Saturday a boy comes for twenty coins. Who stops him, and by when?"}
>> CHOICE
- "Name the plan: Captain Reyes, streetlights, the shops standing together." → goto q2_plan
- "Say you'll sit down with the Tollmen yourself." → goto q2_talk
- "Promise to end them in a week." → {debate_score: +1}; {set: overpromised}; goto q2_after
- "Say the shopkeepers have carried this alone too long. Say you'll carry some." → {debate_score: +1}; {regard: odile +2}; goto q2_after
:: q2_plan
[[if pillar.safety >= 50]]
N: Odile nods once, the nod she uses for good dough.
{debate_score: +2}
[[else]]
N: The plan sounds like a plan. Several people look at their shoes.
{debate_score: 0}
[[end]]
{goto: q2_after}
:: q2_talk
[[if flag.rook_track_open && regard.rook >= 30]]
N: A low murmur, mostly approval. A few people know why this isn't a silly thing to say.
{debate_score: +2}
[[else]]
N: Somebody laughs, not unkindly.
{debate_score: -1}
[[end]]
{goto: q2_after}
:: q2_after
// q2: shopkeepers, elders. "Sit down with the Tollmen" only works if the Rook track has Regard behind it.

:: q3
{ai_line: q3_young, speaker: auto:felix, brief: "The resident whose top open concern is the young (default Felix Amari, teacher) asks both candidates what they will say to a child who plans to leave Monde at eighteen. One or two sentences. Gentle, plain."}
{fallback: "I have a classroom that sits twenty. What do you say to the ones who'll leave at eighteen?"}
>> CHOICE
- "Homes, work and the bandstand: a reason to stay and a place to play." → goto q3_stay
- "Point at the school's headcount and what changed it." → goto q3_school
- "Say the young will stay if the town is worth staying in." → {debate_score: -1}; goto q3_after
- "Ask Felix what he needs, and promise to do the first thing on the list." → {debate_score: +1}; {regard: felix +2}; goto q3_after
:: q3_stay
[[if pillar.spirit >= 50]]
N: A cheer from a table of under-thirties. June has her hand up to say yes, and then puts it down because she's not a candidate.
{debate_score: +2}
[[else]]
N: The answer doesn't match what the room has seen at night. A few arms fold.
{debate_score: 0}
[[end]]
{goto: q3_after}
:: q3_school
[[if flag.school_saved]]
FELIX [warm]: (from the floor, quietly) Twenty-one as of Monday.
N: The room breaks. It's the first time all night people have applauded a number.
{debate_score: +3}
[[else]]
N: Felix keeps his eyes on his notebook. The number is still small and everyone knows it.
{debate_score: -1}
[[end]]
{goto: q3_after}
:: q3_after
// q3: families, young. School saved is the single strongest rebuttal in the debate.

:: q4
{ai_line: q4_care, speaker: auto:priya, brief: "The resident whose top open concern is health (default Priya Ramaswamy, nurse) asks both candidates how a person in Monde stays safe through the winter when the nearest doctor is a ferry ride away and the ferry runs twice a week. One or two sentences. Practical, a little dry."}
{fallback: "The nearest doctor is a ferry ride away and the ferry runs twice a week. I'm one nurse. What's the plan for winter?"}
>> CHOICE
- "Say what the clinic has done and what the winter schedule is." → goto q4_clinic
- "Pledge the Town Fund to the clinic first, before anything else." → {debate_score: +1}; {campaign: pledge_clinic}; goto q4_after
- "Say Priya's doing it already, and the town should pay her for it." → {debate_score: +1}; {regard: priya +3}; goto q4_after
- "Say you'll look into it." → {debate_score: -1}; goto q4_after
:: q4_clinic
[[if flag.project_clinic_done]]
PRIYA [warm]: (from the floor) The lights are on. I've been in there since August.
{debate_score: +3}
[[else]]
N: The clinic is still a closed door with a hand-lettered sign. Priya looks at the table in front of her.
{debate_score: -1}
[[end]]
{goto: q4_after}
:: q4_after
// q4: elders, families. Clinic Project done is the strongest answer.

:: attack
// Vane's attack uses the first matching weakness, in this order: vanes_coin held, option_kept_secret, project_failed, tollmen_active, pillar.safety < 40, else atk_none.
PELL [neutral]: Mr. Vane. One question to the Fellow, one minute.
N: Vane doesn't go to the lectern. He walks to the edge of the stage with one hand in his coat pocket, the way a man leans on a gate.
[[if flag.vanes_coin && !flag.vanes_coin_returned]]
{goto: atk_coin}
[[elif flag.option_kept_secret]]
{goto: atk_pell}
[[elif flag.project_failed]]
{goto: atk_project}
[[elif flag.tollmen_active]]
{goto: atk_tollmen}
[[elif pillar.safety < 40]]
{goto: atk_safety}
[[else]]
{goto: atk_none}
[[end]]

:: atk_coin
VANE [warm]: Just the one question. On the tenth day, the Fellow sat across a table from me and accepted a retainer. Fifty coins a week, to advise Vane Consolidated.
N: He takes a pale blue slip from his pocket and holds it up to the lights. There is a signature on it.
VANE [warm]: Plenty of people have taken my money. The town should know what it cost.
>> CHOICE
- "Own it. Say you took the coin, say you were wrong, and put every coin of it into the school fund tonight." → {coins: -100}; {set: coin_confessed}; {debate_score: +3}; goto atk_coin_own
- "Turn it round: ask what the rest of his money buys." → goto atk_coin_turn
- "Deny it." → {debate_score: -4}; goto atk_coin_deny
:: atk_coin_own
// Coin cost is clamped to what the player holds. Blocs: shopkeepers, elders, undecided.
N: A beat. The room was braced for a fight. A woman near the front says, quite clearly, "Well, at least they said."
VANE [neutral]: (the smile a size smaller) How refreshing.
{goto: atk_done}
:: atk_coin_turn
[[if flag.ledger_obtained]]
PLAYER: Greyline Security. Two thousand four hundred a month for site security on a site that doesn't exist. I'd like to know whose pocket that comes from.
N: The hall makes a sound like a held breath let go. Vane's hand leaves his pocket.
{debate_score: +2}
[[else]]
PLAYER: I'd ask what a company pays in this town that it can't afford to say.
VANE [warm]: Ask me anything. I have nothing to hide, and a good deal to show.
N: The room doesn't follow you there. You have no page to point at.
{debate_score: -1}
[[end]]
{goto: atk_done}
:: atk_coin_deny
VANE [neutral]: (lifts the slip a little higher) That's your hand, isn't it.
N: In the second row Ines looks at her lap.
{goto: atk_done}

:: atk_pell
VANE [warm]: This is an uncomfortable thing to say about someone I admire. Twelve years ago my company extended this town a loan. The Mayor signed. It was honest business, the kind that kept your streetlights on.
VANE [neutral]: The Fellow has known about that loan for seventy-seven days. And has said nothing. To cover for a friend.
VANE [warm]: A candidate who hides a friend's debt will hide a town's. That's all I'd ask the room to weigh.
>> CHOICE
- "Say it was Pell's to tell, and you asked her to tell it. Then ask her to stand." → goto atk_pell_stand
- "Tell the room the Option Clause no longer matters, and why." → goto atk_pell_charter
- "Change the subject to Port Vane." → {debate_score: -1}; goto atk_done
- "Say you kept it, and you'd keep it again for a friend." → {regard: pell +3}; goto atk_done
:: atk_pell_stand
[[if regard.pell >= 30]]
N: Pell stands at the card table. She puts the bell down, very carefully, next to her glass of water.
PELL [neutral]: He's right about the loan. He's right that I signed. I should have told you. The Fellow told me to, a long while ago.
PELL [angry]: There's a clause in that paper that lets Silas buy the Wharf if we stay under two hundred. We're at {census}. I'm the moderator, Silas. Sit down.
N: There is a moment where nobody breathes. Then the whole hall is on its feet, and not for Vane.
{debate_score: +4}
{regard: pell +4}
[[else]]
N: Pell stays seated. Her face is turned down toward the bell. The silence goes on until it answers for her.
{debate_score: -2}
[[end]]
{goto: atk_done}
:: atk_pell_charter
[[if flag.charter_found]]
PLAYER: A loan can be repaid. An option on the Wharf can't stand against a Charter the founder signed in 1838 and a hall full of people who've read it. The Wharf and the Commons are a commons held for the people of Monde for as long as Monde has people.
N: Margo, in the front row, mouths the last half of the sentence along with you.
{set: charter_revealed}
{debate_score: +3}
[[else]]
VANE [neutral]: There is no Charter, Fellow. There's a story. Libraries like stories.
{debate_score: -3}
[[end]]
{goto: atk_done}

:: atk_project
VANE [warm]: I'll be brief. The Fellow spent {failed_project_cost} coins of the Town Fund on {failed_project}. I walked past it this week. There's a notice in the window and a bird in the rafters.
VANE [neutral]: If that's what happens to the Fund, I'd like to know what happens to a harbor.
>> CHOICE
- "Own it: say what went wrong and what you'd do differently." → {debate_score: +2}; goto atk_done
- "Point at what did work instead." → goto atk_project_deflect
- "Blame the contractor." → {debate_score: -3}; goto atk_project_blame
:: atk_project_deflect
[[if pillar.prosperity >= 40]]
N: It lands. There's a shop open on every second door now, and the room can count.
{debate_score: +1}
[[else]]
N: There aren't enough open doors to answer with. The answer sounds like a deflection.
{debate_score: -1}
[[end]]
{goto: atk_done}
:: atk_project_blame
VANE [warm]: Contractor? I'd understood it was your project.
{goto: atk_done}

:: atk_tollmen
VANE [warm]: Ask Odile Fournier who knocked on her door this week. Ask anyone on the Row. The Fellow has been among us ninety-five days, and the Saturday collection goes on.
VANE [neutral]: I've offered to put Greyline Security on the Row. Order is all I'm asking for.
>> CHOICE
- "Name Greyline. Say whose books pay the Tollmen." → goto atk_tollmen_greyline
- "Admit it isn't over. Name the shops that stood up and refused to pay." → {debate_score: +1}; goto atk_done
- "Say they're just boys, and they'll grow out of it." → {debate_score: -2}; goto atk_done
:: atk_tollmen_greyline
[[if flag.ledger_obtained]]
PLAYER: Greyline Security is Mr. Vane's company. It pays the Tollmen at the crane yard every Saturday night. I have the books.
N: Sable stops writing. Then starts again, much faster.
VANE [neutral]: (very quietly) Ines.
{debate_score: +4}
{set: greyline_named_in_debate}
[[else]]
PLAYER: Greyline pays the Tollmen. I think.
VANE [warm]: You think. I admire the candor.
N: The room hears the word think and keeps it.
{debate_score: -3}
[[end]]
{goto: atk_done}

:: atk_safety
VANE [warm]: Walk the lanes after dark. Ask Captain Reyes how many deputies she has. Ask her how many nights she's slept.
VANE [neutral]: A town that can't keep the lamps lit can't ask a stranger to put a gate on its harbor.
>> CHOICE
- "Ask Captain Reyes to answer for herself." → goto atk_safety_augusta
- "Promise lamps on every lane before the first frost." → {debate_score: +1}; goto atk_done
- "Say crime is down since the spring." → goto atk_safety_claim
:: atk_safety_augusta
[[if regard.augusta >= 30]]
AUGUSTA [neutral]: (stands at the side aisle, cap in her hand) One deputy. One bicycle. In the spring I had neither. Ask me again in the winter. I'll tell you what I'd tell you now: I sleep more.
{debate_score: +3}
[[else]]
AUGUSTA [neutral]: I answer to the Council, thank you.
N: She sits. It doesn't help.
{debate_score: -1}
[[end]]
{goto: atk_done}
:: atk_safety_claim
[[if pillar.safety >= 30]]
{debate_score: +1}
[[else]]
N: The room knows its own lanes. Nobody believes it.
{debate_score: -3}
[[end]]
{goto: atk_done}

:: atk_none
VANE [warm]: I came with a list and I find I haven't a use for it. Ninety-five days, and I can't find a stone the Fellow hasn't turned.
VANE [neutral]: So I'll ask something different. What happens when something goes wrong? Because it will.
>> CHOICE
- "Name three things that went wrong and what you did." → {debate_score: +2}; goto atk_done
- "Say you'll keep learning, alongside the town." → {debate_score: +1}; goto atk_done
- "Say you don't plan for things to go wrong." → {debate_score: -2}; goto atk_done

:: atk_done
// Attack blocs: coin -> shopkeepers, elders. pell -> elders. project -> workers. tollmen/safety -> shopkeepers, families.
{goto: inserts}

:: inserts
[[if flag.rook_turned]]
N: A hand goes up in the back row. A big man in a mill-hand's jacket, a cap crushed in both fists.
PELL [surprised]: Mr. Mercer?
ROOK [worried]: I'd like to say something. If that's allowed.
PELL [neutral]: It's a town hall.
N: He walks the length of the aisle. Delphine is in the third row with her good coat on. She doesn't turn her head. Her hands are folded very still.
ROOK [neutral]: Every Saturday night at the crane yard a man in a grey van gives me an envelope. The envelope says Greyline. Greyline is Mr. Vane's company.
VANE [neutral]: Roland. Sit down.
ROOK [angry]: Twenty coins a week from every shop on the Row. Me, and my crew. We kicked over bins. We frightened off people who wanted to move here. I was told to.
ROOK [neutral]: I took twenty a week off Odile Fournier. I'd like to give it back. I'll work it off on the mill floor, when the Fellow gets it open.
N: Somewhere in the hall, a chair creaks. It might be Odile's.
{debate_score: +6}
{campaign: rook_testimony}
// rook_testimony: biggest single swing in the game. Blocs: workers, shopkeepers, elders, Millbrook.
{regard: odile +3}
{regard: delphine +4}
[[end]]
[[if flag.jobs_plan_leaked]]
N: The second row. Ines Delacroix stands. She is holding a single page in both hands, the way she held the folder on the harbor steps.
INES [neutral]: Excuse me. I'm Mr. Vane's executive assistant. I'd like to read from page eleven of the Port Vane staffing plan.
VANE [neutral]: Ines.
INES [neutral]: "Local hires, full time, year one: forty." I've typed that page eleven times. It said forty every time.
VANE [neutral]: Sit.
N: She doesn't. She puts the page down on the press table, in front of Sable. Then she walks out through the middle of the hall. The grey caps along the wall look at Vane for instructions, and get none.
{debate_score: +4}
{campaign: jobs_plan_leaked}
// jobs_plan_leaked: workers, young, newcomers. Hits the "300 jobs" claim directly.
[[end]]

:: closings
PELL [neutral]: Closing statements. One minute each. Mr. Ferrante.
MOSS [neutral]: More ferry.
{sfx: applause_warm}
[[if flag.charter_quiet && !flag.charter_revealed]]
N: In the front row Margo has the satchel on her knee. She hasn't let go of it all evening. She looks at you.
>> CHOICE
- "Ask Margo to bring it up. Read the Charter to the hall." → {set: charter_revealed}; {debate_score: +4}; {campaign: charter_reveal}; goto vane_close
- "Leave it filed. Let the record speak for itself." → goto vane_close
[[end]]
:: vane_close
VANE [warm]: Friends. I'll say very little and trust you with it.
[[if flag.charter_revealed]]
VANE [warm]: I've heard a document read this evening. It's an old paper. I intend to test it in court, which will take time. In the meantime, the question of who runs this town has to be answered tomorrow.
[[end]]
[[if flag.rook_turned]]
VANE [warm]: Mr. Mercer's sincerity I don't question. I note the timing.
[[end]]
VANE [warm]: I came to Monde because I saw a harbor and a map and a gap between them. I've learned things here that I'd not have learned from a spreadsheet. The cobbles are older than I thought. The bread is better.
VANE [warm]: A town is a promise that someone will be here tomorrow. I can make that promise on a payroll. Jobs. Order. A future.
{sfx: applause_mixed}
:: player_close
PELL [neutral]: Fellow.
>> CHOICE
- "Warm: tell them the first week. Reyes's deputies, Priya's clinic hours, Hollis's timetable on the board." → {debate_score: +2}; {campaign: close_warm}; goto debate_end
- "Honest: list your own mistakes, and ask for the vote anyway." → {debate_score: +2}; {campaign: close_honest}; goto debate_end
- "Fight: walk them through what Port Vane would do to the Commons." → goto close_fight
// Blocs: close_warm -> families, elders. close_honest -> undecided, newcomers. close_fight -> workers; polarizing (elders may recoil).
:: close_fight
[[if flag.ledger_obtained || flag.jobs_plan_leaked]]
N: You have the pages and the room knows you have them. You set the model of the yard against the elm on the Commons and say what stands where.
{debate_score: +3}
{campaign: close_fight}
[[else]]
N: You say what you think Port Vane would do. The room hears an opinion.
{debate_score: 0}
{campaign: close_fight}
[[end]]
{goto: debate_end}
:: debate_end
PELL [neutral]: That's the lot. Polls open at eight tomorrow at the Town Hall. Bring a pencil. Bastien has been at the ones in there.
N: Tib rings the bell. Nobody told him to. Nobody tells him to stop.
{set: s22_done}
[[if flag.charter_revealed]]
{memory: pell, "The debate. The Charter was read aloud. I moderated. I thought I'd be neutral. I wasn't.", importance: 9}
[[else]]
{memory: pell, "The debate. I moderated. I thought I'd be neutral. I wasn't.", importance: 9}
[[end]]
{memory: vane, "The debate. I gave the room everything I had. It listened carefully, which is not the same as agreeing.", importance: 9}
{memory: tib, "I rang the bell at the debate. I rang it a lot.", importance: 6}
{memory: nell, "At the debate I asked about jobs. I'd say the Fellow gave me an answer I could hold.", importance: 7}
{memory: odile, "At the debate I asked about the Saturday collection. I heard what the candidates said and wrote my own answer on the back of my hand.", importance: 7}
{memory: felix, "At the debate I asked about the children. I listened to both. I'll vote on what I've seen.", importance: 7}
{memory: priya, "At the debate I asked about the winter. I'll vote on who answers the phone at three in the morning.", importance: 7}
[[if flag.rook_turned]]
{memory: rook, "I stood up in front of the town and said it out loud. Ma didn't turn her head. She didn't need to.", importance: 10}
{memory: delphine, "Roland stood up at the debate and said it. I kept my hands still. I'm very proud of him and I'll tell him at supper.", importance: 10}
[[end]]
[[if flag.jobs_plan_leaked]]
{memory: ines, "I read page eleven. I'll be looking for work. I find I don't mind.", importance: 10}
[[end]]
```
