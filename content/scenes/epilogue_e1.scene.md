#### EP1 · Dawn Report, Landslide
```yaml
id: epilogue_e1
day: 100
time: "06:00-06:30"
place: old_quarter.lamplighter_cottage
trigger: "scene_call:e1_landslide"
backdrop: bg_dawn_report_front_page
music: dawn_report
cast: []
sets: [game_complete, ending_e1_seen]
```
```script
{fade}
N: THE LANTERN · DAWN REPORT · Day 1 of Thaw, Year Two · Sun, a light wind
N: MONDE AT {census}: HARBOR MARKET OPENS ON THE WHARF
[[if flag.station_open]]
N: 1. Three trains a day now stop at Monde. Stationmaster Hollis Brandt reports that "the odd one is late."
[[else]]
N: 1. Council approves a plan to restore the Monde line. Hollis Brandt asks to be told the moment a rail goes down.
[[end]]
[[if flag.school_saved]]
N: 2. Millbrook School enrolls twenty-six this term, two teachers on the roster. A second register has been purchased.
[[else]]
N: 2. Pupils from Millbrook ride the Friday boat to the mainland school while the Council debates a roof for the old one.
[[end]]
[[if flag.pinion_found]]
N: 3. The clocktower struck noon on Tuesday for the first time in fifteen years. Bertrand Achterberg timed it. "One second late," he said. "She's earned it."
[[else]]
N: 3. Council votes funds to repair the clocktower. Bertrand Achterberg declines to be rushed.
[[end]]
{set: ending_e1_seen}
{set: game_complete}
```
