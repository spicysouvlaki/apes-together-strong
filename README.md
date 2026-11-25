# Apes Together Strong

A turn-based historical 4X where you never pick a civilization. You build one out of the
famous people your play attracts, then refine their traditions, across four ages, into a
culture nobody else will have.

Runs in the browser, installs to an iPhone home screen, and plays a full ~4-hour game offline.

## Status

Pre-production skeleton. What exists:

- `src/contracts/`: the frozen interfaces every workstream builds against.
- `content/`: seed data for the first playable (8 cultures, starter figures, traditions, hybrids, signals).
- Build config (Vite, TypeScript, Vitest, PWA) with dependencies installed.
- Design docs in `docs/`.

Everything else (sim, emergence engine, AI, renderer, UI, storage) is still to be built.
See [docs/WORKSTREAMS.md](docs/WORKSTREAMS.md).

## Docs

| Doc | What it's for |
| --- | --- |
| [docs/GDD.md](docs/GDD.md) | Game design spec, condensed from the living design doc |
| [docs/WORKSTREAMS.md](docs/WORKSTREAMS.md) | Who owns what, first tasks, done criteria, milestone order |
| [docs/CONTENT_GUIDELINES.md](docs/CONTENT_GUIDELINES.md) | Rules for figures, traditions and sensitive history |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decisions made and questions still open |
| [CLAUDE.md](CLAUDE.md) | Instructions for coding agents working in this repo |

## Commands

```bash
npm install
npm run dev               # local dev server on :5173
npm run check             # validate content + typecheck + tests
npm run build             # production build (offline PWA)
npm run autoplay          # headless AI-only games for balance (once implemented)
```

## Stack

TypeScript (strict) · Vite · three.js · Preact + signals · Zod · idb · vite-plugin-pwa · Vitest.
