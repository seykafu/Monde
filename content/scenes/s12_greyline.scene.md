#### S12 · Greyline
```yaml
id: s12_greyline
day: 33
time: "11:00-15:00"
place: market_row.cafe_liss
trigger: "!flag.s12_done && day >= 33 && player.zone == 'market_row'"       # Saturday; Ines comes in with Vane for the day
backdrop: bg_cafe_liss
music: cafe_idle
cast: [ines, june]
sets: [s12_done, ines_found_no_site]   # plus exactly one path: ines_trust_up | greyline_invoice_seen + ines_trust_up | greyline_invoice_seen + greyline_invoice_taken + june_saw_invoice | (none: left on the table); ines_silence_promised if chosen
```
```script
{fade}
N: Café Liss is a narrow room with six tables, a silver machine that hisses like a cat, and sheet music pinned to the wall wherever the plaster has given up. The window faces Market Row.
N: June is behind the counter, humming something with a rest in it that she's finishing under her breath.
JUNE [neutral]: Friend. Sit anywhere. Everywhere's the good table. (wipes a cup that is already dry) Weasel was in at ten. Twenty coins and a biscuit. I minded the biscuit.
N: The door opens. Ines Delacroix comes in alone, in flat shoes this time, with the thick brown folder under her arm and her satchel across her chest.
INES [neutral]: Good morning. Tea, please. A pot, if it isn't an inconvenience.
JUNE [warm]: Sure. The corner table's yours. It's got the good draft.
N: Ines takes the table in the corner by the window, squares the folder to the edge, and opens it. She counts out the exact coins for the tea before it has arrived.
INES [neutral]: (to June, as the pot lands) To be clear, I was told the gentlemen on the Row are a neighborhood association.
JUNE [neutral]: Sure. They have a very strong handshake.
N: Ines smiles politely at the joke and doesn't hear that it is one.
N: Pages. A pen. A page that she turns, turns back, and reads again.
INES [neutral]: (reading, to herself) Greyline Security. Site security, Monde. Two thousand four hundred a month.
INES [neutral]: We have a trailer. We have a padlock on the trailer.
N: Her pen stops. She reads the line a third time.
INES [worried]: He has a padlock.
JUNE [neutral]: Mm?
INES [neutral]: Forgive me. I was thinking aloud. I do that at tables where nobody's listening.
N: Outside, a car horn. Once. Polite.
N: Ines stands too fast. The folder tips, the pages slide, and she gathers them in the wrong order with the speed of someone who has never in her life been late to a car. She doesn't notice the one page that goes under the chair.
INES [neutral]: Thank you for the tea, Miss Castellanos. I'll see you Monday.
N: The bell. The door. Through the window, a long grey car at the curb, and a man at the wheel who doesn't look at the café.
JUNE [neutral]: She calls me Miss Castellanos. I've stopped correcting her. It's the only title I've got.
JUNE [neutral]: (stops wiping) She left something.
N: Under the chair by the corner table: a single sheet, folded once.
>> CHOICE
- "Run after her and give it back." → {regard: ines +4}; {set: ines_trust_up}; goto return_unread
- "Read it first. Then give it back." → {set: greyline_invoice_seen}; goto read_return
- "Put it in your pocket." → {set: greyline_invoice_seen}; {set: greyline_invoice_taken}; {set: june_saw_invoice}; goto pocket
- "Leave it on the table." → goto leave_it

:: return_unread
N: You catch her at the car door, one hand on the roof. She turns, and you hold out the page without a glance at it.
INES [surprised]: (takes it; her shoulders come down half an inch) You didn't read this.
INES [neutral]: To be clear, you could have. Thank you. I'll see that it's minuted that you didn't.
N: She gets into the car. Vane, at the wheel, nods at you through the glass with great courtesy, and the car pulls away.
{goto: the_end}

:: read_return
N: The page is a printed invoice with a heading in grey capitals.
N: GREYLINE SECURITY. Billed to: Vane Consolidated, Field Office, Monde. Item: site security, Monde. 2,400 coins per month. Payable weekly, in cash, Saturdays, c/o the crane yard. Authorized by: and then nothing at all.
N: You read it twice. There is no site in Monde that needs 2,400 coins of security. There is a trailer on the Wharf with a padlock.
N: You catch her at the car door. She takes the page and looks at it, and then at the crease in it, and then at you.
INES [neutral]: You read it. It's folded the other way.
N: She doesn't ask you to deny it. You don't.
INES [worried]: Then you know what I know. Which is not enough.
INES [neutral]: Forgive me. I'm going to ask for something I have no right to. Please say nothing. Not yet. To be clear, I'm asking, not instructing.
>> CHOICE
- "I won't say a word. Not until you're ready." → {regard: ines +5}; {set: ines_trust_up}; {set: ines_silence_promised}; goto promised
- "I can't promise that. But I'll tell you before I do anything." → {regard: ines +3}; {set: ines_trust_up}; goto honest

:: promised
INES [neutral]: (the page goes into the folder with great care) Thank you. I'll find a way to say that properly.
{goto: the_end}

:: honest
INES [neutral]: That is more than I expected. I'll see that it's minuted.
N: She gets into the car. Her shoulders have come down half an inch. The car pulls away.
{goto: the_end}

:: pocket
N: The page is a printed invoice with a heading in grey capitals.
N: GREYLINE SECURITY. Billed to: Vane Consolidated, Field Office, Monde. Item: site security, Monde. 2,400 coins per month. Payable weekly, in cash, Saturdays, c/o the crane yard. Authorized by: and then nothing at all.
N: You fold it along its crease and put it in your pocket. It weighs nothing at all.
JUNE [neutral]: (wiping the same cup) I didn't see anything. I'm wiping a cup.
N: Through the window the grey car pulls away from the curb. Ines is in the passenger seat with her folder on her knees, not looking at it.
{goto: the_end}

:: leave_it
N: You put the page on the corner table and sit down with your coffee.
JUNE [neutral]: (takes it, folds it again without reading it, and puts it under the till) She'll want it. Anyway.
{goto: the_end}

:: the_end
{memory: june, "Weasel came in at ten for his twenty. Ines had her usual corner and a pot of tea, and left in a hurry. A page went under her chair.", importance: 5}
[[if flag.ines_trust_up]]
{memory: ines, "I left an invoice under a chair in Café Liss and the Fellow brought it to the car. We both know what the line says. I have never been so frightened by a padlock.", importance: 9}
[[elif flag.greyline_invoice_taken]]
{memory: ines, "I left an invoice under a chair in Café Liss. When I went back, it wasn't there. June says nobody turned it in. I am trying to remember what I wrote in the margin.", importance: 9}
{memory: june, "The Fellow put Ines's page in a pocket and I said I'd seen nothing. I was wiping a cup. It's the first lie I've told in a while that I didn't hum.", importance: 8}
[[else]]
{memory: ines, "I left an invoice under a chair in Café Liss. June kept it under the till. No one read it, I'm told. I read it three times myself.", importance: 8}
[[end]]
{set: s12_done}
{set: ines_found_no_site}
```
