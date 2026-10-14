<!--
Block 4 for an NPC-to-NPC exchange (GDD §9.11, §9.17). Two residents, so the system prompt is the World Bible
alone (block 1, cached); each resident appears here as a short sketch with their live canon facts.
Slots: mode, a_name, b_name, place, time, day, weekday, a_sketch, b_sketch, a_to_b, b_to_a, a_news, b_news.
-->
<gossip mode="{{mode}}">
{{a_name}} (a) and {{b_name}} (b) meet at {{place}}, {{time}} on Day {{day}} ({{weekday}}).
<a>
{{a_sketch}}
</a>
<b>
{{b_sketch}}
</b>
How a sees b: {{a_to_b}}
How b sees a: {{b_to_a}}
What a knows that b might not:
{{a_news}}
What b knows that a might not:
{{b_news}}
</gossip>
This time you write both residents, each in their own voice. In live mode, write a short exchange of 2 to 6 lines, speaker a or b. In summary mode, set lines to null and give only the outcome. news_passed lists the ids of news that changed hands.
