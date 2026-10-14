# Monde: agent instructions

Monde is a cozy open-world life-sim RPG (Phaser 3 + TypeScript) whose residents are live Claude Haiku 5.5
agents served from a Fly.io backend.

## Sources of truth
- **Design:** `docs/MONDE_GDD.md`. If code and GDD disagree, the code is wrong unless a newer decision says
  otherwise (then update the GDD in the same change).
- **What to build now:** `docs/MVP_PLAN.md` ("Spring in Monde", Days 1–25). Task ids (F-01, M-05…) come from it.
- **Reference implementation:** Ravage (github.com/seykafu/Ravage). Render, combat, UI and audio code is ported
  from it. Keep its conventions unless the GDD says otherwise.

## Layout
```
client/   Vite + Phaser 3 game        (src/render, src/combat ported from Ravage; src/world, sim, town, mind, story new)
server/   monde-mind (Fastify + TS)   deployed to Fly.io
shared/   zod schemas + types used by client and server (persona, plan, dialogue, memory…)
content/  YAML + script markdown      (residents, places, scenes, line library)
tools/    verify_puzzles.py and content linters
docs/     GDD and MVP plan
```

## Conventions
- TypeScript strict. Node 22. npm workspaces (`@monde/client`, `@monde/server`, `@monde/shared`).
- **Pure logic stays pure:** anything in `client/src/{combat,town,sim/rules,render math}` and `shared/` has no
  Phaser or DOM imports, so it runs under vitest in Node. Phaser code lives in scenes and adapters.
- Tests live in `__tests__/` next to the code (`*.test.ts`), run with `npm test` (vitest workspace).
- Don't add dependencies unless the task says so. If one is needed, say which and why in your summary.
- Runtime asset URLs resolve against `import.meta.env.BASE_URL` (the build is served from itch.io's iframe
  CDN path), never a leading `/`.
- Game rules and numbers come from the GDD sections cited in the task. Don't invent numbers; if one is
  missing, add a `// GDD-GAP:` comment and mention it in your summary.

## Claude API rules (server)
- Model `claude-haiku-5-5` via `@anthropic-ai/sdk`. **No** `temperature` / `top_p` / `top_k`, **no** assistant
  prefill (both are 400s on Haiku 5.5). Structured output via `output_config.format`. Dialogue uses
  `thinking: {type: "disabled"}`; plans and reflections use `output_config: {effort: "low"}`.
- Always check `stop_reason` before reading content (`refusal` has no server-side fallback on Haiku).
- Prompt blocks 1–3 (World Bible, persona, beliefs) must be byte-stable for prompt caching (GDD §9.10.1).
- The API key lives only in Fly secrets / local `.env`; never in the client.

## Commands
```
npm run dev            # client on :5173
npm run dev:server     # server on :8080
npm test               # vitest, all workspaces
npm run typecheck
npm run lint
npm run verify:puzzles # GDD puzzle verification
npm run ci             # everything CI runs
```

## Working agreement for coding agents
- Make the change, run `npm run typecheck` and `npm test`, and report what you changed and what you verified.
- **Do not commit or push.** The orchestrator reviews and commits.
- Stay inside the files and directories the task names.
