# Workstreams and milestones

Eight workstreams, each owning folders. Each one builds against `src/contracts/*` and
`content/*.json`, so they can run in parallel once M0 is done.

## Milestones

The order matters: prove the twist is fun cheaply before investing in 3D and breadth.

| Milestone | Goal | Exit criteria |
| --- | --- | --- |
| **M0 Foundations** | Contracts reviewed and frozen; repo tooling works; iPhone spikes | `npm run check` passes on an empty sim; three.js hex spike holds 60 fps on a 48×30 map on iPhone 13; PWA installs and runs in airplane mode; Safari storage/eviction and WebGL context-loss behavior written up |
| **M1 Headless core** | Sim core for one age, no 3D | Map gen, settlements, growth, production, movement, basic combat; AI plays itself in `npm run autoplay`; golden-replay determinism test passes |
| **M2 Emergence prototype** | Prove the twist with a flat 2D debug view | Signals, affinity, offers, cabinet, deploy/seat/activate/consume, deeds. Emergence check: a scripted player following one culture's home signals sees that culture in ≥50% of offers by mid-age, for each of the 8 cultures. Offer cards explain *why* |
| **M3 Vertical slice** | Whole loop, small | 1 age + scripted transition, 4 cultures, 2 hybrids, small map, 1 human vs 1 AI, stand-in 3D, offline on iPhone. Playtest question: *do players feel their culture was built by their choices?* |
| **M4 First playable** | 2 ages | 8 cultures, ~100 figures, 9 hybrids, crisis, refinement, naming, 2 AIs, ~90 min |
| **M5 Full game** | 4 ages | Victories, chronicle, 24 cultures, audio, final art pass |

## Workstreams

### 1. Sim core — `src/sim/`, `tests/sim*`
Owns rules, the modifier engine, turn loop, map generation, settlements, units, combat, trees,
governments, diplomacy, trade, religion, ages and transitions, saves-as-state.
- **First tasks:** seeded RNG (sfc32, state in `GameState.rng`); `createGame` + `applyCommand`
  implementing the `Sim` interface; placeholder map generator (climate bands + noise); settle,
  grow, produce, move; modifier engine over `Modifier`; `content/units.json` + schema PR.
- **Done when:** every rule in GDD §5 and §7 has a unit test; golden replay is byte-identical;
  a 200-turn AI-only game runs in Node in under 60 s.

### 2. Emergence engine — `src/emergence/`, `tests/emergence*`
Owns signals, affinity, great-people points, offers, deeds, legends, culture hints, contested figures.
- **First tasks:** `measureSignals`, `updateAffinity` (GDD §4 formula), great-people accrual,
  `createOffers` with the weighted draw and top-3 guarantee, offer reasons, 50/100 hints;
  `content/deeds.json` + schema PR.
- **Done when:** the M2 emergence check passes for all 8 cultures; offers are deterministic
  for a given seed; no affinity number is ever sent to the UI except through hints and reasons.

### 3. AI — `src/ai/`
Owns rival decision-making: offer choices, seating, production, settling, war, diplomacy.
- **First tasks:** a utility-scored AI that expands, builds and defends competently; picks offers
  by its leader's agenda; seats figures. Keep warfare simple until M4.
- **Done when:** AI turns stay under budget; AI civs end the age with visibly different culture mixes.

### 4. Renderer — `src/render/`
Owns the three.js scene: hex tiles (instanced), elevation stacking, settlements, units, selection,
camera, strategic zoom, fog of war.
- **First tasks:** M0 spike (instanced hex prisms colored from `content/terrain.json`); camera pan,
  pinch zoom, 60° rotation; tile picking that returns a `Hex`.
- **Stand-in art only:** primitives and flat colors until the game is fun.
- **Done when:** perf budgets in CLAUDE.md hold on iPhone 13 at Small and Standard sizes.

### 5. UI — `src/ui/`
Owns Preact screens and the HUD (GDD §11 screen list), the worker client, notifications.
- **First tasks:** worker client (`ToWorker`/`FromWorker`), HUD top bar, End Turn / "Next decision",
  figure offer modal, figure roster, cabinet; setup screen.
- **Done when:** every M3 decision is playable one-handed at 375×812; VoiceOver labels on HUD.

### 6. Worker and platform — `src/worker/`, `src/platform/`, `scripts/`, CI
Owns the sim worker entry, IndexedDB saves (autosave + slots), PWA/offline, content validation
script, autoplay harness, perf tooling.
- **First tasks:** `scripts/validate-content.ts` (schema + cross-references: unknown cultures,
  slots, terrains, tradition requirements; archetype bios start "Archetype.", legend bios
  start "Legend."); worker message loop; save/load; `scripts/autoplay.ts` that runs N seeded
  AI-only games and prints figures-per-culture, offers-per-age, turns-per-age.
- **Done when:** saves survive app restarts on iPhone; autoplay reports run in CI.

### 7. Content — `content/`, `src/content/`
Owns all data files and the loader.
- **First tasks:** grow figures to ~6 per culture per age for the first two ages; traditions per
  `docs/GDD.md §6`; deeds; city-states; check every bio against its source.
- **Done when:** `npm run validate:content` passes and every entry follows
  `docs/CONTENT_GUIDELINES.md`.

### 8. Art and audio — `public/assets/` (later)
Deferred until M3 playtests say the game is fun. Then: Dorfromantik-style tile and building kits,
leader portraits, figure cards, music stems, ElevenLabs narration.

## Contracts that must be frozen first (M0)

1. `src/contracts/sim-api.ts`: `GameState`, `Command`, `SimEvent`, worker protocol.
2. `src/contracts/content-schemas.ts`: content schemas and the `Modifier` language.
3. `src/contracts/hex.ts`: coordinates.

Known gaps to add in M0/M1 through `contracts:` PRs: unit, building, wonder, tech and civic
schemas; deeds; city-states; trade routes in `GameState`; age-transition state (refinement in
progress); policy cards.
