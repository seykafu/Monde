#### S21 · The Folly
```yaml
id: s21_the_folly
day: 85
time: "08:00-18:00"
place: briar_woods.folly
trigger: "!flag.s21_done && day >= 85 && flag.charter_fragments_all && player.zone == 'briar_woods'"
backdrop: bg_folly_exterior_fog
music: folly_theme
cast: [margo, bertrand, tib]
sets: [s21_done, charter_found, charter_public, charter_quiet]
```
```script
// charter_found voids the Option Clause (engine-side). Riddles LN-1..LN-5 are authored in §14; this scene supplies only the connective tissue.
N: Briar Woods in the morning smells of wet fern and old stone. The Folly is a round tower with no roof, a brass hoop still bolted to the rim of it, a stair going up inside like a thought nobody finished.
N: Margo has the satchel with the six fragments clutched to her chest. Tib carries the lantern, lit, in daylight, because Margo said to. Bertrand has walked the whole way on a cane and will not discuss it.
BERTRAND [neutral]: (leaning on the doorpost, pocket watch in his fist) My master's master walked up this path. He told my master it had a door like a held breath.
TIB [surprised]: Is it haunted?
BERTRAND [laugh]: Only by one man's idea of a joke.
N: Bastien is already inside, asleep on a warm patch of stone the sun hasn't found yet.
MARGO [neutral]: Plates first. The door will have one.

:: ln1
N: A brass plate on the tower door, lantern stamp at the corner, green with age. Eight lines of verse and a keyhole with no key.
{riddle: LN-1}
[[if riddle.solved]]
N: The lock gives with a sound like a tooth coming out.
BERTRAND [thinking]: My master said the door was clockwork inside. He said it opened for a person who'd... who'd...
N: Bertrand stops. His mouth stays a little open. The watch ticks in his hand.
TIB [worried]: Margo?
MARGO [neutral]: (low) Give him a moment. It's coming.
BERTRAND [neutral]: ...who'd read the plate and not the door. Yes. There. He said that.
{regard: bertrand +3}
{goto: ln2}
[[else]]
MARGO [neutral]: Take your time. The Folly isn't going anywhere.
{goto: ln1}
[[end]]

:: ln2
N: Inside, the stair is also a mechanism. Each tread is a lever. Each lever is stamped with a small brass numeral.
{riddle: LN-2}
[[if riddle.solved]]
N: Somewhere in the walls, a long chain begins to draw upward. Dust sifts down onto Tib's hat.
TIB [surprised]: It's a clock! The whole thing's a clock!
MARGO [warm]: It's a clock that was never meant to tell the time.
{goto: ln3}
[[else]]
MARGO [neutral]: It's all right. It's an old stair. It can be patient.
{goto: ln2}
[[end]]

:: ln3
N: At the top, the dome is open to a gray sky. In the center stands a table of brass, round, engraved with the bay and the river and the streets of Monde in lines as fine as hair. Six slots around the rim.
N: Margo sets the fragments in, one at a time, the way you'd lay a child down. They fit. Each one clicks.
MARGO [neutral]: (almost soundless) Old Quarter. Market Row. The Wharf. The Commons. Millbrook. Station Hill.
{riddle: LN-3}
[[if riddle.solved]]
N: The table turns by a quarter. The engraved lines glow faintly where the light from the dome touches them.
BERTRAND [warm]: Ah. There she is.
{goto: ln4}
[[else]]
MARGO [neutral]: No hurry.
{goto: ln3}
[[end]]

:: ln4
N: Under the table there's a glass lens the size of a dinner plate, grey with age. Tib breathes on it and rubs it with his sleeve. A lantern is cut into the glass.
TIB [surprised]: That's the same lantern as on every plaque! It's the same one!
{riddle: LN-4}
[[if riddle.solved]]
N: When the lantern sits right, a bar of light drops through the lens onto the brass. It lands on a small round door in the floor of the table.
MARGO [neutral]: (kneeling beside it, not touching) Whatever's in there, nobody has opened it since the founder.
{goto: ln5}
[[else]]
BERTRAND [neutral]: Easy. Aurélien liked it when people took the long way round.
{goto: ln4}
[[end]]

:: ln5
N: Behind the little door, a clock face with no hands and a slot where a hand should go. Beneath it, a narrow steel case.
{riddle: LN-5}
[[if riddle.solved]]
{sfx: clockwork_tick}
N: The clock starts. It starts ticking in the dark behind the little door, eight beats to the bar, before the case has opened at all.
BERTRAND [surprised]: (very quietly) That's the tower's beat. That's the beat of the tower.
N: The case unlatches.
{goto: charter}
[[else]]
MARGO [neutral]: (hand flat on the brass) It's just a lock. We've done the other four.
{goto: ln5}
[[end]]

:: charter
{set: charter_found}
N: A single sheet of heavy paper, folded in three, tied with a brass thread. Margo's hands won't do the knot. Tib does it for her.
MARGO [neutral]: (reads it first without sound, lips moving, then aloud) "I, Aurélien Monde, clockmaker and mapmaker, being sound in mind and failing in eyes, have copied out in the autumn of 1864 the Charter the first forty households signed with me in 1838."
MARGO [neutral]: "The streets I drew you may redraw. The clock I built you may stop. The Wharf and the Commons I hold in trust for the town, and I set it down here that they are a commons held for the people of Monde for as long as Monde has people."
N: She stops. She reads the last line again, in her head, to be sure it isn't different.
MARGO [sad]: That's all of it. That's the sentence. It was always going to be the sentence.
TIB [worried]: Does it mean we win?
MARGO [warm]: It means nobody can buy the harbor.
BERTRAND [warm]: (lips moving, no sound, then:) "For as long as Monde has people." Hm.
N: He says it twice more, to himself, like a man checking a watch against a church clock.
N: Margo sits on the top step with the paper in both hands. Nobody says anything for a while.
>> CHOICE
- "Take it to Sable. The town should read it tomorrow." → {set: charter_public}; {pillar: spirit +6}; {regard: sable +4}; goto done
- "Take it to Pell. File it at the Town Hall tonight, and say nothing yet." → {set: charter_quiet}; {regard: pell +6}; goto done
- "Ask Margo what the law says about it." → goto ask_margo

:: ask_margo
MARGO [thinking]: Once it's in the public record the Option Clause has nothing to stand on. A Charter nobody's read is an old piece of paper. A Charter read out loud is something a lawyer has to answer.
MARGO [neutral]: If you print it, Vane's people have eleven days to find fault with it. If you file it and wait, they have fewer. But it'll be a surprise, and a surprise lands harder.
MARGO [neutral]: I'd print. I always would. It's your decision.
>> CHOICE
- "Take it to Sable." → {set: charter_public}; {pillar: spirit +6}; {regard: sable +4}; goto done
- "File it quietly with Pell." → {set: charter_quiet}; {regard: pell +6}; goto done

:: done
{set: s21_done}
N: They walk down through the ferns in the afternoon, the satchel and the paper between them. Tib has the lantern. It's gone out. He keeps carrying it.
{memory: margo, "We found the Charter. I read it aloud at the Folly. The last line is exactly the line.", importance: 10}
{memory: bertrand, "The Folly clock beats eight to the bar. The same as the tower. I heard it. I won't forget it, though my head might.", importance: 9}
{memory: tib, "We found the real Charter! It says nobody can buy the harbor. I carried the lantern the whole way down.", importance: 10}
```
