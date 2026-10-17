<!--
Block 4 for tomorrow's plan (GDD §9.7, §9.17), run at effort "low". Your beliefs and people are in block 3,
so they are not repeated here. Slots: resident_name, day, weekday, season, routine_kind, routine, needs,
forecast, town_now, events, intentions, places, verbs, fellow (dropped when empty).
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
Keep most of the routine. Change at most 2 blocks, with the reason in the block's note. Add at most 1 whim, a spontaneous detour with a reason, or null.
Write 3 short barks you might say aloud tomorrow, in your own voice.
Say if you want to find the Fellow tomorrow, and why (seek_player), or null. List the intentions you carry into tomorrow.
{{fellow}}
