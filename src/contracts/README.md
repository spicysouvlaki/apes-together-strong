# Contracts

The files in this folder are the interfaces every workstream builds against.
Treat them as frozen: change them only in a dedicated PR titled `contracts: …`,
and update every consumer in that same PR.

| File | What it defines | Consumers |
| --- | --- | --- |
| `hex.ts` | Axial hex coordinates and helpers | Everyone |
| `content-schemas.ts` | Zod schemas for every `content/*.json` file, including the modifier language | Sim, emergence, AI, UI, content |
| `sim-api.ts` | `GameState`, `Command`, `SimEvent`, worker protocol | Sim, emergence, AI, UI, renderer, platform |

Rules:

- Everything in `GameState` is plain JSON (no classes, Maps, Dates or functions), so it can be saved,
  diffed, posted to the worker and replayed.
- The UI and renderer never mutate state; they send `Command`s and draw `GameState`.
- Content ids are strings in `snake_case`, unique within their file.
