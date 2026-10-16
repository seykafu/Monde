#### S10c · The Straw Poll
```yaml
id: s10c_straw_poll
day: 25
time: "17:30-26:00"
place: commons.bandstand
trigger: "!flag.s10c_done && flag.s10b_done && day == 25"       # summoned: straight after S10b, or later that night
backdrop: bg_commons_fair_dusk
music: fair_dusk
cast: [sable, tib, pell]
sets: [s10c_done, spring_poll_taken]
```
```script
{fade}
N: The oil lamps along the sundial path are burning down. By the flatbed, Sable Moreau has set up a trestle with three of Odile's jam jars on it and a card in her own type: IF MONDE VOTED TOMORROW.
N: The jars are labelled in pencil. THE FELLOW. MR. VANE. OLD MOSS (HE SAYS HE WOULD).
SABLE [neutral]: (taps a jar with her pencil) Straw poll, for the morning's Lantern. One dried bean each, grown-ups only, no lobbying at the trestle.
TIB [neutral]: I counted the beans before. Obviously I'm not allowed one.
SABLE [neutral]: You're eleven. You can hold the lamp.
PELL [neutral]: (from the crate, not quite looking) I'm abstaining, Sable. Minute it.
SABLE [ink_smudge]: Minuted. (to you) You're on a jar. Nobody asked you first. That's what makes it a straw poll.
>> CHOICE
- "Count them. I'd like to know." → goto count
- "Should I be worried?" → goto worried
- "I'm not standing for anything." → goto not_standing

:: worried
SABLE [neutral]: Worried's for galley proofs. This is beans. (tips the first jar out onto the trestle)
{goto: count}

:: not_standing
SABLE [neutral]: Noted. Not printed. You're on a jar either way. (tips the first jar out onto the trestle)
{goto: count}

:: count
{campaign: spring_straw_poll}
[[if vote.winner == "fellow" && vote.share >= 55]]
TIB [surprised]: That's more than half! Obviously that's more than half.
SABLE [neutral]: {vote.share} per cent. Margin of error, plus or minus {vote.margin}. Spell your name for the caption.
PELL [warm]: (quietly, to the lamps) Well. Heavens.
[[elif vote.winner == "fellow"]]
SABLE [thinking]: {vote.share} per cent, and ahead. The margin's plus or minus {vote.margin}, so it goes in as a lead, in small type.
TIB [neutral]: A lead's a lead. Margo says so about library fines.
[[elif vote.winner == "vane"]]
SABLE [neutral]: Mr. Vane. {vote.vane} per cent, for a man who doesn't live here. It goes in straight.
PELL [worried]: (folds the ribbon very small) Forty jobs and forty tulips. It's a good many tulips.
TIB [neutral]: You've got all summer. Obviously.
[[elif vote.winner == "moss"]]
TIB [laugh]: Old Moss! On more ferry!
SABLE [neutral]: {vote.moss} per cent for a man who hasn't said he's standing. I'll need a bigger headline.
PELL [warm]: Mossimo will be unbearable. (she doesn't sound as if she minds)
[[else]]
SABLE [neutral]: Dead level. I'll count them again. (she counts them again) Still level.
TIB [neutral]: Flip a bean.
[[end]]
SABLE [neutral]: (sweeps the beans into her apron) Morning edition, six o'clock. Don't read it in the bath.
{memory: sable, "Ran a straw poll at the Bloom Fair with three of Odile's jam jars. Put the Fellow on a jar without asking. Front page tomorrow.", importance: 7}
{memory: tib, "Held the lamp for Sable's straw poll at Bloom Fair. Counted every bean. Not allowed one, obviously.", importance: 5}
{memory: pell, "Abstained from Sable's straw poll at the fair and watched the beans go in. Minuted.", importance: 6}
{set: s10c_done}
{set: spring_poll_taken}
```
