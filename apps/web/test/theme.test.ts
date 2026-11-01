import { describe, expect, it } from 'vitest';
import { createFinhubTheme, theme } from '../src/theme/theme';
import { ACCENT_PRESETS, DEFAULT_ACCENT, amber, income, overspend } from '../src/theme/tokens';

describe('theme', () => {
  it('defaults to the amber accent with dark text on fills', () => {
    expect(DEFAULT_ACCENT).toBe('amber');
    expect(theme.primaryColor).toBe('amber');
    expect(theme.primaryShade).toEqual({ light: 5, dark: 4 });
    expect(theme.autoContrast).toBe(true);
    expect(theme.luminanceThreshold).toBe(0.3);
    expect(theme.colors?.amber).toBe(amber);
    expect(amber[5]).toBe('#f5b000');
    expect(theme.colors?.income).toBe(income);
    expect(theme.colors?.expense).toBe(overspend);
    expect(theme.defaultRadius).toBe('md');
  });

  it('every preset is a 10-shade tuple registered in the theme', () => {
    for (const [name, p] of Object.entries(ACCENT_PRESETS)) {
      expect(p.scale).toHaveLength(10);
      expect(createFinhubTheme({ accent: name as 'amber' }).colors?.[name]).toBe(p.scale);
    }
  });

  it('a preset accent changes primaryColor', () => {
    expect(createFinhubTheme({ accent: 'jade' }).primaryColor).toBe('jade');
    expect(createFinhubTheme({ accent: 'indigo' }).primaryColor).toBe('indigo');
  });

  it('a custom hex becomes a generated "custom" scale', () => {
    const t = createFinhubTheme({ accent: '#c2410c' });
    expect(t.primaryColor).toBe('custom');
    expect(t.colors?.custom).toHaveLength(10);
    expect(t.colors?.custom?.[5]).toBe('#c2410c');
  });
});
