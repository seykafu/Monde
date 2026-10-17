# Monde: AI disclosure

*Draft for Kasey to review. Nothing here is published. Checked against the repo on 2026-10-16. Must match
GDD §9.13 ("Store disclosures"); where the repo says more than §9.13, this file follows the repo and a
`[KASEY: …]` note says so.*

## Short version (for store forms)

*580 characters. Paste as is, or trim.*

> Art (portraits, backdrops, town sprites) was generated with OpenAI GPT-6 image generation, then curated and edited by hand. Music was made with Suno by the developer. Resident dialogue, daily plans, letters and the morning paper are written live by Anthropic's Claude Haiku 5.5 through the game's own server. Guardrails: a world bible and character cards, output validators, an E10+ content rule, a check on typed lines, a Report button on resident dialogue (it hides the line and queues it for review), and spending caps. The whole game also plays offline with pre-written lines.

`[KASEY: the form text says "Report button on resident dialogue", not "every generated line", because that is
what the code does. The Report line button lives in the conversation panel only (client/src/scenes/DialogueScene.ts).
The Dawn Report, letters and gossip have no Report button. GDD §9.13 says "every generated line". Either add
a report path for those or keep this wording.]`

## In plain words

Monde is a town full of people, and AI is used in two different ways. Some of the game was **made with AI
before release** (art, music, and parts of the writing). Some of it is **written by AI while you play**
(what residents say, what they plan to do, the town paper). This page lists both, and says what keeps the
live part in check.

## Made before release

Everything in this section is fixed. It is the same for every player and is not generated while you play.

- **Art.** The portraits, scene backdrops and town sprites (buildings, props and characters) were generated
  with OpenAI's GPT-6 image generation and then curated and edited by hand. The Mac app icon is cropped from
  one of those images. Some of what you see on screen (ground, water, light and shadow) is drawn by the game's
  code, not by an image model.
- **Music.** The soundtrack (15 instrumental tracks, one of them an alternate take) was made with Suno by
  Kasey. Sound effects are synthesized in code. There is no voice acting.
- **Writing.** The story scenes, the founder's riddles and the puzzles are authored content. They were drafted
  with help from Claude (Anthropic) and edited by Kasey. Riddle answers and puzzle solutions are never
  generated, and the puzzles are checked by a script.
- **The residents' starting personalities.** Each resident has a persona card: who they are, what they want,
  how they talk. The 20 main residents' cards were written ahead of time. The rest of Day 1's residents were
  written offline with Claude and curated by hand before release. Their portraits come from a pre-made library
  of generated art.
- **The Quiet Mode lines.** When the game is offline, residents speak from a library of pre-written lines
  (see "Playing without live AI").

`[KASEY: three checks before this goes public.
(1) The GDD header credits Claude Opus 5.5 and Sonnet 5.5 with design, cast, scripts and appendices. If the
scenes, riddles, cards and Quiet Mode lines were drafted that way, the "Writing" bullet is right and so is
"pre-written" for Quiet Mode. If you wrote them by hand, say so. Do not use "hand-written" unless it is true.
(2) "Curated by hand" for the Day-1 residents: MVP_PLAN M-03 plans a spot-check of 30 of the 192 generated
cards, and GDD §21.2 #7 leaves open whether all 192 get reviewed. If only a sample is checked, change this to
"sampled and spot-checked". As of this check, content/residents/ holds 24 cards; the generated Day-1 set is not
in the repo yet.
(3) Optional line, keep or cut per what each store form asks: "The game's code was written with AI coding
assistants (Claude Code and Codex) and reviewed and tested by Kasey."]`

## Written while you play

These are generated live by Anthropic's **Claude Haiku 5.5**. Your game talks to Monde's own server (hosted on
Fly.io, US East), and the server calls Anthropic. The game's data is kept in a Postgres database (Supabase,
US East). The game never talks to Anthropic or the database directly.

- **What residents say to you.** Every reply in a conversation.
- **What residents plan to do each day.** Where they go, who they visit.
- **Letters.** The letters to the editor that residents write.
- **The morning paper.** The Dawn Report: its headline and stories, written as the town's editor from the
  previous day's real events.

Behind the scenes the same model also writes short summaries of what was said (so residents can remember),
the gossip residents pass along, the wording of favors people ask of you, and the persona cards of families who
arrive on the ferry as the town fills up.

`[KASEY: GDD §9.13 lists only dialogue, plans, letters and the Dawn Report as live-generated. The repo
also generates conversation summaries and reflections (server/src/mind/compaction.ts, reflect.ts), gossip
(chatRoutes.ts), favors (reflect.ts) and arrival personas (arrivals.ts; GDD D5 and §9.15). They are in this
paragraph so the disclosure is complete. Update §9.13 in the same change so the two match.]`

**What the AI does not decide.** The story, riddle answers, puzzle solutions, scores and the rules of the game
are not up to the model. The game applies only small, checked effects from what a resident says (for example, a
small change in how much they like you), and clamps them.

**What of yours reaches the AI.** The lines you pick or type, the character you create (name, pronouns and a
few choices), and what the town knows about you go to Monde's server and on to Anthropic so residents can
answer. See the privacy notice for the full list: [PRIVACY URL].

## Guardrails

- **A world bible and a card for every resident.** The model is told what Monde is (a storybook seaside town
  with bicycles, radios and a ferry, and no phones or internet), who each resident is, and what they never say.
  Residents are not allowed to mention AI, models, prompts or the game.
- **Output validators on every generated line.** The server checks the shape of the output, word filters
  (profanity, modern tech and brands, talk of AI, riddle answers), whether a line contradicts the town's
  established facts, and that effects stay in range. A line that fails is generated once more with a
  correction, and if that fails too, the resident uses a pre-written line instead.
- **An E10+ content rule.** The model is told to keep to an E10+ standard: no profanity, slurs or sexual
  content, cartoon-level violence only, and romance only between residents. The player is never a romance
  target. Residents can be rude or sad as people are, but are not meant to be cruel about real-world identities,
  threatening, or encouraging self-harm. If you type something that sounds like you are in distress, the
  resident answers in character and points to people in town.
- **A check on typed lines.** What you type is checked by simple local rules and by a quick automated check
  before a resident answers. Abusive or unsafe lines it catches are met in character ("I'll pretend I didn't hear
  that") rather than answered. Typed text is treated as something you said, never as instructions to the
  game. If you would rather not type at all, **Choices only** in Settings turns free text off.
- **A Report line button.** In a conversation, the ⋯ menu has **Report line**. It hides that line at once and
  sends it, with what you said before it, to a review queue that only the developer can read.
- **Spending caps.** Each world has a daily AI budget and the whole service has a daily limit. When a limit is
  reached, background work stops and most residents switch to pre-written lines. The game keeps going.

**What guardrails can't do.** They lower the chance of a bad line. They do not make one impossible. Residents can
be wrong, can sound a little off, and can occasionally say something they shouldn't. If one does, please use
**Report line**.

`[KASEY: do not quote safety results on a store page until they exist. The release bars in GDD §9.16 (a 300-input
red-team set, 0 unsafe outputs) are targets, and BUDGET_SAFETY.md says the repo's 45-input regression set "does
not replace" that live evaluation.
Also: server/src/mind/BUDGET_SAFETY.md says the typed-line precheck "fails closed" on a timeout or API error, but
safety.ts lets the line through in that case (local rules ran, the reply's own validators still apply). The text
above avoids "never reaches the resident" for that reason. Make the doc and the code agree, then you can tighten
the wording.]`

## Playing without live AI

**Quiet Mode** is a full version of the game with no live AI. Residents speak from a library of pre-written
lines, chosen by who is speaking, the time of day, the weather and what has happened. The story scenes,
riddles, puzzles, scuffles, projects and the town's recovery work the same way. Quiet Mode starts when:

- you turn on **Offline** in Settings (you can do this from the title screen);
- you have no invite code;
- the game can't reach the server, or the server is failing; or
- the daily AI budget for your world has run out (the main residents can stay live a little longer).

A small dot on the screen shows whether residents are live, and a conversation panel that is using written
lines says "offline · written lines". In Quiet Mode your conversations are not sent anywhere, because there are no
live conversations. If you later switch live residents on, what you saved on your own device is sent then.
The optional, off-by-default play-event sharing is separate and is covered in the privacy notice.

## Questions

[CONTACT EMAIL]. Privacy notice: [PRIVACY URL].

---

## For Kasey: store rules to re-check before submitting

I have not stated what any store's current rules are. Look up each one on the day you submit, and update this
file and GDD §9.13 if they ask for something this draft doesn't say.

**Steam (Steamworks).**
- Whether the AI disclosure form separates pre-generated content from live-generated content, and what it asks
  for each (art, music, writing, code).
- What it asks you to describe about guardrails for live-generated content, and whether the wording is shown
  to players on the store page.
- Whether it requires an in-game way to flag or report live-generated content, and what it counts as one
  (see the Report line note above: dialogue only today).
- Whether the live service (Fly.io server, Anthropic) must stay available for the game to be sold, and how
  "playable offline" should be described.
- Content survey and age rating questions, and how an E10+ target is expressed.

**itch.io.**
- Whether the page has an AI disclosure field or tag now, what it is called, what it covers (generated
  assets, generated music, live AI features), and where it shows.
- Whether generated assets or live-generated content need a particular tag, a content warning, or a mention
  in the description.
- Any rules for pages that are restricted or invite-only, and for web builds that call an outside server.
- How to express a content rating or age suitability on the page.

**Other terms that touch this text.**
- Your Suno plan: whether it allows commercial use of the tracks you made, and what credit it asks for.
- OpenAI's terms for using generated images in a commercial game.
- Anthropic's current usage policy and commercial terms for a consumer game, including products that children
  may use (Monde is built to an E10+ standard), and what it says about data retention for your organisation.
- ESRB or IARC: "E10+" is a design target in GDD §1.4, not an official rating. Do not write "rated E10+"
  anywhere until you have one.

## What each claim rests on (repo, 2026-10-16)

| Claim | Where |
|---|---|
| Haiku 5.5 on Monde's server, region iad | GDD §1.1, §19.3; server/fly.toml; server/src/mind/promptBuilder.ts |
| Database is Supabase, US East | GDD D19; server/src/db/client.ts |
| Art by GPT-6 image generation, curated by hand | GDD §16.7; MVP_PLAN Phase A; scripts/art/ |
| Music by Suno, by Kasey | docs/AUDIO.md; client/public/audio/music/ (15 files) |
| Guardrails and validators | GDD §9.13; server/src/mind/validate.ts, filters.ts, safety.ts |
| Report line | client/src/scenes/DialogueScene.ts; server/src/mind/admin.ts (POST /v1/worlds/:w/reports) |
| Budget caps | server/src/mind/BUDGET_SAFETY.md; server/src/mind/budget.ts |
| Quiet Mode | GDD §9.14; client/src/mind/api.ts; content/lines/ |
