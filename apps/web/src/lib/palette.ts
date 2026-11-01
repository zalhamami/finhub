/**
 * Color NAMES an account/category can use. Stored as the Mantine color name (never hex), so the
 * swatch follows the theme. `expense` (clay) is deliberately absent: it is reserved for overspending.
 */
export const COLOR_NAMES = [
  'amber',
  'jade',
  'indigo',
  'income',
  'teal',
  'blue',
  'violet',
  'grape',
  'pink',
  'orange',
  'cyan',
  'gray',
] as const;
export type ColorName = (typeof COLOR_NAMES)[number];

export const COLOR_LABEL: Record<ColorName, string> = {
  amber: 'Amber',
  jade: 'Jade',
  indigo: 'Indigo',
  income: 'Sage',
  teal: 'Teal',
  blue: 'Biru',
  violet: 'Ungu',
  grape: 'Anggur',
  pink: 'Merah muda',
  orange: 'Oranye',
  cyan: 'Sian',
  gray: 'Abu-abu',
};

export const isColorName = (x: string | null | undefined): x is ColorName =>
  !!x && (COLOR_NAMES as readonly string[]).includes(x);

/** CSS value for a stored color name; unknown/null names fall back to neutral gray. */
export const colorVar = (name: string | null | undefined, shade = 6): string =>
  `var(--mantine-color-${isColorName(name) ? name : 'gray'}-${shade})`;
