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
} from '@mantine/core';
import type { MantineColorsTuple } from '@mantine/core';
import classes from './theme.module.css';

// One warm accent: golden amber. Fill shade 5 in light mode, 4 in dark mode.
// Amber fills are bright, so text ON amber is dark (autoContrast), never white.
// Amber as text on light backgrounds uses amber-9 (see .link in theme.module.css).
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
// Expense / overspend: warm clay, not alarm red. Normal expenses stay in body text color.
export const expense: MantineColorsTuple = [
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
export const dark: MantineColorsTuple = [
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

const FONT = '"Plus Jakarta Sans Variable", system-ui, -apple-system, "Segoe UI", sans-serif';

export const theme = createTheme({
  primaryColor: 'amber',
  primaryShade: { light: 5, dark: 4 },
  autoContrast: true, // filled amber buttons, badges, FAB get dark text
  luminanceThreshold: 0.3,
  colors: { amber, income, expense, dark },
  fontFamily: FONT,
  fontFamilyMonospace: '"Geist Mono", ui-monospace, monospace',
  headings: { fontFamily: FONT, fontWeight: '650' },
  defaultRadius: 'md',
  radius: { xs: '4px', sm: '6px', md: '10px', lg: '14px', xl: '20px' },
  shadows: {
    xs: '0 1px 2px rgb(16 24 40 / 0.04)',
    sm: '0 1px 3px rgb(16 24 40 / 0.06), 0 1px 2px rgb(16 24 40 / 0.04)',
    md: '0 8px 24px rgb(16 24 40 / 0.08)', // sheets, popovers, FAB only
  },
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
});
