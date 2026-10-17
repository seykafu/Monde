<!--
Block 4 for dialogue (GDD §9.10.1, §9.17): the user message, rebuilt every turn and never cached.
What the Fellow just said comes first, with one line saying what to do with it (FOCUS_DIRECTIVES in
promptBuilder.ts); the context follows, compact. Topic cards appear only when there's nothing to answer
(the opener, a lull), so they can't pull a reply off the Fellow's question.
Every slot value is escaped so text cannot open or close a tag. A slot alone on its line is dropped when
empty (shared_past, topics, hints, whim). Slots: player_said, focus, day, weekday, season, time, place,
weather, emotion, intensity, energy, stress, doing, player_name, player_pronouns, regard_tier, player_background,
address, shared_past, memories, topics, already_discussed, town_now, open_favors, revealable_secrets, hints, whim,
resident_name, reply_note.
`player_pronouns` is the Fellowship form's pronouns with the words never to use (naming.ts pronounNote). `address`
is what this resident calls the Fellow at this Regard and met state (naming.ts, GDD §12.1). `town_now` lists only
what story flags have changed since the first day of spring, as background (townState.ts), and is dropped when
nothing has: the first day itself is the World Bible's. Background sits below the Fellow's words and the memories
on purpose.
-->
<player_said> {{player_said}} </player_said>
{{focus}}
<scene> Day {{day}} ({{weekday}}, {{season}}), {{time}}, {{place}}. Weather: {{weather}}. You: {{emotion}} ({{intensity}}), energy {{energy}}, stress {{stress}}. Doing: {{doing}}. </scene>
<player> Name: {{player_name}} ({{player_pronouns}}). Your regard: {{regard_tier}}. Background: {{player_background}}. {{address}} </player>
{{shared_past}}
<memories>
{{memories}}
</memories>
{{topics}}
<already_discussed> {{already_discussed}} </already_discussed>
{{town_now}}
<open_favors>
{{open_favors}}
</open_favors>
<revealable_secrets>
{{revealable_secrets}}
</revealable_secrets>
{{hints}}
{{whim}}
Reply as {{resident_name}}{{reply_note}}.
