# Scripts

Workstream 6. Node scripts run with tsx.
- `validate-content.ts`: schema + cross-reference validation (npm run validate:content).
- `autoplay.ts`: N seeded AI-only games, prints balance and emergence reports (npm run autoplay).
- `lib/validate.ts`: the pure `validateContent(raw)` used by the script and `tests/content.test.ts`.
- `lib/autoplay.ts`: `playGame()` runner behind autoplay (tested in `tests/worker-autoplay.test.ts`).
  Flags: `--games 3 --seed 1 --turns 250 --size small --speed quick --players 4 --max-seconds 300 --json out.json --verify`.
- `make-icons.ts`: regenerates the PNG app icons in `public/` from the stand-in design (no deps).
