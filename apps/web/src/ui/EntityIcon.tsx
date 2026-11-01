import { createElement } from 'react';
import { iconFor } from '../lib/icons';

/** Renders a stored icon key (accounts, categories, types); unknown or empty keys show the fallback. */
export function EntityIcon({
  name,
  fallback,
  size = 20,
}: {
  name: string | null | undefined;
  /** key to use when `name` is empty */
  fallback?: string;
  size?: number;
}) {
  // A lookup in a static icon table, not a component defined during render.
  return createElement(iconFor(name ?? fallback), { size, stroke: 1.75 });
}
