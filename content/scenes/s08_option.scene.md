#### S08 · The Option
```yaml
id: s08_option
day: 18
time: "14:00-17:30"
place: old_quarter.lantern_office
trigger: "!flag.s08_done && day >= 18 && player.zone == 'old_quarter'"
backdrop: bg_lantern_office
music: ledger_dusk
cast: [sable]
sets: [s08_done, option_known, met_sable, sable_holds_story]   # plus sable_knows_coin if chosen
```
```script
{fade}
N: The Lantern's office is a long room with a press at one end and a window at the other. In the middle stands one desk, and behind it a second, buried to the knees in paper.
N: Ink on every surface that has ever held still. Bastien sleeps in the E drawer of the type case.
SABLE [neutral]: (at the stone, setting type backwards without looking) Forme closes at midnight. Don't touch the stick. Don't lean on the stone. Sit.
SABLE [neutral]: Not there, that's the stone. There. Move the ribbons.
N: You move the ribbons. They are typewriter ribbons in colors that were never meant for the same shelf.
[[if flag.met_sable]]
SABLE [neutral]: Fellow. We've met. I spelled your name wrong. It's in column two, uncorrected. I was busy, and you're easy to find.
[[else]]
SABLE [neutral]: You're the Fellow. On the record? Good. Spell your name. I'll get it wrong anyway.
N: You spell it. She does.
[[end]]
SABLE [neutral]: (wipes her thumb on her cardigan and leaves a black print on your sleeve) Sorry about the sleeve.
SABLE [neutral]: What do you know about the streetlights.
PLAYER: Eighty-one of a hundred and three still light. Pell counts them at dusk.
SABLE [neutral]: Eighty-one lamps on a Fund that can't carry forty. Somebody's paying. For three weeks I thought it was Pell. Private money. A friend with a full purse.
SABLE [angry]: I was wrong. It's worse.
N: She wipes both hands properly this time, takes a folder from under the stone, and lays it on the desk like something that might wake.
SABLE [neutral]: Council archive, basement, bottom drawer. The lock on that drawer gave out years ago. Frye still keeps the key. The label says STREETLIGHT CONTRACT. It is a streetlight contract, for eight pages. Then it's page nine.
N: A typed sheet, foxed at the edges and signed in two hands. One is E. Pell, Mayor, in blue ink, careful, slightly slanting. The other is a long, confident S. Vane.
SABLE [neutral]: (reads, flat and fast) "Should the census of the Municipality fall below two hundred persons on seven consecutive days, the Lender may at its sole election purchase the Wharf in its entirety, being all land, quays, buildings and works between the River Liss and the breakwater, at a price of one coin per metre of frontage."
SABLE [neutral]: Forty thousand coins, twelve years ago. The lamps stayed lit. And a coin a metre.
N: A new line appears at the top of your Town Ledger, in a hand you didn't write: CENSUS, then today's count, then FLOOR 200. Under it, a small gauge, and a counter for days. The counter reads zero.
{set: option_known}
SABLE [neutral]: I did the sums on the back of a galley. We're not far over. Not far enough. Two bad winters and a ferry strike.
N: The fish market, the cannery, the boathouse, the slip you came off. All the Wharf. Where Nell's boats tie up. You read the clause again to see if the words will change.
[[if flag.vanes_coin]]
SABLE [neutral]: (looks at you for a moment too long) Pub says you drink coffee with Vane on Thursdays. Pub says fifty a week.
N: The letter in Ines's folder said: Advisory services concerning the development potential of the Wharf. The clause says: the Wharf in its entirety. You read one line against the other.
>> CHOICE
- "I took his retainer. I didn't know about this." → {regard: sable +3}; {set: sable_knows_coin}; goto coin_after
- "(Say nothing.)" → {regard: sable -2}; goto coin_after
[[elif flag.vane_offer_open]]
SABLE [neutral]: Pub says Vane offered you an envelope and you asked for a week.
SABLE [neutral]: Take the week. Then think about page nine.
[[end]]

:: coin_after
SABLE [neutral]: Ask. I've an hour before I set the front page.
{ai_open: sable, topic: "The Option Clause as Sable found it: the council archive folder labelled STREETLIGHT CONTRACT, the 40,000-coin loan from Vane Consolidated twelve years ago, Clause 9 (census under 200 for seven consecutive days lets the Lender buy the whole Wharf at a coin per metre of frontage), the two signatures, and why she gave Pell three days before printing. Sable is fast and clipped and answers questions with questions. She does not know why Pell signed, how the money was spent beyond the lamps and payroll, or anything about Greyline or the Tollmen. She never speculates about Pell's motives on the record.", turns: 3}
SABLE [neutral]: I put a note under Pell's door at noon. Typed. Three days. That's what I give. Then it's in the forme and in the street.
SABLE [neutral]: She'll have read it by now. Go and see her. Tonight.
SABLE [neutral]: Not for her sake. I want to know what you do when you know.
N: She turns back to the stone and sets a line of type so fast you only hear it.
N: In the forme, upside down and backward, the headline is already set.
{memory: sable, "Showed the Fellow the Option Clause. They read page nine twice and asked what the Wharf was worth to Nell. I gave Pell three days. The Fellow sees her tonight. I'll know what they are by morning.", importance: 10}
[[if flag.sable_knows_coin]]
{memory: sable, "The Fellow told me about Vane's retainer before I made them. Fifty a week. I'll hold that against nobody. Yet.", importance: 7}
[[elif flag.vanes_coin]]
{memory: sable, "The Fellow took Vane's money and said nothing when I mentioned it. I wrote that down in the margin of the galley.", importance: 8}
[[end]]
{set: s08_done}
{set: met_sable}
{set: sable_holds_story}
```
