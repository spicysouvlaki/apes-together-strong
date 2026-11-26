/**
 * Store-aware art: portraits, crests and banners looked up from content and game state.
 * Specs are memoised per id (they never change during a session).
 */
import type { ContentBundle } from '@contracts/content-schemas';
import type { PlayerState } from '@contracts/sim-api';
import { content, lookup } from '../store';
import { BannerArt, Crest } from './Heraldry';
import { bannerSpec, crestSpec, type CrestSpec } from './heraldry-spec';
import { artStyleOf, cultureTones, type ArtStyle, type CultureTones } from './palette';
import { PortraitArt } from './Portrait';
import { portraitSpec, type PortraitSpec } from './portrait-spec';

export const styleOfCulture = (cultureId: string, c: ContentBundle = content): ArtStyle =>
  artStyleOf(c.cultures.find((x) => x.id === cultureId)?.architecture);

const toneCache = new Map<string, CultureTones>();
export const tonesOf = (cultureId: string): CultureTones => {
  let t = toneCache.get(cultureId);
  if (!t) {
    t = cultureTones(styleOfCulture(cultureId), cultureId);
    toneCache.set(cultureId, t);
  }
  return t;
};

const portraitCache = new Map<string, PortraitSpec>();
export const figurePortraitSpec = (figureId: string): PortraitSpec | null => {
  const hit = portraitCache.get(figureId);
  if (hit) return hit;
  const def = lookup.figures[figureId];
  if (!def) return null;
  const spec = portraitSpec({ id: def.id, kind: def.kind, archetype: def.archetype, style: styleOfCulture(def.culture), culture: def.culture });
  portraitCache.set(figureId, spec);
  return spec;
};

const SIZE = { xs: 32, sm: 46, md: 72, lg: 96 } as const;

export function FigurePortrait({ figure, size = 'md', badge }: { figure: string; size?: keyof typeof SIZE; badge?: boolean }) {
  const spec = figurePortraitSpec(figure);
  if (!spec) return <span class="portrait" aria-hidden="true" />;
  return (
    <span class={`portrait portrait-${size}${spec.frame === 'legend' ? ' portrait-legend' : ''}`} aria-hidden="true">
      <PortraitArt spec={spec} size={SIZE[size]} badge={badge ?? size !== 'xs'} />
    </span>
  );
}

const crestCache = new Map<string, CrestSpec>();
export function CultureCrest({ culture, size = 20, label }: { culture: string; size?: number; label?: string }) {
  let spec = crestCache.get(culture);
  if (!spec) {
    spec = crestSpec(styleOfCulture(culture), culture);
    crestCache.set(culture, spec);
  }
  return <Crest spec={spec} size={size} label={label} />;
}

/** Culture styles of a player's adopted signature traditions, in adoption order. */
export const signatureStyles = (p: Pick<PlayerState, 'traditions'>): ArtStyle[] =>
  p.traditions
    .map((id) => lookup.traditions[id])
    .filter((t) => t?.tier === 'signature')
    .map((t) => styleOfCulture(t?.culture ?? ''));

export function PlayerBanner({
  player,
  width = 60,
  wave,
  label,
}: {
  player: Pick<PlayerState, 'id' | 'colors' | 'leader' | 'traditions'>;
  width?: number;
  wave?: boolean;
  label?: string;
}) {
  const spec = bannerSpec({
    primary: player.colors.primary,
    secondary: player.colors.secondary,
    leader: player.leader,
    signatureStyles: signatureStyles(player),
    seed: player.id,
  });
  return <BannerArt spec={spec} width={width} wave={wave} label={label} />;
}

export function SetupBanner(props: { primary: string; secondary: string; leader: string; width?: number }) {
  const spec = bannerSpec({ primary: props.primary, secondary: props.secondary, leader: props.leader, signatureStyles: [], seed: 'setup' });
  return <BannerArt spec={spec} width={props.width ?? 72} wave label="Your banner" />;
}
