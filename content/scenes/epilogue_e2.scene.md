#### EP2 · Dawn Report, Mandate
```yaml
id: epilogue_e2
day: 100
time: "06:00-06:30"
place: old_quarter.lamplighter_cottage
trigger: "scene_call:e2_mandate"
backdrop: bg_dawn_report_front_page
music: dawn_report
cast: []
sets: [game_complete, ending_e2_seen]
```
```script
{fade}
N: THE LANTERN · DAWN REPORT · Day 1 of Thaw, Year Two · Cloud, then sun
N: MAYOR'S FIRST YEAR: ARGUMENTS, BUNS, AND A ROOF FOR THE SCHOOL
[[if flag.olive_branch]]
N: 1. Council meetings now run to ten at night. A regular in the second row, Mr. Silas Vane, is described by the Mayor as "mostly right."
[[else]]
N: 1. Council meetings run late. The Row has requested a second chair for the public gallery. The Mayor has promised two.
[[end]]
[[if flag.station_open]]
N: 2. The Friday train added a Tuesday. Passengers per week: {station_riders}. Hollis Brandt has requested a larger logbook.
[[else]]
N: 2. A vote to restore the Monde line was carried, nine to four. Hollis Brandt attended every session in his good coat.
[[end]]
[[if flag.school_saved]]
N: 3. Millbrook School added a classroom. Felix Amari asked for a bell and was given three.
[[else]]
N: 3. Millbrook School has closed its doors. The building will be a library annex, if the Council agrees. Felix Amari will teach there.
[[end]]
{set: ending_e2_seen}
{set: game_complete}
```
