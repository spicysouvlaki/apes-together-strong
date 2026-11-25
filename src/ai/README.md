# AI

Workstream 3. Rival decision-making, producing `Command`s through the same API as the player.
Runs inside the sim worker. Same rules, same information as a human (no peeking at hidden state
beyond what difficulty settings allow — in particular never `PlayerState.affinity`).
Budget: all AIs under 3 s per turn on iPhone 13 (Node, small map: ~10 ms per AI turn).

`runAiTurn(state, player, content, sim)` (index.ts) plays one turn and always ends it (or, in the
transition phase, sends `finishTransition`). It never throws: each step is wrapped, rejected
commands are skipped, and `MAX_COMMANDS_PER_TURN` caps the work. Deterministic: its only
"randomness" is a hash of seed, turn and ids (util.ts); it never touches `state.rng`.

| File | Layer (GDD §9) |
| --- | --- |
| persona.ts | leader `aiAgendaBias` + 2 seeded agendas → utility weights; `modifierScore` |
| decisions.ts | strategic focus track (re-planned per 10 turns), offers, crisis, government, research |
| economy.ts | empire plan, per-city production, gold (buy, town → city), envoys, settlement sites |
| units.ts | settlers, scouts, merchants, garrisons, threat response, wartime gather-and-attack |
| figures.ts | seat, field generals, activate when useful, consume leftovers near age end |
| war.ts | declare on weaker neighbours (warmonger/opportunist, turn ≥ 25), make peace |
| transition.ts | buy traditions/hybrids, name the civ, pick a government, finish |
| ctx.ts / world.ts / util.ts / sites.ts | command door, public world views, distance fields, site scores |

Tooling: `npm run autoplay` plays AI-only games; `aiDiagnostics` (ctx.ts) counts step errors and
rejected commands for scripts and tests. Tests: `tests/ai.test.ts`.
