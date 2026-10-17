# Monde playtest: privacy notice

*Draft for Kasey to review. Nothing here is published, and none of it has been through legal review.
Checked against the repo on 2026-10-16. Items in square brackets are for you to fill in or decide:
`[CAPITALS]` are blanks, `[KASEY: …]` are decisions or legal checks.*

**Effective:** [EFFECTIVE DATE] · **Who runs the playtest:** [OPERATOR LEGAL NAME] ("we") · **Contact:** [CONTACT EMAIL]

This covers the closed playtest of **Spring in Monde** (Days 1 to 25), played on the Mac app or in a web
browser on itch.io with an invite code.

`[KASEY: the game's default server is the staging app, monde-mind-staging.fly.dev (client/src/mind/api.ts,
DEFAULT_MIND_URL). This notice describes the Fly.io + Supabase setup. Before you publish it, check that the
build players get points at the server and database you mean, and that the processors below are still the
full list.]`

## The short version

- Monde has no accounts, no ads and no third-party analytics in the game itself.
  `[KASEY: true of the code today (the client's only network calls go to Monde's server). Re-check if you add anything.]`
- **Without an invite code, or with Offline turned on, nothing you say to residents leaves your device.**
  Residents speak pre-written lines.
- **With an invite code**, the lines you pick or type, and your character's name and answers, are sent to
  Monde's server and on to Anthropic so residents can reply. The server keeps a record of your world and
  its conversations so residents can remember you.
- Sharing play events and answering surveys is **optional and off by default**.
- Please don't type your real name, address, school, phone number, email or anything else personal into a
  conversation or a survey note.
- Conversations have a **Report line** button that hides a resident's line and sends it for review.

## What stays on your device

| What | Where | Why |
|---|---|---|
| Save slots | Mac app: files in the Monde folder (`~/Library/Application Support/Monde/saves/`). Web: your browser's storage for the game page (IndexedDB). | So you can continue. |
| Settings | Local storage | Text size, typewriter speed, colourblind emotes, reduced motion, Choices only, Offline. |
| Your character | Local storage | The name, pronouns, background, reason for coming and something you love, plus how your character looks. |
| Invite code, random device ID, world ID and world token | Local storage | To join your world on the server. The token is the key that lets your game talk to your world and nobody else's. |
| Quiet Mode memory | Local storage | Which pre-written lines a resident said recently, so they don't repeat. |
| Sharing choice, installation ID, unsent events | Local storage | See "Optional play-event sharing". |

To remove all of it: on the web, clear the site data for the game's page. On the Mac app, delete the Monde
folder (removing the app does not remove it). Clearing it also resets your device ID and installation ID.

## What is sent when you play with live residents

This only happens if you have an invite code and Offline is off.

**When you join.** Your invite code and a random device ID go to Monde's server, which makes a "world" for
you. The server stores the invite code next to the device ID.

**Your character.** Name (up to 16 characters), pronouns, background, why you came, and something you love are
stored on the server and are given to the AI as part of what residents know about you. How your character
looks stays on your device.

**Conversations.** When you talk to a resident, the line you picked or typed (typed lines are limited to
140 characters) goes to Monde's server. The server adds the conversation so far, the resident's card, their
relevant memories and some facts about the town, and sends all of it to Anthropic, whose Claude Haiku 5.5 model
writes the reply. Typed lines are checked first, by simple rules on our server and by a short request to the
same model.

**Game events.** The server is told about things that happen in the town so residents can know about them:
gifts and shared meals, community work, scuffles, projects opening, favors accepted or finished, story
moments, and your progress through the story. Events from a stretch of offline play are sent the next time
you connect. These carry game facts, not text you typed.

**Saves.** When you save while connected, the server also keeps a snapshot copy of your world's data so that
loading can restore it. It keeps a limited number of recent snapshots per world.

**What the server stores** (in a Postgres database hosted by Supabase) for each world:

- your invite code and device ID, and your character's name and answers;
- every exchange: what you picked or typed, what the resident said, and the working text the server built to
  get that reply;
- the summaries, memories and relationships that come out of conversations, and each resident's daily plans,
  letters and the morning paper for your world;
- the game events above, story flags and save snapshots;
- a log of each AI call (what kind, how many tokens, cost, timing, result), which does not hold the text
  itself, and the daily AI spend for your world;
- anything you reported (see below).

**How long we keep it.** Worlds, conversations and the AI call log: [RETENTION PERIOD]. Server request logs:
[RETENTION PERIOD].

**Also seen by the host.** Fly.io, which runs the server, sees your IP address when your game connects, and
request logs can include it.

`[KASEY: IP handling. The server logs requests at info level (Fastify, server/src/app.ts) and Fly.io sees
connections; the README says "HTTP infrastructure may separately log IP addresses". Say how long those logs
are kept once you know. Also list who can read the database and the admin page; today the admin page needs the
ADMIN_TOKEN secret.]`

## Where it goes

| Who | What they do | What they handle |
|---|---|---|
| **Anthropic** | Provides the Claude Haiku 5.5 model that writes residents' words, plans, letters and the morning paper. | The text of each request: the resident's card, memories and town facts, your character's name and answers, the conversation so far, and what you picked or typed. Governed by Anthropic's own terms and privacy policy: [KASEY: link both, and confirm what retention and training terms apply to your organisation's API use. Don't state them here until you have checked.] |
| **Fly.io** | Runs Monde's server (region iad, US East). | All traffic to the server, including IP addresses and request logs. |
| **Supabase** | Hosts the Postgres database (US East). | Everything the server stores, listed above. |
| **itch.io** | Hosts the web build and the page. | Whatever it collects when you visit or download. That is between you and itch.io, under its policy. Monde doesn't ask for your itch.io login. |

OpenAI and Suno were used while making the game's art and music. No player data goes to them. The game does
not talk to Anthropic or the database directly; only Monde's server does.

We do not sell your data. `[KASEY: true of the code; it's your promise to make.]`

## Optional play-event sharing and surveys

**Off by default.** The first time you start a New Game or open Settings on the title screen, Monde asks once.
"Keep sharing off" is the first choice, and closing the question also means off. You can change it any time in
Settings, under "Anonymous gameplay sharing". Sharing is separate from Offline: if you turn sharing on, events
are sent whenever the game can reach the server, even in Quiet Mode.

`[KASEY: two wording fixes in the game itself. (1) The in-game prompt and Settings label say "anonymous". The
telemetry README says the installation ID is persistent and pseudonymous, and that you must not promise
anonymity, so "Anonymous gameplay sharing" over-promises. (2) Offline does not stop sharing (the queue in
client/src/telemetry/runtime.ts doesn't check Offline). I haven't touched the code; this notice describes what it does.]`

**What is sent.** Each event carries the in-game day and a timestamp, and is one of:

- a session started, and which day you have reached;
- that you started a conversation, and with which resident (not what was said);
- that you solved a Mark (a riddle plaque), which one, and how many hints you used;
- that you opened, solved or left a puzzle, and which one;
- the town's Appeal score, once at dawn;
- the result of the Spring Straw Poll (the shares, the number of ballots and the winner);
- your survey answers.

**Surveys.** Two short cards, shown once each and only if sharing is on: around Day 7 (three statements about
pace, wanting to meet residents, and knowing what to do next, answered on a five-point scale) and at the end of
Spring (which residents you would talk to again, whether you could see the town change, and an optional note).
You can skip any question, and a skipped card isn't shown again.

**The optional note.** The note at the end of Spring is sent exactly as you type it (up to 1,000 characters). It
can contain personal information if you write it in, so please leave out names and contact details.

**What this feature does not collect.** No player name, invite code, conversation text or other typed input.
The only typed text it sends is the optional note.

**How you are identified.** A random installation ID is made on your device and kept there. It is
**pseudonymous**: it doesn't name you, but the same ID comes back every time and is not erased when you turn
sharing off. When you are connected to a world, a **world ID** is added to each batch. The same world ID
appears in the server's own records of your world, which hold your invite code and your conversations, so
anyone with access to both can connect your events to them. Those older server records are not controlled by
this setting. Treat this as pseudonymous, not anonymous.

**How it is sent.** Events wait in a queue on your device (at most 200), go in batches of up to 25 every
30 seconds and at dawn, and a batch is dropped after three failed tries. Turning sharing off clears the unsent
queue and cancels any send in progress. **Data we have already received is not recalled or deleted
automatically.**

**Who sees it.** The developer, as exported spreadsheets for analysing the playtest. We treat it as restricted
playtest data and don't publish it as raw records. `[KASEY: confirm that is your practice. The telemetry README
says exported notes and linked world IDs "must be treated as restricted playtest data".]`

**How long we keep it.** [RETENTION PERIOD] for play events and survey answers.

## Report line

In a conversation, the ⋯ menu has **Report line**. It hides that line at once and sends a copy to a review
queue: the resident's line, what you said just before it, which resident, and which conversation. Only the
developer can read the queue. A world can send a limited number of different reports a day. Reports are kept
for [RETENTION PERIOD].

`[KASEY: the server has no automatic deletion for reports, conversations, AI logs or telemetry (the only pruning
in server/src is old save snapshots), and BUDGET_SAFETY.md says no report retention is specified. Don't write a
retention period you can't keep; either set a manual purge routine or choose a period you will honour.]`

## Playing without sending anything

1. **Don't enter an invite code**, or turn **Offline** on in Settings. Residents then speak pre-written lines
   and the game doesn't contact Monde's server about your play.
2. Leave play-event sharing **off** (the default).

Everything else (the story, riddles, puzzles, scuffles, the town's recovery) works the same. If you add an
invite code later, what you saved on your device (your character and any offline events) is sent then. If you
want live residents but don't want to type, turn on **Choices only** in Settings: you pick replies and send no
typed lines.

## Children

Monde is built to an **E10+** content standard: cartoon scuffles, no profanity, no romance with the player.
That is about what is in the game. It is not an age check, and Monde has no accounts and doesn't ask how old
you are.

Because live residents are an online service that handles what you type, we ask that **younger players use
Monde with a parent or guardian's agreement**, and that anyone under 13 [KASEY: or the age that applies to your
audience] uses Offline or Choices only and doesn't type personal information. The game tries to stop some
obvious personal details in typed lines, such as email addresses and phone numbers, but it can't catch
everything.

A parent or guardian who wants a child's data looked at or removed can write to [CONTACT EMAIL].

`[KASEY: legal review needed. "Rated E10+" is a design target in GDD §1.4, not an official rating, and I have
not claimed it is. Because the game targets ages 10 and up, check the rules for children's data in every place
you will invite players, for example the US children's privacy law (COPPA, which turns on whether a service is
directed to children or knows a user is a child, and the age threshold is under 13), EU and UK rules on
children's consent and data, and age-appropriate design codes. Decide:
(1) whether the playtest is adults-only or all ages (the invite process could enforce adults-only);
(2) whether you need parental consent before collecting a name, typed lines or telemetry;
(3) what Anthropic's usage policy requires for a product that children may use;
(4) what the stores require for a game rated for children.
The wording above is a cautious placeholder, not a compliance position.]`

## Your choices and deleting your data

- You can stop sharing play events at any time (above), and clear everything on your device (above).
- To ask us to look at or delete what the server holds about you, write to [CONTACT EMAIL]. How we handle
  those requests: [DELETION REQUEST PROCEDURE].
- To help us find your data, include your **invite code** when you write. The server stores it with your device ID.

`[KASEY: decide the identifier, and check it works. (1) If one invite code is given to several people, or a
test build bakes one in (builds can carry an owner's code via VITE_MIND_INVITE; don't ship those to
playtesters), a code won't single out one person. (2) Deleting a world row removes its conversations,
memories and snapshots (they cascade), but the device row (device ID and invite code) stays, and the AI call
log and telemetry rows keep their data with the world link set to null (server/src/db/schema.ts); survey
answers follow their telemetry events. Decide whether a deletion request also clears those, and write the
procedure accordingly.
(3) Add the rights and request sections your jurisdictions require (access, deletion, objection, complaint)
after legal review.]`

## Security

The server redirects plain HTTP to HTTPS, each world has its own secret token, and the review and cost pages
are behind an admin secret. No system is perfectly secure, and this is a small playtest. Don't type anything
into Monde that you wouldn't want a developer to be able to read.

## Where data is processed

The server and database are in the United States (Fly.io and Supabase, US East), and Anthropic processes
requests under its own terms. `[KASEY: if you invite players outside the US, add the transfer language your
lawyer recommends.]`

## Changes

Last updated [EFFECTIVE DATE]. `[KASEY: decide how you'll tell players if this changes. Don't promise a method you won't use.]`

## Questions

[CONTACT EMAIL]
