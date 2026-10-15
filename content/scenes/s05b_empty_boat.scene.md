#### S05 · First Arrival (empty-boat variant)
```yaml
id: s05b_empty_boat
day: 7
time: "07:45-09:30"
place: wharf.ferry_slip
trigger: "!flag.s05_done && !flag.s05_b_seen && day >= 7 && ferry_day && appeal < 35"   # plays once; S05 then stays armed for the first sailing day with Appeal >= 35
backdrop: bg_ferry_slip_morning
music: slip_empty
cast: [pell, moss]
sets: [s05_b_seen]   # does NOT set s05_done, so S05 re-arms; plus asked_pell_how_bad, promised_full_boat, pell_shared_fear if chosen
```
```script
N: The *Gannet* ties up. Mailbags go off. Two crates of Nell's herring go on. Nobody walks down the slip.
MOSS [neutral]: (coiling a rope that is already coiled) Mail. Herring. Nothing with legs.
N: Pell stands at the end of the slip with her clipboard. There's nothing on it. She holds it anyway.
PELL [neutral]: I come to every boat. (doesn't look at you) I stand here the way you'd stand at a window.
PELL [neutral]: People look at a place from the deck. An afternoon, that's all it takes. A dry fountain, a dark lighthouse, shutters. They decide before they've smelled Odile's rye.
PELL [worried]: I'm frightened, dear. There. I've said it to a person instead of a lamp.
>> CHOICE
- "I'm scared too." → {regard: pell +6}; {set: pell_shared_fear}; goto b_shared
- "We'll fill that boat." → {regard: pell +3}; {set: promised_full_boat}; goto b_promise
- "How bad is it, really?" → {set: asked_pell_how_bad}; goto b_deflect
- "(Stand beside her until the engine fades.)" → {regard: pell +4}; goto b_stand

:: b_shared
PELL [warm]: (a small, surprised breath) Thank you. Heavens, that helps more than it should.
{goto: b_join}

:: b_promise
PELL [warm]: (looks at you, then at the empty slip, then at you) You haven't any idea what you've just promised. I'm very glad you said it.
{goto: b_join}

:: b_deflect
PELL [neutral]: Eighty-one lamps lit, out of a hundred and three. Now. Have you seen the fountain? Kasimir has views.
N: She says "Now" the way another person would close a door.
{goto: b_join}

:: b_stand
N: You stand beside her. The *Gannet*'s engine fades round the breakwater. A gull lands on the clipboard. She lets it.
{goto: b_join}

:: b_join
PELL [neutral]: What they see from the boat. The water, the lamps, the shutters, the faces on the quay. Mend one and they look twice. Mend three and the boat gets heavier.
PELL [neutral]: I'll be here for the next one. Come if you've work to put off.
N: Bastien is on the bollard. He watches the water where the boat was, then yawns.
[[if flag.asked_pell_how_bad]]
{memory: pell, "The Fellow asked how bad it was, on the empty slip. I counted lamps at them. They let me.", importance: 8}
[[else]]
{memory: pell, "The boat came in empty and the Fellow stood on the slip with me. I said I was frightened. It's out of me now, at least.", importance: 8}
[[end]]
{memory: moss, "Empty boat. Mail, herring, nothing with legs. Pell on the slip again.", importance: 3}
{set: s05_b_seen}
```
