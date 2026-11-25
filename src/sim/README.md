# Sim core

Workstream 1 (docs/WORKSTREAMS.md). Rules, modifier engine, turn loop, map generation,
settlements, units, combat, trees, governments, diplomacy, trade, religion, ages and transitions.

Implements the `Sim` interface from `src/contracts/sim-api.ts`. Pure and deterministic:
no DOM, no Math.random, no Date.now. All randomness from `GameState.rng`.
Entry point to create: `src/sim/index.ts` exporting `createGame` and `applyCommand`.
