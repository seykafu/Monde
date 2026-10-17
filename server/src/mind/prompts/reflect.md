<!--
Block 4 for the nightly reflection (GDD §9.6, §9.7, §9.17), run at effort "low" or through the Batch API.
Yesterday's beliefs, relationships and stances are in block 3. Slots: day, resident_name, memories, emotion,
valence, energy, stress, regard, regard_tier, fellow (dropped when empty), dream, dream_stage, dream_notes, town_now,
town, favor_templates.
-->
<reflect_request>
It is night on Day {{day}}. Reflect as {{resident_name}} on today.
Today's memories:
{{memories}}
Your mood now: {{emotion}}; valence {{valence}}, energy {{energy}}, stress {{stress}}.
Your regard for the Fellow: {{regard}} ({{regard_tier}}).
{{fellow}}
Your dream: {{dream}}
The step you're on: {{dream_stage}}. Notes: {{dream_notes}}
{{town_now}}
Town facts (for your judgment only; nobody talks in these terms):
{{town}}
</reflect_request>
Yesterday's beliefs, the people in your life and your stances are above. Update how you feel and what you believe. Be honest, specific and a little contradictory, like a person. Rewrite the full belief list as it stands tonight, 12 sentences at most.
Propose at most 1 favor (templates: {{favor_templates}}) and at most 1 letter. The diary is one sentence about today, in your own voice.
