# CLAUDE.md

Instructions for coding agents building this game. Read this file, then `docs/GDD.md`, then
the section of `docs/WORKSTREAMS.md` for your workstream before writing code.

## What we're building

A historical 4X for iPhone Safari (offline PWA), ~4-hour games. The twist: no fixed
civilizations. Play style and geography draw famous people of real cultures to you; at each
age transition you refine their traditions into a unique, often hybrid, culture.
The emergence engine (signals → affinity → figure offers) is the heart of the game.

## Architecture rules (non-negotiable)

1. **Two threads.** The simulation (`src/sim`, `src/emergence`, `src/ai`) runs in a Web Worker
   (`src/worker`). The UI (`src/ui`) and renderer (`src/render`) run on the main thread and
   only read `GameState` snapshots and send `Command`s. Protocol: `src/contracts/sim-api.ts`.
2. **The sim is pure and deterministic.** No DOM, WebGL, `window`, `Math.random`, `Date.now`,
   `performance.now`, or I/O in sim code. All randomness goes through the seeded RNG whose state
   lives in `GameState.rng`. Same state + same commands must give byte-identical output.
3. **GameState is plain JSON.** No classes, Maps, Sets, Dates or functions inside it.
4. **Content is data.** Never hard-code a culture, figure, tradition, hybrid, terrain or number
   that belongs in `content/*.json`. Every bonus is a `Modifier` evaluated by one engine.
5. **Contracts are frozen.** `src/contracts/*` changes only in a PR titled `contracts: …` that
   updates every consumer. If you need a change, stop and flag it instead of working around it.
6. **Stay in your workstream's folders** (see `docs/WORKSTREAMS.md`). Cross-folder changes go
   through the owning workstream or the contracts.

## Commands

```bash
npm run dev               # Vite dev server, port 5173
npm run typecheck         # tsc --noEmit (TypeScript 7)
npm run test              # Vitest, Node environment, tests/**/*.test.ts
npm run validate:content  # scripts/validate-content.ts (to be written by Content/Platform)
npm run check             # all of the above; must pass before every commit
npm run autoplay          # scripts/autoplay.ts, headless AI-vs-AI games (to be written)
```

## Conventions

- TypeScript strict with `noUncheckedIndexedAccess`; no `any`, no `@ts-ignore` without a comment.
- Content ids are `snake_case`. Code identifiers are camelCase; types PascalCase.
- One concern per file; prefer pure functions taking `(state, …, content)`.
- Sim functions may mutate a state they cloned themselves; never mutate the input state.
- Tests live in `tests/`, named `<area>.test.ts`. Every sim rule gets a unit test. Determinism
  gets a golden-replay test.
- Comments explain *why*. Link the GDD section a rule comes from.
- Mark unfinished work `TODO(<workstream>): …` so it's greppable.

## Performance budgets (iPhone 13, Safari)

60 fps panning (never below 30) · under 150 draw calls · AI turn under 3 s late game ·
save/load under 500 ms, save under 2 MB · install under 150 MB · memory under 600 MB.

## Art for now

Stand-in art only until the game is fun: procedural hex prisms colored from
`content/terrain.json`, primitive shapes for buildings and units, colored-initial cards for
figure portraits. Don't spend effort on final art or audio.

## Content rules

Read `docs/CONTENT_GUIDELINES.md` before adding any figure, tradition, hybrid or event.
Short version: real history, honest about harms; no living people; no founders of living
religions; dictators only as dark events; chattel slavery is never a mechanic; archetypes
(not invented names) for cultures without named individuals.

## Definition of done

`npm run check` passes, new rules have tests, nothing in the sim breaks determinism, and
the change works on a phone-sized viewport (375×812) in the dev server.
