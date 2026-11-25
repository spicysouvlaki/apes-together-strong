# Content

Game data as JSON, validated by `src/contracts/content-schemas.ts`. Seed data for the first playable.
Rules: docs/CONTENT_GUIDELINES.md. Every bio and history note needs a `source`.

| File | Holds |
| --- | --- |
| cultures.json | Cultures, city names, architecture and music ids |
| figures.json | Famous people (seed: Ancient age + 2 Thule archetypes) |
| traditions.json | Custom / Institution / Signature traditions |
| hybrids.json | Two-culture hybrid traditions |
| deeds.json | Story beats that deliver a deed figure |
| signals.json | Measured signals and per-culture affinity weights |
| terrain.json, resources.json | Map data: terrain yields/move cost; bonus, luxury and strategic resources by terrain |
| leaders.json, dreams.json | Setup choices: 7 leader archetypes with AI agenda bias; 8 founding dreams |
| governments.json, cabinet_slots.json | Governments per age and the figure kinds each cabinet slot accepts |
| techs.json | Tech (science) and civic (culture) tree nodes per age, with layout `col`/`row` |
| units.json | Unit definitions per age (GDD §7 strength table), incl. figure stand-in units |
| buildings.json | Settlement buildings: yields, great-people points, defense, coastal/river conditions |
| wonders.json | Culture-tagged wonders (affinity on completion) with history notes |
| city_states.json | Real independent cities: culture tag, type, suzerain bonus, history note |
| crises.json | End-of-age crises: pressure, sim behaviors, three staged two-option responses |
| legacy.json | Legacy milestones per track and age (GDD §8) with three thresholds |

Conventions:

- Unit, building and wonder ids share one namespace (all are production items).
- `requiresTech` may name a tech or a civic node. Tree `requires` stay within one tree and age;
  `col` is the node's depth (1 + deepest prerequisite's col), at most 4 rows per column.
- Units, buildings and wonders are gated by their `requiresTech`; tree nodes use `unlock`
  modifiers only for embarking and governments (despotism, theocratic council). Chiefdom and the
  classical governments carry no unlock node.

To add: policies, events.
