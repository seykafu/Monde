<!--
The AI hint guard block (GDD §14.2), inserted into dialogue.md only when the topic is a riddle. It carries the
inscription and only the hint levels the player has unlocked. The answer is never passed to the builder's
output. Slots: allowed, riddle_id, inscription, hints.
-->
<hints allowed="{{allowed}}">
The Fellow is asking about the founder's riddle {{riddle_id}}. The plaque reads:
{{inscription}}
Hints the Fellow has earned, as far as you may go:
{{hints}}
Give these in your own words, one at a time. Never guess past them and never name an answer. If pushed, you're stumped.
</hints>
