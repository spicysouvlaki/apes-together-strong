# Game Design (condensed)

Source of truth is the living design doc, *Apes Together Strong — Game Design Document*
(Claude Doc, owner's account; tabs: Overview, Rules & Systems, People & Cultures,
Traditions & Hybrids, UX/Art/Audio, Tech & Build Plan). This file is the build-ready
summary. When they disagree, the living doc wins; update this file.

All numbers are first-pass tuning values. Put them in content or named constants, never inline.

---

## 1. Vision and pillars

You never pick a civilization. You build one from the famous people your play attracts, and
refine their traditions into a culture no one else will have. At the end of a ~4-hour game the
player should feel patriotic about a nation that never existed and excited about real history.

1. **Nations are built, not born.** Cultures emerge from people working together.
2. **Play is the recruiter.** Every figure type can come from every play style; how and where you play decides who joins.
3. **History, celebrated.** Every figure and tradition teaches something true.
4. **Genre-complete 4X.** Explore, expand, exploit, exterminate on a solid base.
5. **Pocket-sized.** ~4 h on an iPhone, fully offline.

## 2. Setup and identity

- **Look (cosmetic only):** primary + secondary banner color, skin tone of your people.
- **Leader archetype (fixed all game):** 6–8 invented archetypes (Builder, Conqueror, Sage, Merchant,
  Prophet, Diplomat, Navigator), one ability each, which works with any culture. Leader ages visibly per age.
- **Founding dream:** pick 1 of 3 offered; small bonus + motto in an old language (Pax, 天下 Tianxia,
  Mare Nostrum, Maʿat, Dharma, κλέος Kleos, Ubuntu, Destinatio Manifesta). A dream names an idea, not a people.

## 3. Famous people

- **Age-locked:** recruitable only in their own age. One **legend** slot per age (myths and fiction).
- **Unique worldwide:** first to accept gets them; others see "joined a rival".
- **Spoils of conquest:** capturing a city takes figures based there; eliminating a rival takes all of theirs.
- **Culture tag:** each figure has one culture, feeding refinement.
- **No exile, but consume:** can't be dismissed to rivals; can be consumed for a one-time bonus.
- **Dark figures:** 20th-century dictators are never figures, only dark events (§10).

| Kind | Typical use |
| --- | --- |
| General / admiral | Commander unit on map; Warleader/Marshal/Admiral slot |
| Statesman | Cabinet: Chancellor, Consul, Premier, Steward, Treasurer, Envoy |
| Thinker / writer | One-time boost (activate) or Laureate/Scientist slot |
| Spiritual | Faith actions or High Priest slot (no founders of living religions) |
| Builder / artist | Rush a wonder or create a great work |
| Explorer / merchant | Map unit: reveal, open trade |
| Legend | One strong, strange effect + culture tag |

**Figure states and actions**

| Action | Effect | Reversible |
| --- | --- | --- |
| Base | Lives in a city; counts for culture weight | — |
| Deploy | Becomes a unit in a chosen city | Can return |
| Seat | Cabinet slot bonus each turn; culture weight ×2 | Unseat any time (2-turn cooldown) |
| Activate | One-time effect; figure retires to Hall of Ancestors | No |
| Consume | Gain `consumeValue` refinement points or a 10-turn yield burst; leaves play, no Legacy score | No |

Unit-figures that lose a battle retreat to the nearest city at 1 HP (captured if nowhere to go).
At each transition every figure retires to the **Hall of Ancestors**: +1 of their main yield per turn forever.

## 4. Emergence engine

Inputs: land and climate, cities and economy, contact and trade, deeds and events.
Each player has a hidden affinity `A[c]` per culture:

```
A[c] ← 0.98 · A[c] + Σ_s w[s,c] · x[s]        (every turn)
```

`x[s]` = measured value of signal `s` (tundra tiles owned, tea worked, routes to culture c, …),
`w[s,c]` from `content/signals.json`. Tune so a focused player reaches ~100 in their main culture by mid-age.

**Great-people points.** Six pools: military, statesman, thought, faith, building, exploration,
fed by yields and actions. Threshold starts at 60 and grows ×1.4 after each offer from that pool.

**Offer generation** (when a pool crosses its threshold):
1. Pool = unrecruited, non-deed figures of the matching kind in the current age.
2. Weight = `(A[culture] + 5)^1.5`, ×2 if the player has a city-state or trade partner of that culture.
3. Draw 3 without replacement; guarantee ≥1 from the player's top-3 cultures if any exist.
4. Player picks 1, or skips for +25% points toward the next offer.

**Hidden affinity.** Never show numbers. Show a toast when a culture crosses 50 and 100
("Steppe peoples speak of your herds") and, on each offer card, why the figure came
("drawn by your tea trade").

**Deed figures** arrive immediately on a story beat, once per world (e.g. hold a city through a
5-turn siege → Zenobia; capture/raze 5 cities in 10 turns → Genghis Khan; circumnavigate →
Elcano; reach a pole → Amundsen or Rasmussen). Target ~3 deeds per culture per age.

**Oral-record cultures** get labeled archetype figures ("A Thule umiak captain"), never invented names.

## 5. Turns, ages, crises

- ~200 turns, ~50 per age at Standard speed (Quick ~35, Epic ~75). Turn count is a tuning goal, not P0.
- **Turn order:** start-of-turn sim (yields, growth, research, triggers, offers) → player phase → AI phase (in worker, replay skippable) → world phase (city-states, age meter, crises).
- End Turn blocks only on decisions needing an answer (offers, idle city, research done).
- **Saves:** autosave every turn start, last 5 kept, 10 manual slots; deterministic snapshots.

**Ages** (figure date boundaries): Ancient (to ~500 BCE) · Classical/Medieval (~500 BCE–1450) ·
Exploration (1450–1800) · Modern (1800–present). No living people.

**Age meter** 0–100: +1/turn, +4 per tree completed, +3 per legacy milestone, +1 per wonder, +0.5 per figure recruited anywhere. Crisis starts at 70; age ends for everyone at 100.

| Ending age | Crisis | Pressure |
| --- | --- | --- |
| Ancient | Collapse | Raiders spawn; −2 happiness in towns |
| Classical/Medieval | Plague | −1 pop per 10 turns; spreads by trade |
| Exploration | Revolution | Unrest under old governments |

Player picks 1 of 2 crisis responses at 70, 80, 90.

**Transition:** recap screen → legacy points tallied → refinement (spend RP, name civ) →
soft reset (units −10 strength until upgraded, past-age buildings at 50% yields, cabinet empties
and figures retire, trees swap) → choose new government → catch-up bonus for players below median.

## 6. Refinement, traditions, hybrids

**RP earned at a transition:** 2 per legacy milestone (max 24) + 1 per figure retiring + consumed
figures' values + 50% of unspent RP. Typical 15–25.

**Culture weight** = figures of that culture recruited (all ages) + 1 per 10 seated turns. Your
heaviest culture gets −30% on its costs.

| Tier | Weight needed | Cost (RP) | Limit |
| --- | --- | --- | --- |
| Custom | 1 | 3 | Any |
| Institution | 3 | 6 | Needs that culture's Custom |
| Signature | 5 | 10 | Needs Institution; max 1 new per transition |
| Hybrid | 3 in both cultures | 8 | Max 1 new per transition |

Traditions are permanent and stack. Each culture has age-flavored variants per tier.
**Hybrids** are hand-written for pairs that really met (Al-Andalus, Ptolemaic Alexandria,
Translation Movement, Caravanserai, Yuan Courier Network, Maragheh Observatory, Varangian Guard,
Greenland Crossing, Mamluk Cairo, Manila Galleon, …), available from the age of the meeting. Launch target ~40.

**Naming:** each transition proposes 3 names = adjective of top culture/hybrid + dream
("the Andalusian Pax"); player may type their own. Banner keeps colors; emblem gains one motif per
Signature tradition. New cities are named from the heaviest culture at founding.

## 7. Core 4X systems

**Map.** Procedural hex. Small 48×30 (3 players + 4 city-states, phone default), Standard 64×40
(5 + 6), Large 80×50 (7 + 8). Pipeline: continents (2–4) → elevation → latitude climate bands
(polar, boreal, temperate, arid, tropical) → rainfall and rivers → terrain/features → resources →
natural wonders (~1 per player) → fair starts (each start reaches 3+ biomes). A Distant Lands
continent unreachable until Exploration. Terrain/resource data: `content/terrain.json`, `content/resources.json`.

**Settlements.** Founded as **towns** (production → gold; specialize at pop 7) and upgraded to
**cities** (build, research, host figures). Shared settlement cap per age; over cap costs happiness.
Growth cost per pop = `5 + 4·pop + pop^1.4`. Urban tiles hold 2 buildings; a full tile is a quarter
with adjacency. Happiness = luxuries + amenities − 1 per pop above 5 − war weariness − cap penalty;
≥10 celebration (+10% yields), <0 −2% yields per point, < −10 unrest. Past-age buildings keep 50% yields.
~8 wonders per age, each with a culture tag that adds affinity.

**Combat.** One military unit per tile, 100 HP.

```
damage = 30 · e^(0.04 · (S_attacker − S_defender)) · r,   r ∈ [0.8, 1.2]
```

Ranged attacks take no return damage. Modifiers: terrain defense, river crossing −5, flanking +2
per adjacent friendly, fortified +5, −1 per 10 HP lost, commander aura, traditions.
**Commanders** pack 4 units (6 later), level up, and have 5 promotion trees; general figures are
commanders with a unique starting promotion. A city falls when walls hit 0 and a melee unit enters.

| Age | Infantry | Ranged (melee/ranged) | Cavalry | Siege | Naval |
| --- | --- | --- | --- | --- | --- |
| Ancient | Warrior band 20 | Slinger 15/20 | Chariot 25 | Ram 20 | War canoe 20 |
| Classical/Medieval | Spearman 30 | Archer 25/35 | Horse archer 35 | Catapult 30 | Galley 30 |
| Exploration | Pike and shot 45 | Musketeer 40/50 | Lancer 50 | Cannon 50 | Galleon 50 |
| Modern | Rifleman 65 | Artillery 60/75 | Armored car 75 | Howitzer 75 | Ironclad 70 |

**Trees.** Per age: ~14-node tech tree (science) and civic tree (culture). Mastery = second bonus at
+80% cost. Final node repeats for age-meter points. Civics unlock governments, cabinet slots, policies.

**Governments** set cabinet slots + 2–4 policy slots; chosen each age (mid-age change costs 2 turns
of anarchy). Ancient: Chiefdom (Elder, Warleader), Theocratic council (High Priest, Elder),
Despotism (Warleader ×2). Classical: Monarchy, Republic, Feudal realm. Exploration: Absolute
monarchy, Merchant republic, Divine-right empire. Modern: Parliamentary democracy, Constitutional
monarchy, Technocracy. Slot → figure kinds in `content/cabinet_slots.json`.

**Diplomacy.** Influence buys: open borders 30, research pact 60, cultural exchange 50 (both gain
affinity for each other's top 2 cultures), alliance 120, denounce 20, peace 40. Scale Hostile →
Unfriendly → Neutral → Friendly → Allied.

**City-states.** One culture tag + one type each. Envoys → suzerain bonus + big affinity for their
culture. Peaceful absorption at 6 envoys from Exploration.

**Trade.** Merchants open routes (10 tiles land, 20 sea): gold both ways + affinity for the partner's
top culture each turn. Main way to draw distant cultures.

**Religion.** Pantheon (Ancient); first 4 players to earn a spiritual figure in Classical found a
religion (2 founder + 1 follower belief). Religions are player-invented; no real living religion is modeled.

## 8. Legacy tracks and victory

| Track | Ancient | Classical/Medieval | Exploration | Modern (victory) |
| --- | --- | --- | --- | --- |
| Science | 4/8/12 codices | 2/4/6 academies | Chart 30/60/90% | Space program (3 projects) |
| Military | Hold 4/8/12 settlements | Win 10/20/30 battles | 2/4/6 cities overseas | Hold every rival's original capital |
| Culture | 2/4/7 wonders | 3/6/9 great works | Religion in 6/12/18 cities | Tourism above every rival's culture |
| Legacy | Recruit 3/6/9 figures | Refine 2/3/4 cultures | 1/2/3 hybrids | Legacy score 600 first, or highest at limit |

Legacy score = 10/figure + 15/tradition + 40/hybrid + 25/signature + 5/seated figure at end.
Turn limit: when the Modern meter hits 100, highest total score wins.
The game always ends on the **Chronicle**: your civ's name, banner, figures, traditions and hybrids
by age, each with a one-line history note. This is the emotional payoff.

## 9. AI

Same rules and same emergence engine, so AI civs become hybrid cultures too. Personality = leader +
2 agendas (Collector, Seafarer, Zealot, Opportunist, …). Layers: strategic (re-plan every 10 turns:
which legacy track), operational (settle/build/war goals), tactical (per-unit scoring). Difficulty
adds yield bonuses and depth, never hidden information. Budget: all AI under 3 s per turn on iPhone 13.

## 10. Dark events

Modern age only. Trigger: autocratic government + happiness below −10 in 3+ cities + at war or in
revolution; 10% per turn while true; max once per player per game. Player picks one penalty: −20% of
the age's Legacy score, lose a seated cabinet figure, or 10 turns of anarchy. Nothing persists.
Card is sober and factual, notes the victims, never shows the dictator's portrait or a quote.

## 11. Art, UX, audio

- **Art direction:** Dorfromantik / Townscaper diorama: beveled low-poly hex prisms with a soil
  "cake slice" side, muted biome pastels, warm key light, parchment fog of war. **Procedural
  architecture** from per-culture motif kits, mixed by the city's traditions, so hybrid cultures
  look hybrid. Materials shift by age (mud brick → stone → plaster/glass → brick/iron).
  Units are small painted figurines; figure-units have a gold base ring.
  **Right now: stand-in art only** (see CLAUDE.md).
- **Screens:** Title, Game setup, Map HUD, City panel, Figure offer, Figure roster, Cabinet,
  Tech/civic trees, Diplomacy, Event card, Age recap, Refinement, Chronicle, Settings.
- **Touch:** tap select/move, long-press tile info, drag pan, pinch zoom (strategic/regional/close-up),
  two-finger twist rotates 60°. Portrait one-handed: 44 px top bar (yields, age meter), bottom
  sheet for selection, floating End Turn bottom-right. 44×44 pt minimum targets. Strategic zoom
  swaps the diorama for flat icons.
- **Onboarding:** in-game over the first 20 turns; first figure offer scripted early (~turn 8);
  advisors are your own seated figures.
- **Audio:** per-age base theme + culture instrument stems faded in by culture weight; ElevenLabs
  narration and figure quotes; diorama-scale SFX; all bundled offline (~60 MB).
- **Accessibility:** colorblind-safe banners with patterns, text 85–150%, VoiceOver labels,
  reduce motion, subtitles, no time pressure.

## 12. Platform

Offline-first PWA; deterministic TS sim in a Web Worker; Preact UI over a three.js canvas;
IndexedDB saves; content as Zod-validated JSON; Vitest + Playwright (WebKit). Budgets in CLAUDE.md.
Architecture: main thread (UI, renderer) ⇄ commands / state snapshots ⇄ sim worker (sim core,
emergence engine, AI) ← content JSON; saves ⇄ IndexedDB; service worker caches everything.
