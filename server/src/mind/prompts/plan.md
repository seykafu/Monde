<!--
Block 4 for tomorrow's plan (GDD §9.7, §9.17), run at effort "low". Your beliefs and people are in block 3,
so they are not repeated here. Slots: resident_name, day, weekday, season, routine_kind, routine, needs,
forecast, town_now (dropped when empty), events, intentions, places, verbs, fellow (dropped when empty).
-->
<plan_request>
Plan tomorrow for {{resident_name}}: Day {{day}} ({{weekday}}, {{season}}).
Your usual {{routine_kind}} routine:
{{routine}}
Needs now (0 empty, 100 full): {{needs}}.
Forecast: {{forecast}}.
{{town_now}}
Town events tomorrow:
{{events}}
Open intentions:
{{intentions}}
Places open tomorrow (use only these ids):
{{places}}
Use only these verbs: {{verbs}}.
</plan_request>
Times are HH:MM. Tomorrow runs from 06:00 to 02:00: write times after midnight as 00:00-02:00, and end the last block by 02:00 (sleep doesn't need to run to the morning).
Keep most of the routine. List only the blocks you change (at most 2), each with its start, end and the reason in its note: the rest of your routine stays as it is. If you keep your routine as it is, list no blocks. Add at most 1 whim, a spontaneous detour with a reason, or null.
Write 3 short barks you might say aloud tomorrow, in your own voice.
Say if you want to find the Fellow tomorrow, and why (seek_player), or null. List the intentions you carry into tomorrow.
{{fellow}}
