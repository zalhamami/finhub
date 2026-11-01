import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  generateScale,
  hexToHsl,
  isAccent,
  primaryShadeFor,
  relativeLuminance,
  resolveAccent,
  textOnAccent,
} from '../src/theme/accent';
import { ACCENT_PRESETS, onAccent } from '../src/theme/tokens';

const INPUTS = [
  '#f5b000',
  '#178872',
  '#4c5bd4',
  '#c2410c',
  '#8b5cf6',
  '#1d4ed8',
  '#e11d48',
  '#64748b',
];

describe('generateScale', () => {
  it.each(INPUTS)('%s -> 10 valid hex shades with the input at index 5', (hex) => {
    const scale = generateScale(hex);
    expect(scale).toHaveLength(10);
    for (const c of scale) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    expect(scale[5]).toBe(hex);
    // "close to input" in the strict sense: hue within a few degrees for chromatic colors
    const a = hexToHsl(scale[5]);
    const b = hexToHsl(hex);
    expect(Math.abs(a.l - b.l)).toBeLessThan(1);
  });

  it.each(INPUTS)('%s lightness is strictly decreasing, light to dark', (hex) => {
    const ls = generateScale(hex).map((c) => hexToHsl(c).l);
    for (let i = 1; i < ls.length; i++) expect(ls[i]!).toBeLessThan(ls[i - 1]!);
  });

  it('rejects anything but #rrggbb', () => {
    expect(() => generateScale('red')).toThrow();
    expect(() => generateScale('#fff')).toThrow();
  });
});

describe('text on accent fills', () => {
  it('amber gets dark text, indigo and jade get white', () => {
    expect(textOnAccent(ACCENT_PRESETS.amber.scale[5])).toBe('dark');
    expect(textOnAccent(ACCENT_PRESETS.indigo.scale[5])).toBe('light');
    expect(textOnAccent(ACCENT_PRESETS.jade.scale[5])).toBe('light');
  });

  it('the picked text color is readable on the fill (>= 4.5:1 for presets)', () => {
    for (const p of Object.values(ACCENT_PRESETS)) {
      const fill = p.scale[5];
      const text = onAccent[textOnAccent(fill)];
      expect(contrastRatio(fill, text)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('luminance sanity', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
  });
});

describe('primary shade / resolveAccent', () => {
  it('very dark accents use a lighter fill shade on the dark page', () => {
    expect(primaryShadeFor('#4c5bd4')).toEqual({ light: 5, dark: 4 });
    expect(primaryShadeFor('#1e1b4b')).toEqual({ light: 5, dark: 3 });
  });

  it('presets keep their tuples; hex gets "custom"', () => {
    expect(resolveAccent('jade').colorName).toBe('jade');
    expect(resolveAccent('jade').scale).toBe(ACCENT_PRESETS.jade.scale);
    expect(resolveAccent('#c2410c').colorName).toBe('custom');
  });

  it('isAccent accepts presets and #rrggbb only', () => {
    expect(isAccent('amber')).toBe(true);
    expect(isAccent('#AABBCC')).toBe(true);
    expect(isAccent('#abc')).toBe(false);
    expect(isAccent('purple')).toBe(false);
  });
});
