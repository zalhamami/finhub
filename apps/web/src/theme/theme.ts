import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Card,
  Drawer,
  Modal,
  NumberInput,
  Table,
  createTheme,
  type CSSVariablesResolver,
  type MantineThemeOverride,
} from '@mantine/core';
import { LUMINANCE_THRESHOLD, resolveAccent, type Accent } from './accent';
import {
  ACCENT_PRESETS,
  DEFAULT_ACCENT,
  income,
  neutralDark,
  overspend,
  shadows,
  surfaces,
  type SurfaceTokens,
} from './tokens';
import classes from './theme.module.css';

const FONT = '"Plus Jakarta Sans Variable", system-ui, -apple-system, "Segoe UI", sans-serif';

/**
 * Builds the Mantine theme from the tokens. `accent` is a preset name or a custom #rrggbb.
 * Colors live in ./tokens.ts; nothing in here is a color literal.
 */
export function createFinhubTheme({ accent = DEFAULT_ACCENT }: { accent?: Accent } = {}) {
  const { colorName, scale, primaryShade } = resolveAccent(accent);
  return createTheme({
    primaryColor: colorName,
    primaryShade,
    autoContrast: true, // text on accent fills: dark on light accents, white on dark ones
    luminanceThreshold: LUMINANCE_THRESHOLD,
    colors: {
      ...Object.fromEntries(Object.entries(ACCENT_PRESETS).map(([k, p]) => [k, p.scale])),
      custom: scale,
      income,
      expense: overspend,
      dark: neutralDark,
    },
    fontFamily: FONT,
    fontFamilyMonospace: '"Geist Mono", ui-monospace, monospace',
    headings: { fontFamily: FONT, fontWeight: '650' },
    defaultRadius: 'md',
    radius: { xs: '4px', sm: '6px', md: '10px', lg: '14px', xl: '20px' },
    shadows,
    cursorType: 'pointer',
    components: {
      Card: Card.extend({
        classNames: { root: classes.card },
        defaultProps: { withBorder: true, shadow: 'none', radius: 'lg', padding: 'lg' },
      }),
      Button: Button.extend({ defaultProps: { radius: 'md', fw: 600 } }),
      Anchor: Anchor.extend({ classNames: { root: classes.link } }),
      ActionIcon: ActionIcon.extend({
        defaultProps: { variant: 'subtle', color: 'gray', radius: 'md' },
      }),
      Badge: Badge.extend({
        defaultProps: { variant: 'light', radius: 'sm', tt: 'none', fw: 600 },
      }),
      NumberInput: NumberInput.extend({
        defaultProps: {
          thousandSeparator: '.',
          decimalSeparator: ',',
          hideControls: true,
          prefix: 'Rp ',
        },
      }),
      Table: Table.extend({
        defaultProps: { verticalSpacing: 'sm', highlightOnHover: true, striped: false },
      }),
      Drawer: Drawer.extend({
        defaultProps: { radius: 'xl', overlayProps: { backgroundOpacity: 0.35, blur: 2 } },
      }),
      Modal: Modal.extend({
        defaultProps: {
          radius: 'lg',
          centered: true,
          overlayProps: { backgroundOpacity: 0.35, blur: 2 },
        },
      }),
    },
    other: { amountFeature: '"tnum" 1, "lnum" 1', transfer: 'var(--mantine-color-gray-6)' },
  } satisfies MantineThemeOverride);
}

export const theme = createFinhubTheme();

const surfaceVars = (t: SurfaceTokens) => ({
  '--finhub-page-bg': t.pageBg,
  '--finhub-surface': t.surface,
  '--finhub-chrome': t.chrome,
  '--finhub-border': t.border,
  '--finhub-text-muted': t.textMuted,
  '--finhub-amount-negative': t.amountNegativeNeutral,
  // Re-point Mantine's own semantic variables at the tokens
  '--mantine-color-body': t.chrome,
  '--mantine-color-default-border': t.border,
  '--mantine-color-dimmed': t.textMuted,
});

/** Emits the --finhub-* variables (and overrides Mantine's body/border/dimmed) from the tokens. */
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: surfaceVars(surfaces.light),
  dark: surfaceVars(surfaces.dark),
});
