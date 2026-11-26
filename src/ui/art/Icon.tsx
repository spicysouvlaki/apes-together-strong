/** `<Icon name="gold" />`: one drawing from the icon set, in currentColor, decorative by default. */
import { iconMarkup, type AnyIconName } from './icons-data';

export function Icon(props: { name: AnyIconName; size?: 'sm' | 'md' | 'lg'; class?: string; label?: string }) {
  const size = props.size && props.size !== 'md' ? ` icon-${props.size}` : '';
  return (
    <svg
      class={`icon${size}${props.class ? ` ${props.class}` : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      role={props.label ? 'img' : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : 'true'}
      focusable="false"
      dangerouslySetInnerHTML={{ __html: iconMarkup(props.name) }}
    />
  );
}
