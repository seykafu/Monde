<!--
Block 4 for dialogue (GDD §9.10.1, §9.17): the user message, rebuilt every turn and never cached.
What the Fellow just said comes first, with one line saying what to do with it (FOCUS_DIRECTIVES in
promptBuilder.ts); the context follows, compact. Topic cards appear only when there's nothing to answer
(the opener, a lull), so they can't pull a reply off the Fellow's question.
Every slot value is escaped so text cannot open or close a tag. A slot alone on its line is dropped when
empty (shared_past, topics, hints, whim). Slots: player_said, focus, day, weekday, season, time, place,
weather, emotion, intensity, energy, stress, doing, town_now, player_name, player_pronouns, pronoun_rule, regard_tier,
player_background, address, shared_past, memories, topics, already_discussed, open_favors, revealable_secrets, hints,
whim, resident_name, reply_note.
`town_now` is how the town stands today, from the story flags (townState.ts): the clocktower always, and every
World Bible fact a flag has overturned. `pronoun_rule` names the right and wrong words for the Fellow, from the
Fellowship form (naming.ts). `address` is what this resident calls the Fellow at this Regard and met state
(naming.ts, GDD §12.1).
-->
<player_said> {{player_said}} </player_said>
{{focus}}
<scene> Day {{day}} ({{weekday}}, {{season}}), {{time}}, {{place}}. Weather: {{weather}}. You: {{emotion}} ({{intensity}}), energy {{energy}}, stress {{stress}}. Doing: {{doing}}. </scene>
{{town_now}}
<player> Name: {{player_name}} ({{player_pronouns}}). {{pronoun_rule}} Your regard: {{regard_tier}}. Background: {{player_background}}. {{address}} </player>
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
