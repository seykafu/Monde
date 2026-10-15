#### S16 · The Ledger
```yaml
id: s16_the_ledger
day: 55
time: "09:00-26:00"
place: old_quarter.lantern_office
trigger: "!flag.ledger_obtained && day >= 55 && player.zone == 'old_quarter'"
backdrop: bg_lantern_office
music: tension_slow
cast: [sable, ines, weasel, augusta, bru]
sets: [s16_done, ledger_obtained, ledger_audited]
```
```script
// Router scene. Priority: Ines (ines_trust_up) > Weasel (coins >= 150 and regard.weasel >= 10) > night break-in (always available).
// Failure in the break-in Scuffle leaves ledger_obtained unset, so the trigger re-arms the next day.
N: The Lantern's front room smells of lead type and cold tea. Sable Moreau hasn't been to bed. Her sleeves are black to the elbow.
SABLE [neutral]: (sets a composing stick on the bench) Sit. I've got eleven minutes before I have to lock up the Thursday page.
[[if flag.s16_seen]]
{goto: router}
[[end]]
[[if flag.greyline_invoice_taken]]
SABLE [thinking]: Your invoice. One line. "Greyline Security, site security, Monde, two thousand four hundred a month." It makes a good headline and a bad court case.
[[elif flag.greyline_invoice_seen]]
SABLE [thinking]: You saw an invoice and put it back. I'd have done the same. It doesn't help me, though. One line is a line.
[[else]]
SABLE [thinking]: I've got a name, Greyline Security, and a post-office box on the mainland. I've got a van that comes to the crane yard every Saturday night. I haven't got a single piece of paper.
[[end]]
SABLE [neutral]: What I need is the books. Who gets paid, how much, by whom, on what dates. Greyline writes it all down. Accountants do.
SABLE [angry]: If I print it, Augusta has to arrest the lot of them. Every name in the book. That includes Rook. If you've plans for Rook, spend them first.
SABLE [neutral]: I can't go. My face is on the masthead. You can.
:: router
[[if flag.ines_trust_up]]
{goto: ines_route}
[[elif coins >= 150 && regard.weasel >= 10]]
{goto: weasel_route}
[[else]]
{goto: breakin_route}
[[end]]

:: ines_route
N: Dusk. A knock at the Lantern's back door, three taps, a pause, one more.
SABLE [surprised]: That's not a subscriber.
N: Ines Delacroix is on the step in her coat, buttoned to the throat, with a canvas bag held in front of her like a tray.
INES [worried]: I'll only talk to {name}. Sable can stay, but she can keep the pencil in her pocket.
SABLE [neutral]: (puts the pencil in her pocket) Done.
INES [neutral]: I started copying on the night of the invoice. Six evenings, carbon paper, the lamp turned down so Roz wouldn't see the light under my door. It's all the Saturday books. Dates, sums, who collected.
INES [worried]: (sets the bag on the bench, hands still on it) There's a line on every page. "Site security, Monde." There's no site. I looked it up. There's never been one.
INES [sad]: I've worked for him four years. I'd like to know what I've been typing.
>> CHOICE
- "I'll keep your name out of it." → {regard: ines +6}; {set: ines_anon_promised}; goto ines_after
- "I can't promise what Sable prints. I'll fight to keep you out." → {regard: ines +2}; goto ines_after
- "Thank you. That's all I've got." → {regard: ines +4}; goto ines_after
:: ines_after
INES [neutral]: (lets go of the bag at last) I'll be at my desk at nine tomorrow. If he asks, I'll say I was ill.
N: She is gone before Sable has found a match.
{set: ledger_from_ines}
{goto: ledger_in_hand}

:: weasel_route
N: The back alley behind Café Liss, after the lamps. A match flares, goes out. A thin shape unfolds from a doorway.
WEASEL [laugh]: Fellow. I hear you've got a hole in your reading material.
WEASEL [neutral]: Hundred and fifty. The Saturday book. The grey-van man keeps it in a biscuit tin under his seat. I borrow it Fridays and put it back by Saturday noon.
WEASEL [thinking]: I never knew what half the numbers were. I just carry.
>> CHOICE
- "Hundred and fifty. Done." → {coins: -150}; {regard: weasel +3}; goto weasel_deal
- "Hundred." → {set: weasel_haggled}; goto weasel_haggle
- "I'll find another way." → goto breakin_route

:: weasel_haggle
[[if regard.weasel >= 25]]
WEASEL [laugh]: Hundred, for you. Because you didn't call me a rat.
{coins: -100}
{regard: weasel +4}
{goto: weasel_deal}
[[else]]
WEASEL [neutral]: Hundred and fifty. I've got a mother too.
{coins: -150}
{goto: weasel_deal}
[[end]]
:: weasel_deal
N: A canvas-bound book changes hands under a lamp that isn't lit.
WEASEL [neutral]: I was never here. You never saw my face. I look different in daylight, ask anyone.
WEASEL [worried]: And if a certain man in a grey coat asks what I sold, I sold a pencil. He pays better than you do. Don't make it a habit, asking.
{set: ledger_from_weasel}
{goto: ledger_in_hand}

:: breakin_route
SABLE [neutral]: Then it's the office. The Wharf, the slick trailer. Vane drives out Saturdays at five. The books for the Wharf run through a Greyline cabinet in the back.
SABLE [neutral]: Don't tell me you're going. Tell Augusta you're taking a walk.
{fade}
{backdrop: bg_constabulary_night}
N: The constabulary has one lamp lit. Captain Augusta Reyes is behind her desk with the occurrence book open and a thermos at her elbow.
AUGUSTA [neutral]: I'm very busy.
[[if regard.augusta >= 20]]
AUGUSTA [neutral]: (turns a page, doesn't look up) It occurs to me I've not walked the crane yard in a month. Tonight, ten to midnight. Loudly, with a flashlight in anyone's face I happen to find there.
AUGUSTA [warm]: That's the occurrence book, you understand. It isn't a conversation.
{set: augusta_blessing}
[[else]]
AUGUSTA [worried]: I don't know you well enough to be busy for you. I hope you're only out for the air.
[[end]]
{fade}
{backdrop: bg_wharf_night}
N: The Wharf at midnight is cranes and canvas and the slow knock of hulls. Vane's trailer sits at the end of the quay with one lit window it forgot to turn off.
[[if flag.augusta_blessing]]
N: From the crane yard, a flashlight swings and a voice carries. "Evening, gentlemen. Looks like I've found a pair of Calloways."
BRU [angry]: (leaving the trailer's step, boots loud on the planks) Oi. That's my brother's.
N: He runs toward the light. The step is empty.
[[else]]
N: Bru Haskett sits on the trailer step with a flask. He sees you before you've decided to be seen.
BRU [angry]: Nobody's meant to be out here. Greyline's paying me to say so.
{scuffle: sc_vane_office_guard}
[[if scuffle.won]]
N: Bru goes down winded, wheezing, one hand up. "Go on, then. I never saw you."
{regard: bru +2}
[[else]]
{fade}
N: You wake in your own bed with a headache and fewer coins than you left with. The morning light is not kind.
{coins: -40}
{goto: end_retry}
[[end]]
[[end]]
{backdrop: bg_vane_trailer_interior}
N: Inside the trailer: a desk with nothing on it, a rug the color of money, a framed map of the bay with the Commons shaded grey. On a side table, a scale model.
N: It's Port Vane. Tin cranes, a toy gantry, a green felt yard where the bandstand was. Someone has glued a tiny elm tree beside the fence, then pulled it off again. The glue shows.
[[if player.background == 'tinkerer']]
N: The cabinet lock is cheap. You've had it open before you've finished admiring the model.
[[else]]
N: The cabinet lock takes a hairpin, a hand mirror and four minutes you can't spare. You do not breathe the whole time.
[[end]]
N: GREYLINE, three drawers. The ledgers are green cloth, ruled in pencil, and every page has the same line at the foot. "Site security, Monde."
{set: ledger_from_breakin}
{goto: ledger_in_hand}

:: ledger_in_hand
{set: ledger_obtained}
{set: s16_done}
{fade}
{backdrop: bg_lantern_office}
N: The Lantern at close. Sable has cleared the bench. A single lamp, three pencils and the green books laid out in a row.
SABLE [thinking]: Billed, guard wages, equipment, retained. Every row adds up to six hundred. Every single week. Nobody's books are that tidy.
SABLE [neutral]: (tips out a paper envelope of receipts, a bank slip, a pocket notebook with a broken spine) So it's not the ledger that lies. It's the ledger against these. I can read a paragraph. I can't read this.
SABLE [neutral]: You take it. Find me the weeks that don't match.
{puzzle: PZ-16}
[[if puzzle.solved]]
{set: ledger_audited}
SABLE [surprised]: (reads the page you slide across, then reads it again) That's the cheque to the van. Dated. Signed in the same ink as the Port Vane permit application.
SABLE [neutral]: I can print it any night. The Lantern goes to press at midnight and I won't ask twice. Say the word at the counter. Or don't. It's a loaded thing to keep in a drawer.
{regard: sable +5}
[[else]]
SABLE [neutral]: Leave it with me. Come back when your eyes are fresher. I'll keep the lamp on.
[[end]]
{goto: finish}

:: end_retry
// Lost the guard Scuffle. Trigger re-arms the next day; the Sable briefing is skipped on the retry via flag s16_seen.
{set: s16_seen}
{goto: finish}

:: finish
{memory: sable, "Got Greyline's books through the Fellow. Whoever delivered them, I mean to make them count.", importance: 9}
[[if flag.ledger_from_ines]]
{memory: ines, "I gave the Fellow my carbon copies of the Saturday books. I can't go back to my desk the same way.", importance: 10}
[[end]]
[[if flag.ledger_from_weasel]]
{memory: weasel, "Sold the Fellow the Saturday book. Hundred and fifty. I'll have a story ready if anyone asks.", importance: 6}
[[end]]
[[if flag.augusta_blessing]]
{memory: augusta, "I walked the crane yard at midnight, loudly. I didn't see anything I'd care to put in the occurrence book.", importance: 7}
[[end]]
```
