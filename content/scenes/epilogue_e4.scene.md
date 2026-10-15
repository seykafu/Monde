#### EP4 · Dawn Report, Defeat
```yaml
id: epilogue_e4
day: 100
time: "06:00-06:30"
place: old_quarter.lamplighter_cottage
trigger: "scene_call:e4_defeat"
backdrop: bg_dawn_report_front_page
music: dawn_report_soft
cast: []
sets: [game_complete, ending_e4_seen]
```
```script
{fade}
N: THE LANTERN · DAWN REPORT · Day 1 of Thaw, Year Two · Rain, then light
N: MAYOR VANE'S FIRST YEAR: THE SHUTTERS STAY UP
[[if flag.charter_found]]
N: 1. The Wharf and the Commons remain a commons under the founder's Charter. Mayor Vane has announced the Port Vane terminal will be built at Junction Point, up the coast.
[[else]]
N: 1. Port Vane's first phase opens on the south quay. The Commons, the Glasshouse and the Old Elm are untouched, for now. Residents are watching.
[[end]]
N: 2. The Lantern has added a second desk. Sable Moreau reports that the weekly column "Questions from the Row" has taken a clear lead in the readers' poll. It is not signed. Everyone knows.
N: 3. Census {census}. The Mayor keeps the harbormaster's house and has been seen feeding the gulls. Edwina Pell has retired from the clerk's chair. The stamp, according to sources, has not.
{set: ending_e4_seen}
{set: game_complete}
```
