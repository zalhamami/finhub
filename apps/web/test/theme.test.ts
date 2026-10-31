import { describe, expect, it } from 'vitest';
import { amber, theme } from '../src/theme/theme';

describe('theme', () => {
  it('uses the amber primary with dark text on fills', () => {
    expect(theme.primaryColor).toBe('amber');
    expect(theme.primaryShade).toEqual({ light: 5, dark: 4 });
    expect(theme.autoContrast).toBe(true);
    expect(theme.luminanceThreshold).toBe(0.3);
    expect(theme.colors?.amber).toBe(amber);
    expect(amber).toHaveLength(10);
    expect(amber[5]).toBe('#f5b000');
    expect(theme.colors?.income).toHaveLength(10);
    expect(theme.colors?.expense).toHaveLength(10);
    expect(theme.defaultRadius).toBe('md');
  });
});
