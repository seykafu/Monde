#### EP3 · Dawn Report, Squeaker
```yaml
id: epilogue_e3
day: 100
time: "06:00-06:30"
place: old_quarter.lamplighter_cottage
trigger: "scene_call:e3_squeaker"
backdrop: bg_dawn_report_front_page
music: dawn_report
cast: []
sets: [game_complete, ending_e3_seen]
```
```script
{fade}
N: THE LANTERN · DAWN REPORT · Day 1 of Thaw, Year Two · Fog, clearing by nine
N: NARROW MAYOR, WIDE TABLE: COUNCIL OPENS TO ALL RESIDENTS
N: 1. The recount slate, in Tib Okafor's hand, has been mounted in the library. Visitors are asked not to rub out the numbers.
[[if flag.recount_public]]
N: 2. Mr. Silas Vane was nominated to chair the Harbor Committee at the Mayor's request. He accepted "with reservations in writing."
[[else]]
N: 2. Mr. Silas Vane has attended every Council session from the second row. He has not yet been quiet.
[[end]]
[[if flag.station_open]]
N: 3. Hollis Brandt's first year at the signal box: 318 trains, 291 on time. He has appealed the other 27.
[[else]]
N: 3. The Monde line remains unrestored. Hollis Brandt sits on the lookout bench each morning and records the weather.
[[end]]
{set: ending_e3_seen}
{set: game_complete}
```
