/**
 * THE color file. Every color in the web app comes from here (a Vitest guard,
 * test/no-hardcoded-colors.test.ts, fails on hex/rgb()/hsl() literals anywhere else in src/).
 *
 * - Change the default accent: edit DEFAULT_ACCENT below (one line).
 * - Add an accent preset: add a 10-shade tuple + an ACCENT_PRESETS entry (and the name in
 *   apps/server/src/routes/settings.ts).
 * - Retune neutrals / surfaces: edit `surfaces` (light + dark).
 */
import type { MantineColorsTuple } from '@mantine/core';

/** One-line change: the accent used until the user picks another in Pengaturan. */
export const DEFAULT_ACCENT: AccentPresetName = 'amber';

/* ---------- accent palettes (10 shades, light -> dark; fill = index 5 light mode, 4 dark mode) ---------- */

// Golden amber. Fills are bright, so text ON amber is dark (autoContrast), never white.
export const amber: MantineColorsTuple = [
  '#fff8e1',
  '#ffefc2',
  '#ffdf85',
  '#ffcd45',
  '#fbbd1a',
  '#f5b000',
  '#e6a100',
  '#c48800',
  '#9c6b00',
  '#7a5300',
];
// Deep teal green. Base (index 5) is about #178872 (nudged darker so white text on fills passes WCAG AA).
export const jade: MantineColorsTuple = [
  '#e8f7f3',
  '#cfeee6',
  '#a1dfd0',
  '#6fcdb6',
  '#3fb69b',
  '#168470', // ~#178872, nudged so white text passes 4.5:1
  '#127662',
  '#0e6353',
  '#0a5043',
  '#073e34',
];
// Calm blue-violet. Base (index 5) is #4c5bd4; white text on fills.
export const indigo: MantineColorsTuple = [
  '#eef0fd',
  '#dde1fa',
  '#bcc3f4',
  '#97a1ec',
  '#7381e2',
  '#4c5bd4',
  '#4150bd',
  '#364398',
  '#2b3680',
  '#212a63',
];

export const ACCENT_PRESETS = {
  amber: { label: 'Amber', scale: amber },
  jade: { label: 'Jade', scale: jade },
  indigo: { label: 'Indigo', scale: indigo },
} as const;
export type AccentPresetName = keyof typeof ACCENT_PRESETS;
export const ACCENT_PRESET_NAMES = Object.keys(ACCENT_PRESETS) as AccentPresetName[];

/* ---------- semantic palettes ---------- */

// Income: soft sage, not neon green.
export const income: MantineColorsTuple = [
  '#edf7ef',
  '#dcede0',
  '#b6d9be',
  '#8ec49a',
  '#6cb27c',
  '#57a669',
  '#4aa05f',
  '#3a8b4e',
  '#307c44',
  '#226b38',
];
// Overspend: warm clay, not alarm red. Reserved for overspending (budget over its limit) -
// ordinary expenses, liabilities and error states stay neutral.
export const overspend: MantineColorsTuple = [
  '#fdf0ec',
  '#f5e0d9',
  '#e9bfb0',
  '#dd9b85',
  '#d37d60',
  '#cd6a49',
  '#ca603d',
  '#b2502f',
  '#9f4628',
  '#8b3a1f',
];
// Dark mode neutrals, slightly cool; index 7 is the page background.
export const neutralDark: MantineColorsTuple = [
  '#c9cdd2',
  '#aeb3ba',
  '#8b919a',
  '#5f656e',
  '#3a3f47',
  '#2c3037',
  '#1f2228',
  '#17191e',
  '#121418',
  '#0d0e11',
];

/* ---------- semantic surface tokens (light / dark) ---------- */

export interface SurfaceTokens {
  /** page background behind everything */
  pageBg: string;
  /** cards, panels */
  surface: string;
  /** header, navbar, tab bar */
  chrome: string;
  border: string;
  textMuted: string;
  /** negative amounts that are NOT overspending (expenses, liabilities): plain text color */
  amountNegativeNeutral: string;
}

export const surfaces: { light: SurfaceTokens; dark: SurfaceTokens } = {
  light: {
    pageBg: '#f7f7f5', // warm off-white, not pure white
    surface: '#ffffff',
    chrome: '#ffffff',
    border: '#e4e3de',
    textMuted: '#6b6d73',
    amountNegativeNeutral: '#1f2228',
  },
  dark: {
    pageBg: neutralDark[7]!,
    surface: neutralDark[6]!, // a step above the page
    chrome: neutralDark[7]!,
    border: neutralDark[4]!,
    textMuted: neutralDark[2]!,
    amountNegativeNeutral: neutralDark[0]!,
  },
};

/** Text drawn on top of accent fills (autoContrast picks one of these by luminance). */
export const onAccent = { dark: '#1a1a1a', light: '#ffffff' } as const;

/** Shadows (light chrome only; sheets, popovers, FAB). */
export const shadows = {
  xs: '0 1px 2px rgb(16 24 40 / 0.04)',
  sm: '0 1px 3px rgb(16 24 40 / 0.06), 0 1px 2px rgb(16 24 40 / 0.04)',
  md: '0 8px 24px rgb(16 24 40 / 0.08)',
};
