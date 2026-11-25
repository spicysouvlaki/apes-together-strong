# Content

Game data as JSON, validated by `src/contracts/content-schemas.ts`. Seed data for the first playable.
Rules: docs/CONTENT_GUIDELINES.md. Every bio and history note needs a `source`.

| File | Holds |
| --- | --- |
| cultures.json | Cultures, city names, architecture and music ids |
| figures.json | Famous people (seed: Ancient age + 2 Thule archetypes) |
| traditions.json | Custom / Institution / Signature traditions |
| hybrids.json | Two-culture hybrid traditions |
| signals.json | Measured signals and per-culture affinity weights |
| terrain.json, resources.json | Map data |
| leaders.json, dreams.json | Setup choices |
| governments.json, cabinet_slots.json | Governments and the figure kinds each slot accepts |

To add: units, buildings, wonders, techs, civics, policies, deeds, city-states, events.
