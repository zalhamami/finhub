import type { MantineColorShade, MantineColorsTuple } from '@mantine/core';
import { ACCENT_PRESETS, DEFAULT_ACCENT, type AccentPresetName } from './tokens';

/** An accent is a preset name or a custom #rrggbb color. */
export type Accent = AccentPresetName | `#${string}`;

export const HEX_RE = /^#[0-9a-f]{6}$/i;
export const isHex = (s: string): s is `#${string}` => HEX_RE.test(s);
export const isPreset = (s: string): s is AccentPresetName => s in ACCENT_PRESETS;
export const isAccent = (s: unknown): s is Accent =>
  typeof s === 'string' && (isPreset(s) || isHex(s));

/** Mantine's autoContrast threshold: fills lighter than this get dark text, darker ones white. */
export const LUMINANCE_THRESHOLD = 0.3;

/* ---------- color math (no dependencies) ---------- */

type Rgb = [number, number, number]; // 0..255

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex([r, g, b]: Rgb): string {
  const h = (x: number) =>
    Math.round(Math.min(255, Math.max(0, x)))
      .toString(16)
      .padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** h 0..360, s and l 0..100 */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = hexToRgb(hex).map((x) => x / 255) as Rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: s * 100, l: l * 100 };
}

export function hslToHex(h: number, s: number, l: number): string {
  const S = s / 100;
  const L = l / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = L - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return rgbToHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
}

/** WCAG relative luminance, 0 (black) .. 1 (white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((x) => {
    const c = x / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

/* ---------- scale generation ---------- */

/**
 * 10-shade Mantine tuple, lightest -> darkest, with the input color at index 5 (the fill shade in
 * light mode). Hue and saturation follow the input; lightness ramps linearly from a near-white
 * tint down to about half the input's lightness, so lightness is strictly monotonic.
 */
export function generateScale(hex: string): MantineColorsTuple {
  if (!isHex(hex)) throw new Error(`generateScale: expected #rrggbb, got "${hex}"`);
  const { h, s, l } = hexToHsl(hex);
  const base = Math.min(Math.max(l, 25), 85); // keep room on both sides of the ramp
  const top = 96;
  const bottom = Math.max(base * 0.5, 12);
  const out: string[] = [];
  for (let i = 0; i < 10; i++) {
    if (i === 5) {
      out.push(hex.toLowerCase());
      continue;
    }
    const light = i < 5;
    const L = light ? top + (base - top) * (i / 5) : base + (bottom - base) * ((i - 5) / 4);
    // pale tints look muddy at full saturation; ease it down toward the light end
    const S = light ? s * (0.35 + 0.65 * (i / 5)) : s;
    out.push(hslToHex(h, S, L));
  }
  return out as unknown as MantineColorsTuple;
}

/** Which text color sits on an accent fill: dark on light accents (amber), white on dark ones (indigo). */
export function textOnAccent(fillHex: string): 'dark' | 'light' {
  return relativeLuminance(fillHex) > LUMINANCE_THRESHOLD ? 'dark' : 'light';
}

/** Fill shade per color scheme. Very dark accents need a lighter fill on the dark page. */
export function primaryShadeFor(hex: string): {
  light: MantineColorShade;
  dark: MantineColorShade;
} {
  return { light: 5, dark: hexToHsl(hex).l < 40 ? 3 : 4 };
}

/* ---------- accent resolution + persistence ---------- */

export interface ResolvedAccent {
  /** key in theme.colors (a preset name, or "custom") */
  colorName: string;
  scale: MantineColorsTuple;
  primaryShade: { light: MantineColorShade; dark: MantineColorShade };
}

export function resolveAccent(accent: Accent): ResolvedAccent {
  if (isPreset(accent)) {
    return {
      colorName: accent,
      scale: ACCENT_PRESETS[accent].scale,
      primaryShade: { light: 5, dark: 4 },
    };
  }
  return {
    colorName: 'custom',
    scale: generateScale(accent),
    primaryShade: primaryShadeFor(accent),
  };
}

const STORAGE_KEY = 'finhub.accent';

/** Last accent seen on this device, so the first paint matches; falls back to the default. */
export function readStoredAccent(): Accent {
  try {
    const v = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (v && isAccent(v)) return v.toLowerCase() as Accent;
  } catch {
    // storage unavailable (private mode)
  }
  return DEFAULT_ACCENT;
}

export function storeAccent(accent: Accent): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, accent);
  } catch {
    // ignore
  }
}
