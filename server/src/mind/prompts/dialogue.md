<!--
Block 4 for dialogue (GDD §9.10.1, §9.17): the user message, rebuilt every turn and never cached.
Every slot value is escaped so text cannot open or close a tag. A slot alone on its line is dropped when
empty (hints, shared_past, whim). Slots: day, weekday, season, time, place, weather, emotion, intensity,
energy, stress, doing, player_name, player_pronouns, regard_tier, player_background, shared_past, memories,
topics, already_discussed, open_favors, revealable_secrets, hints, conversation, player_said, whim,
resident_name.
-->
<scene> Day {{day}} ({{weekday}}, {{season}}), {{time}}, {{place}}. Weather: {{weather}}. </scene>
<you_now> Mood: {{emotion}} ({{intensity}}); energy {{energy}}; stress {{stress}}. Doing: {{doing}}. </you_now>
<player> Name: {{player_name}} ({{player_pronouns}}). Your regard: {{regard_tier}}. Background: {{player_background}}. </player>
{{shared_past}}
<memories>
{{memories}}
</memories>
<topics_to_choose_from>
{{topics}}
</topics_to_choose_from>
<already_discussed> {{already_discussed}} </already_discussed>
<open_favors>
{{open_favors}}
</open_favors>
<revealable_secrets>
{{revealable_secrets}}
</revealable_secrets>
{{hints}}
<conversation>
{{conversation}}
</conversation>
<player_said> {{player_said}} </player_said>
{{whim}}
Reply as {{resident_name}}.
