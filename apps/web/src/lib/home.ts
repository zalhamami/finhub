/** Pure logic for Beranda (home): month switching, spending comparison text, sparkline geometry. */
import { dayjs } from './dayjs';
import { daysInMonth, ymd } from './dates';

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-11" -> "November 2026" */
export const monthLabel = (month: string): string => dayjs(`${month}-01`).format('MMMM YYYY');

export function shiftMonth(month: string, delta: number): string {
  const y = Number(month.slice(0, 4));
  const idx = y * 12 + (Number(month.slice(5, 7)) - 1) + delta;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

/** Months after the current Jakarta month are not selectable. */
export const canGoNext = (month: string, today: string): boolean => month < today.slice(0, 7);

/** Rounded integer percent change from `prev` to `cur`; null when there is no base to compare to. */
export function changePct(cur: bigint, prev: bigint): number | null {
  if (prev === 0n) return null;
  const abs = prev < 0n ? -prev : prev;
  const diff = (cur - prev) * (prev < 0n ? -1n : 1n);
  // round half away from zero, to a whole percent
  const q = (diff * 100n * 2n + (diff < 0n ? -abs : abs)) / (abs * 2n);
  return Number(q);
}

const UNITS: [bigint, string][] = [
  [1_000_000_000n, ' M'],
  [1_000_000n, ' jt'],
  [1_000n, ' rb'],
];

/**
 * Short rupiah for sentences: "Rp1,2 jt", "Rp350 rb", "Rp500". Magnitude only (sign dropped).
 * `minor` is IDR minor units (2 decimals). Money stays bigint.
 */
export function formatCompact(minor: string): string {
  let n = BigInt(minor);
  if (n < 0n) n = -n;
  const rupiah = n / 100n;
  for (const [unit, suffix] of UNITS) {
    if (rupiah >= unit) {
      const tenths = (rupiah * 10n + unit / 2n) / unit; // one decimal, half up
      const whole = tenths / 10n;
      const frac = tenths % 10n;
      return `Rp${whole}${frac ? `,${frac}` : ''}${suffix}`;
    }
  }
  return `Rp${rupiah}`;
}

export interface PaceHint {
  text: string;
  /** over = spending faster than last month at the same day (the only place clay is used) */
  tone: 'better' | 'over' | 'same';
}

/** Sentence for "this month's expense minus last month's expense through the same day". */
export function paceHint(vsPreviousToDateMinor: string, isCurrentMonth: boolean): PaceHint {
  const v = BigInt(vsPreviousToDateMinor);
  const than = `${isCurrentMonth ? 'bulan lalu' : 'bulan sebelumnya'} di tanggal yang sama`;
  if (v === 0n) return { text: `Sama dengan ${than}`, tone: 'same' };
  return v < 0n
    ? { text: `${formatCompact(vsPreviousToDateMinor)} lebih hemat dari ${than}`, tone: 'better' }
    : { text: `${formatCompact(vsPreviousToDateMinor)} lebih boros dari ${than}`, tone: 'over' };
}

/** /transaksi search params: one category over a whole calendar month. */
export function categoryLink(categoryId: string, month: string) {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return { category: categoryId, from: ymd(y, m, 1), to: ymd(y, m, daysInMonth(y, m)) };
}

export interface Sparkline {
  points: { x: number; y: number }[];
  /** SVG path "M x,y L x,y ..." */
  path: string;
}

/**
 * Polyline for a series of minor-unit strings in a w x h box with `padding`. Higher = smaller y.
 * Offsets are computed in bigint, only the final ratio is a float (geometry, not money).
 */
export function sparkline(values: readonly string[], w: number, h: number, padding = 0): Sparkline {
  if (values.length === 0) return { points: [], path: '' };
  const v = values.map((x) => BigInt(x));
  const min = v.reduce((a, b) => (b < a ? b : a));
  const max = v.reduce((a, b) => (b > a ? b : a));
  const range = max - min;
  const innerW = w - 2 * padding;
  const innerH = h - 2 * padding;
  const points = v.map((x, i) => ({
    x: v.length === 1 ? w / 2 : padding + (innerW * i) / (v.length - 1),
    y:
      range === 0n
        ? h / 2
        : padding + innerH * (1 - Number(((x - min) * 1_000_000n) / range) / 1_000_000),
  }));
  return { points, path: points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ') };
}
