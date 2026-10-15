#### S15 · Regatta Announcements
```yaml
id: s15_regatta_announcements
day: 50
time: "19:00-22:00"
place: wharf.harbor_steps
trigger: "!flag.s15_done && player.zone == 'wharf'"
backdrop: bg_harbor_steps_dusk
music: dusk_harbor
cast: [pell, vane, ines, sable, nell, odile, tib, margo, rosalind, moss]
sets: [s15_done, pell_retiring, vane_candidate, moss_candidate]
```
```script
N: The Regatta's over. The fish fry isn't. Smoke rolls off the grills along the harbor steps, and the last paper boat circles the slip with one wick still lit.
N: Someone has strung bulbs from the mast of the *Gannet*. Old Moss is on the rail with the Slowest Boat trophy, a tin kettle.
MOSS [laugh]: Last again. Third year running. It's a gift, that's what it is.
N: Edwina Pell comes down to the second step with a mug in each hand. She puts one on a bollard. She doesn't have notes.
PELL [neutral]: (taps the mug with a spoon) Can I have a minute? Sit if you've got somewhere to sit.
PELL [neutral]: I'll say this plain. Odile's got fish on and she'll have my hide if it scorches.
PELL [neutral]: I'm not standing again. In the autumn. Twenty-six years of these cobbles, and my knees have filed a complaint.
PELL [sad]: That's the announcement. There's cake.
[[if flag.option_public]]
N: Everyone in the yard knows what she signed twelve years ago. Sable printed it. Nobody looks away from her, and nobody speaks.
PELL [sad]: You all know what I put my name to. I won't ask you to forgive it.
[[else]]
N: Her eyes find yours for half a second. You're one of three people in the yard who know what she's carrying down those steps.
N: Sable, beside the grill, has stopped writing.
[[end]]
[[if pillar.spirit >= 50]]
N: A second of quiet. Then Rosalind starts to clap, one slow pair of hands, and the yard picks it up.
{ai_line: pell_react_warm, speaker: nell, brief: "Nell Dunmore, standing at the front of the crowd, reacts in one or two sentences to the Mayor announcing she will not run again. Warm and blunt, Wharf voice. No mention of Vane, the Option Clause or the election."}
{fallback: "Twenty-six years, Edwina. Sit down before I make a speech myself."}
[[else]]
N: Nobody claps. A chair scrapes. A gull works its way through the silence.
{ai_line: pell_react_flat, speaker: nell, brief: "Nell Dunmore, arms folded, reacts in one sentence to the Mayor announcing she will not run again. Worried, blunt, practical. She asks who is left to take the keys. No mention of Vane or the Option Clause."}
{fallback: "And who's meant to pick up the keys, then?"}
[[end]]
[[if pillar.prosperity >= 45]]
ODILE [warm]: (wipes her hands on her apron) There's a bakery to hand over, Edwina. There wasn't in the spring. That was you.
{pillar: spirit +1}
[[else]]
SABLE [worried]: (pencil stops) Slim pickings for a candidate. Somebody will fill the gap. Somebody who isn't from here.
[[end]]
{sfx: crate_scrape}
N: A fish crate scrapes across the stones. Silas Vane steps onto it in a good coat. Ines Delacroix holds the folder behind him. She is the only one in the yard not looking at him.
VANE [warm]: Is anyone using this? Wonderful. I'll return it, Nell.
VANE [warm]: I'll be brief. The fish are cooling, and I have great respect for fish.
VANE [warm]: Edwina Pell has given this town twenty-six years. Give her your hands.
N: He waits for the applause. He lets it run exactly as long as it will, and not a second more.
VANE [neutral]: Two days ago I bought the harbormaster's house. Some of you saw the van. I don't drive in at ten and out by five anymore. I live on this harbor. I wake up to the same gulls you do.
VANE [warm]: So I'll say what I came to say. I'm running for mayor.
VANE [warm]: Jobs. Order. A future. Three words, and I'll fill in the rest of the sentence between now and Lantern Night. Three hundred jobs at Port Vane. I promise it to your faces, and the faces are the point.
{sfx: murmur_crowd}
[[if pillar.prosperity >= 45]]
N: The crowd is warm to him, but it's the warmth of a crowd that has something to lose. Nell's arms stay folded.
NELL [angry]: We've got a cannery to open ourselves, thanks.
{ai_line: vane_react_confident, speaker: rosalind, brief: "Roz Hale, publican, murmurs a dry one- or two-sentence aside about Silas Vane's pitch to the person beside her, loud enough for the player to hear. She is skeptical but has heard worse. Do not name the Option Clause."}
{fallback: "Three hundred jobs. I've heard three hundred of those."}
[[else]]
N: Heads turn toward him. Somebody near the bait shed says "Three hundred" under their breath, and somebody beside them says it again.
{ai_line: vane_react_hungry, speaker: rosalind, brief: "Roz Hale, publican, quietly admits to the person beside her that three hundred jobs is a lot to turn down in this town. Troubled, not convinced. One or two sentences. Do not name the Option Clause."}
{fallback: "Three hundred jobs. Heaven help me, I'd listen."}
[[end]]
[[if flag.option_public]]
TIB [angry]: That's the man with the Option!
MARGO [worried]: Tobias.
TIB [angry]: Well, he is.
[[else]]
TIB [surprised]: Why does he want the harbor? Is he going to buy it?
MARGO [worried]: Tobias. Hush.
[[end]]
N: On the *Gannet*, Old Moss climbs up onto the rail with the tin kettle.
MOSS [laugh]: Since it's that kind of evening! More ferry! I'm running too!
N: There is a second of total silence. Then the whole yard laughs, even Vane, a little too evenly.
{set: moss_candidate}
{sfx: crowd_laughter}
N: Vane steps off the crate. He hands his folder to Ines without turning his head, and then he's beside you, no one else near.
VANE [neutral]: Fellow. Walk with me. Four steps.
[[if flag.vanes_coin && !flag.vanes_coin_returned]]
VANE [neutral]: You're still on my books. Fifty a week. I like my people comfortable.
[[elif flag.vanes_coin_returned]]
VANE [neutral]: You gave my money back. I noticed. I don't forget.
[[else]]
VANE [neutral]: You never took my coin. I noticed that too.
[[end]]
VANE [neutral]: I'll ask once. Whose side?
>> CHOICE
- "The town's." → {regard: vane -3}; {set: told_vane_town}; goto vane_parts
- "Ask me after Lantern Night." → {regard: vane +2}; goto vane_parts
- "(Walk away from him, up the steps, toward Pell.)" → {regard: pell +4}; {set: pell_comforted_d50}; goto pell_steps

:: vane_parts
VANE [neutral]: Fair.
N: He nods once, as if closing a ledger, and goes. Ines follows with the folder. At the last second she looks back at you, then at the crate, then away.
:: pell_steps
N: Pell is still on the second step with her mug. She hasn't drunk from it. Bastien has arrived from somewhere and is sitting on her shoe.
PELL [neutral]: Well. That's two of us who said something.
PELL [worried]: He was good, wasn't he? I'd forgotten what it sounds like when someone's good at it.
[[if flag.pell_comforted_d50]]
PELL [warm]: Thank you for coming over. Nobody else did. They're afraid it's catching.
{regard: pell +3}
[[end]]
N: She drinks the tea. It is cold. She finishes it.
{pillar: spirit -1}
{set: pell_retiring}
{set: s15_done}
{set: vane_candidate}
[[if flag.pell_comforted_d50]]
{memory: pell, "On Day 50 I told the harbor I wouldn't run. Silas stepped onto a crate straight after. The Fellow came and stood with me.", importance: 9}
[[else]]
{memory: pell, "On Day 50 I told the harbor I wouldn't run. Silas stepped onto a crate straight after. The Fellow was in the crowd.", importance: 9}
[[end]]
[[if flag.told_vane_town]]
{memory: vane, "Announced my candidacy on the harbor steps. Asked the Fellow whose side. The answer was the town's.", importance: 8}
[[else]]
{memory: vane, "Announced my candidacy on the harbor steps. Asked the Fellow whose side. The answer was not yet.", importance: 8}
[[end]]
{memory: ines, "Held the folder while Silas announced. Counted the faces who looked at me. None did.", importance: 6}
{memory: sable, "Pell is not running. Vane is. Moss is, heaven help us. The Lantern needs a front page.", importance: 8}
{memory: nell, "Pell is stepping down. Vane promised 300 jobs. I told him we have our own cannery plans.", importance: 6}
{memory: odile, "Pell is stepping down, and Vane is going for her chair. I burned half a batch of cod.", importance: 5}
{memory: tib, "Mr. Vane wants to be mayor. Moss does too. I said the quiet part and Margo shushed me.", importance: 5}
{memory: margo, "Pell is stepping down. Vane announced. If the Charter is real, now is when it matters.", importance: 8}
{memory: rosalind, "Day 50: Pell resigns, Vane stands, Moss stands. The pub will be busy.", importance: 6}
{memory: moss, "I announced my candidacy. More ferry.", importance: 4}
```
