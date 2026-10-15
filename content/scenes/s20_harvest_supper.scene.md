#### S20 · Harvest Supper
```yaml
id: s20_harvest_supper
day: 75
time: "18:00-22:00"
place: market_row.market_hall
trigger: "!flag.s20_done && day >= 75 && player.zone == 'market_row'"
backdrop: bg_market_hall_supper
music: harvest_fiddle
cast: [odile, vane, ines, nell, felix, rosalind, weasel, pell]
sets: [s20_done, sat_with_nell, sat_with_felix, sat_with_roz, vane_spoke_alone]
```
```script
// {campaign: ...} records an event for the vote model. Blocs named in comments are for the engine; the numbers live in §10.
[[if pillar.spirit >= 50]]
N: The Market Hall is full. Trestle tables run the length of it, hung with squash and strings of onions. There is more noise than the roof was built to handle.
[[else]]
N: The Market Hall is half full. The trestle tables run to the far wall, and the last six are bare. The noise doesn't quite reach the rafters.
[[end]]
N: Odile Fournier is on a chair at the head of the room with a ladle in one hand and a pot lid in the other.
ODILE [angry]: (bangs the pot lid) Eat first. Politics after. Politicians eat last. That's the rule, it's on the bylaw, I wrote it just now.
{sfx: crowd_laughter}
N: Along the back wall, Vane's people have set up shop. Six volunteers in matching grey caps are handing out wicker hampers. Every hamper has a tea towel on top, printed with a single word. A FUTURE.
N: Ines is at the door with a clipboard. She counts heads. She doesn't look at the people she counts.
WEASEL [warm]: (drifting between tables with a jug of apple juice) Friendly question. Just a friendly question. Who you're thinking of voting for? No pressure.
N: Silas Vane arrives last, shaking hands the whole way down the hall. He takes a seat at the head table beside Pell. She moves her plate a half-inch to the left. He notices. He smiles.
N: Where do you sit?
>> CHOICE
- "Beside Nell and the Wharf crowd." → {regard: nell +3}; {set: sat_with_nell}; {campaign: supper_wharf}; goto sit_nell
- "Beside Felix and the families." → {regard: felix +3}; {set: sat_with_felix}; {campaign: supper_families}; goto sit_felix
- "At the bar end, beside Roz." → {regard: rosalind +3}; {set: sat_with_roz}; {campaign: supper_shops}; goto sit_roz

// Blocs: supper_wharf -> workers, wharf district. supper_families -> families, Millbrook. supper_shops -> shopkeepers, Market Row. The engine applies the numbers.

:: sit_nell
N: Nell makes room with an elbow. Her brother's three seats down, pretending not to listen.
{ai_open: nell, topic: "Over harvest supper, Nell says what the Wharf thinks of Vane's 300-jobs pitch and asks what the Fellow would actually do about jobs. She is blunt, practical and a little proud. She mentions the cannery co-op.", turns: 3}
{goto: toast}

:: sit_felix
N: Felix has a baby on one knee that isn't his and a pupil under each arm. He shuffles along the bench.
{ai_open: felix, topic: "Over harvest supper, Felix talks about the school headcount, what he fears if Vane wins, and asks the Fellow one honest question about the children of Monde. He is gentle and stubborn.", turns: 3}
{goto: toast}

:: sit_roz
N: The bar end is a plank on two barrels, where Roz has set out her own jugs and her own opinion of everyone in the hall. She slides a stool over with her foot.
{ai_open: rosalind, topic: "At harvest supper, Roz tells the Fellow selectively what she has heard in the pub this week about Vane's people and the election, and says what she would want from a mayor. She is wry and hears everything.", turns: 3}
{goto: toast}

:: toast
N: Plates are scraped. The pot lid bangs again.
[[if flag.registered]]
ODILE [neutral]: We've a candidate in the room who hasn't said a word. Fellow. Stand up. Say something short.
[[else]]
ODILE [neutral]: We've a Fellow in the room who hasn't said a word. Stand up. Say something short.
[[end]]
>> CHOICE
- "Thank the cooks, say you're glad to be here, and sit down." → {regard: odile +4}; {campaign: supper_humble}; goto vane_answers
- "Tell the room what you'd do in your first week." → {campaign: supper_firstweek}; {set: promised_first_week}; goto vane_answers
- "Ask who has an empty room and a reason to fill it." → {campaign: supper_homes}; {pillar: charm +1}; goto vane_answers
- "Say you'll wash up instead. Someone else can talk." → {regard: odile +6}; {set: vane_spoke_alone}; goto vane_answers

// Blocs: supper_humble -> elders, shopkeepers. supper_firstweek -> workers, families (risk: remembered if unmet). supper_homes -> newcomers, young. Washing up forfeits the floor to Vane; no bloc gain.

:: vane_answers
[[if flag.vane_spoke_alone]]
N: In the pause where you might have spoken, Vane is already on his feet, glass raised, the whole room turning to him like a field to the sun.
[[else]]
N: When you sit, Vane's glass is already in the air. He has the grace to wait for the applause to finish.
[[end]]
VANE [warm]: To the cooks. A town that can lay a table like this one has everything it needs except a door to the world. I intend to build it one.
VANE [warm]: Friends, I won't make a speech. I'll make a promise. When Port Vane opens, there'll be a Harvest Supper in the loading hall for six hundred, and Odile Fournier will bake the bread. At a rate she names herself.
N: Applause, most of it from the grey caps, but not all of it.
{sfx: applause_polite}
ODILE [angry]: (leans in over a platter, voice down) I'll name it. It'll be a number he doesn't like.
INES [worried]: (at your elbow, taking a tea towel from the stack) The hamper's got a card inside. Don't read it at the table.
[[if flag.ines_trust_up]]
INES [worried]: It's an enrollment form. For the Port Vane job register. They're collecting names.
[[end]]
N: Later, after the pie, in the kitchen, Odile hands you a tea towel of your own. It's plain linen.
ODILE [neutral]: You'll want to watch for the ones who clap and don't look at you. They're counting something.
ODILE [warm]: Take a loaf. For the walk home.
{item: +loaf_harvest}
{regard: odile +2}
{set: s20_done}
{memory: odile, "Harvest Supper. I hosted. The Fellow was there, and Vane too, with his tea towels.", importance: 8}
{memory: vane, "First public contest with the Fellow at the Supper. I gave my toast. The room liked me. It liked the pie more.", importance: 7}
{memory: ines, "At the Supper I counted heads for Mr. Vane and gave the Fellow a tea towel.", importance: 5}
{memory: weasel, "Worked the Harvest Supper for the grey caps. Asked a lot of friendly questions.", importance: 4}
{memory: pell, "Harvest Supper: I moved my plate half an inch. Silas noticed. It was the best moment of my week.", importance: 6}
[[if flag.sat_with_nell]]
{memory: nell, "At the Supper the Fellow sat beside me and let me say what the Wharf needs.", importance: 7}
[[end]]
[[if flag.sat_with_felix]]
{memory: felix, "At the Supper the Fellow sat with the families and listened to what I'm afraid of.", importance: 7}
[[end]]
[[if flag.sat_with_roz]]
{memory: rosalind, "At the Supper the Fellow sat at my end of the bar. I told them some of what I know.", importance: 7}
[[end]]
```
