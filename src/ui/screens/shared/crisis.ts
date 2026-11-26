/**
 * Crisis card wording (GDD §5 "Crisis"). Content descriptions end with the mechanical penalty
 * ("Towns suffer -2 happiness."), which the card also lists under "While it lasts" from the
 * pressure modifiers: show it once (playtest). Pure.
 */

/** A sentence that states a number of something ("-2 happiness", "+1 faith", "8+ population"). */
const MECHANICAL = /(^|\s)[+\-−]\s?\d+(\.\d+)?\s*%?\s*[a-z]/i;

/** Sentences of `text` (keeps the full stop). */
export const sentences = (text: string): string[] => text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [];

/**
 * The description without the sentences the "While it lasts" list already states. Only drops
 * mechanical sentences when there is a pressure list to show instead; never returns empty.
 */
export const crisisLede = (description: string, pressureLines: readonly string[]): string => {
  if (pressureLines.length === 0) return description;
  const kept = sentences(description).filter((s) => !MECHANICAL.test(s));
  return kept.length > 0 ? kept.join(' ') : description;
};
