/**
 * Codex / How to play (modal 'codex', from the menu). Short and scannable; numbers come from the
 * sim's named constants and content so the page follows the rules as tuned (GDD §3–§8).
 */
import { useRef } from 'preact/hooks';
import { content, game } from '../store';
import { Screen, Section } from '../screens/shared/components';
import { Icon } from '../art/Icon';
import { AGE_NAME, LEGEND_YIELDS, YIELD_HELP, YIELD_ICON, YIELD_NAME } from './format';
import { Term } from './GlossarySheet';
import {
  CRISIS_START,
  HEAVIEST_CULTURE_DISCOUNT_PERCENT,
  MAX_HYBRIDS_PER_TRANSITION,
  MAX_SIGNATURES_PER_TRANSITION,
  METER_PER_FIGURE,
  METER_PER_TREE_COMPLETED,
  METER_PER_WONDER,
  TIER_WEIGHT,
} from '../../sim/ages/constants';
import {
  CELEBRATION_THRESHOLD,
  FEATURE_DEFENSE,
  FLANKING_PER_UNIT,
  FORTIFY_BONUS,
  MIN_SETTLEMENT_DISTANCE,
  RIVER_CROSSING_PENALTY,
  SETTLEMENT_CAP,
  UNIT_MAX_HP,
  UNREST_THRESHOLD,
} from '../../sim/constants';
import { CABINET_COOLDOWN_TURNS, CONSUME_BURST_TURNS, FIRST_OFFER_TURN } from '../../emergence/constants';

const SECTIONS = [
  ['yields', 'Yields'],
  ['play', 'A turn'],
  ['cities', 'Settlements'],
  ['figures', 'Famous people'],
  ['culture', 'Culture'],
  ['ages', 'Ages'],
  ['combat', 'Combat'],
  ['victory', 'Victory'],
] as const;

export function CodexScreen() {
  const body = useRef<HTMLDivElement>(null);
  const g = game.value;
  const age = g?.age ?? 'ancient';
  const finalAge = g?.finalAge ?? 'classical';
  const crisis = content.crises.find((c) => c.age === age);
  const jump = (id: string): void => {
    body.current?.querySelector(`#codex-${id}`)?.scrollIntoView({ block: 'start' });
  };
  return (
    <Screen title="How to play" label="How to play" className="codex">
      <nav class="codex-nav" aria-label="Sections">
        {SECTIONS.map(([id, label]) => (
          <button key={id} class="chip codex-chip" onClick={() => jump(id)}>
            {label}
          </button>
        ))}
      </nav>
      <div ref={body}>
        <div id="codex-yields">
          <Section title="Yields">
            <ul class="codex-yields">
              {LEGEND_YIELDS.map((y) => (
                <li key={y} class="legend-row">
                  <span class={`legend-glyph y-${y}`}>
                    <Icon name={YIELD_ICON[y]} />
                  </span>
                  <span>
                    <strong>{YIELD_NAME[y]}</strong> {YIELD_HELP[y]}
                  </span>
                </li>
              ))}
            </ul>
            <p class="small muted">Tap the numbers in the top bar for your stock and income of each.</p>
          </Section>
        </div>

        <div id="codex-play">
          <Section title="A turn">
            <ul class="scr-mods">
              <li>Tap a unit, then a lit tile to move or a red tile to attack.</li>
              <li>Tap a far tile to plan a route: a second tap, or Go, marches there over several turns. Scouts can Explore on their own.</li>
              <li>Long-press any tile for what it yields.</li>
              <li>The gold button at the bottom right shows what needs an answer next; when it reads End Turn, your rivals move.</li>
            </ul>
          </Section>
        </div>

        <div id="codex-cities">
          <Section title="Settlements">
            <ul class="scr-mods">
              <li>Settlers found settlements at least {MIN_SETTLEMENT_DISTANCE + 1} tiles apart. Your first is a city; later ones start as towns.</li>
              <li>Towns turn production into gold. Upgrade one to a city (for gold) so it can build, research and host figures.</li>
              <li>
                This age allows {SETTLEMENT_CAP[age]} settlements ({AGE_NAME[age]}); every one beyond costs happiness.
              </li>
              <li>
                Happiness at {CELEBRATION_THRESHOLD} or more is a celebration (more yields); below zero yields shrink; below {UNREST_THRESHOLD} cities stop
                growing. Luxuries lift it; big cities, many settlements and war lower it.
              </li>
            </ul>
          </Section>
        </div>

        <div id="codex-figures">
          <Section title="Famous people">
            <p>
              Real people from history join you. Who comes depends on how and where you play: land, trade, wars, city-states and deeds draw different
              cultures. Your play fills <Term id="great_people_points" />; the first offer comes around turn {FIRST_OFFER_TURN}. Each person exists once
              in the world: if you send them on, a rival may take them.
            </p>
            <dl class="scr-uses">
              <div class="scr-use">
                <dt>
                  <Icon name="seat" size="sm" /> Seat
                </dt>
                <dd>A cabinet seat of your government: a bonus every turn. Unseating leaves the seat empty for {CABINET_COOLDOWN_TURNS} turns.</dd>
              </div>
              <div class="scr-use">
                <dt>
                  <Icon name="deploy" size="sm" /> Deploy
                </dt>
                <dd>Generals, explorers and others take the field as a unit with their own strength or reach. Recall them in a city.</dd>
              </div>
              <div class="scr-use">
                <dt>
                  <Icon name="activate" size="sm" /> Activate
                </dt>
                <dd>A one-time great deed (rush a wonder, a burst of science). Then they retire to the Hall of Ancestors.</dd>
              </div>
              <div class="scr-use">
                <dt>
                  <Icon name="consume" size="sm" /> Consume
                </dt>
                <dd>
                  They leave play for good, for <Term id="refinement_points" /> or a {CONSUME_BURST_TURNS}-turn burst of yields. They no longer count for
                  your score.
                </dd>
              </div>
            </dl>
            <p class="small muted">When an age ends every figure retires to the Hall of Ancestors and gives a little of their main yield forever.</p>
          </Section>
        </div>

        <div id="codex-culture">
          <Section title="Culture">
            <p>
              You never pick a civilization: you become one. Each figure adds to the <Term id="culture_weight" /> of their culture. When an age ends you
              spend <Term id="refinement_points" /> on that culture's traditions:
            </p>
            <ul class="scr-mods">
              <li>Custom: weight {TIER_WEIGHT.custom}. Institution: weight {TIER_WEIGHT.institution}, after its custom.</li>
              <li>
                Signature: weight {TIER_WEIGHT.signature}, after its institution; at most {MAX_SIGNATURES_PER_TRANSITION} per transition.
              </li>
              <li>
                Hybrid: two cultures that really met, weight {TIER_WEIGHT.institution} in both; at most {MAX_HYBRIDS_PER_TRANSITION} per transition.
              </li>
              <li>Your heaviest culture's traditions cost {Math.abs(HEAVIEST_CULTURE_DISCOUNT_PERCENT)}% less. Then you name your people.</li>
            </ul>
            <p class="small muted">Culture whispers (gold-edged notes) tell you a culture is taking interest. There are no numbers to see: only signs.</p>
          </Section>
        </div>

        <div id="codex-ages">
          <Section title="Ages, crises, transitions">
            <ul class="scr-mods">
              <li>
                The age track fills a little every turn, plus {METER_PER_TREE_COMPLETED} per finished tree, {METER_PER_WONDER} per wonder and{' '}
                {METER_PER_FIGURE} per figure anyone recruits. It is shared by the whole world.
              </li>
              <li>
                At {CRISIS_START} a crisis begins{crisis ? ` (this age: ${crisis.name})` : ''}. At each of its stages you choose one of two responses.
              </li>
              <li>At 100 the age ends for everyone: a recap, then refinement and naming, then a new government and new trees.</li>
            </ul>
          </Section>
        </div>

        <div id="codex-combat">
          <Section title="Combat">
            <ul class="scr-mods">
              <li>One military unit per tile, {UNIT_MAX_HP} health. Damage depends on the difference in strength, with a little luck.</li>
              <li>Ranged units strike without being hit back.</li>
              <li>
                Defenders gain {FEATURE_DEFENSE.hills ?? 0} on hills and {FEATURE_DEFENSE.forest ?? 0} in forest, {FORTIFY_BONUS} when fortified.
                Attacking across a river costs {RIVER_CROSSING_PENALTY}; each friendly unit beside the target adds {FLANKING_PER_UNIT}.
              </li>
              <li>A city falls when its walls are down and a melee unit moves in. Attacking anyone at peace declares war.</li>
            </ul>
          </Section>
        </div>

        <div id="codex-victory">
          <Section title="Victory">
            <p>
              The game ends when the {AGE_NAME[finalAge]} age ends. The highest <Term id="legacy_score" /> wins; milestones on the four legacy tracks
              (science, military, culture, legacy) add to it. Tap the age track to see yours. Whatever happens, the Chronicle tells the story of the
              people you built.
            </p>
          </Section>
        </div>

      </div>
    </Screen>
  );
}
