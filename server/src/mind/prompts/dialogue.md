<!--
Block 4 for dialogue (GDD §9.10.1, §9.17): the user message, rebuilt every turn and never cached.
What the Fellow just said comes first, with one line saying what to do with it (FOCUS_DIRECTIVES in
promptBuilder.ts); the context follows, compact. Topic cards appear only when there's nothing to answer
(the opener, a lull), so they can't pull a reply off the Fellow's question.
Every slot value is escaped so text cannot open or close a tag. A slot alone on its line is dropped when
empty (shared_past, topics, hints, whim). Slots: player_said, focus, day, weekday, season, time, place,
weather, emotion, intensity, energy, stress, doing, player_name, player_pronouns, regard_tier,
player_background, shared_past, memories, topics, already_discussed, open_favors, revealable_secrets, hints,
whim, resident_name, reply_note.
-->
<player_said> {{player_said}} </player_said>
{{focus}}
<scene> Day {{day}} ({{weekday}}, {{season}}), {{time}}, {{place}}. Weather: {{weather}}. You: {{emotion}} ({{intensity}}), energy {{energy}}, stress {{stress}}. Doing: {{doing}}. </scene>
<player> Name: {{player_name}} ({{player_pronouns}}). Your regard: {{regard_tier}}. Background: {{player_background}}. </player>
{{shared_past}}
<memories>
{{memories}}
</memories>
{{topics}}
<already_discussed> {{already_discussed}} </already_discussed>
<open_favors>
{{open_favors}}
</open_favors>
<revealable_secrets>
{{revealable_secrets}}
</revealable_secrets>
{{hints}}
{{whim}}
Reply as {{resident_name}}{{reply_note}}.
