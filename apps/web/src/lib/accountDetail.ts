/** Pure logic for the account detail page: change badge, day headers, balance chart geometry. */
import type { AccountBalanceHistory } from './api';
import { formatCompact } from './home';
import { dayjs } from './dayjs';
import { addDays } from './dates';
import { formatMinorCurrency, minorUnitOf } from './money';

const MINUS = '−';
/** Percentages beyond this are shown as "999%+". */
const PCT_CLAMP = 999;

export interface ChangeBadge {
  /** pct: percent vs the start; abs: amount only (no usable base); zero: nothing changed */
  kind: 'pct' | 'abs' | 'zero';
  direction: 'up' | 'down' | 'flat';
  label: string;
  pct?: number;
  clamped?: boolean;
}

const abs = (n: bigint) => (n < 0n ? -n : n);

/**
 * Change from the balance 30 days ago (`start`) to now (`end`), both minor-unit strings.
 * No percent when the start is 0, under 1 currency unit, or under 1% of the end balance (it would
 * only say "+48000%"): the absolute change is shown instead. A negative start uses |start|.
 */
export function changeBadge(start: string, end: string, currency: string): ChangeBadge {
  const s = BigInt(start);
  const e = BigInt(end);
  const diff = e - s;
  if (diff === 0n) return { kind: 'zero', direction: 'flat', label: '0%' };
  const direction = diff > 0n ? 'up' : 'down';
  const sign = diff > 0n ? '+' : MINUS;
  const unit = 10n ** BigInt(minorUnitOf(currency));
  if (s === 0n || abs(s) < unit || abs(s) * 100n < abs(e)) {
    const amount =
      currency === 'IDR'
        ? formatCompact(abs(diff).toString())
        : formatMinorCurrency(abs(diff).toString(), currency);
    return { kind: 'abs', direction, label: `${sign}${amount}` };
  }
  // change / |start|, rounded half away from zero to a whole percent
  const base = abs(s);
  const pct = Number((diff * 200n + (diff < 0n ? -base : base)) / (base * 2n));
  if (pct === 0) return { kind: 'pct', direction, pct: 0, label: `${sign}<1%` };
  if (Math.abs(pct) > PCT_CLAMP) {
    return {
      kind: 'pct',
      direction,
      pct: pct > 0 ? PCT_CLAMP : -PCT_CLAMP,
      clamped: true,
      label: `${sign}${PCT_CLAMP}%+`,
    };
  }
  return { kind: 'pct', direction, pct, label: `${sign}${Math.abs(pct)}%` };
}

/** "Hari ini" / "Kemarin" / "22 Oktober" (+ year when not the current year). */
export function accountDayHeader(date: string, today: string): string {
  if (date === today) return 'Hari ini';
  if (date === addDays(today, -1)) return 'Kemarin';
  const d = dayjs(date);
  return d.format(date.slice(0, 4) === today.slice(0, 4) ? 'D MMMM' : 'D MMMM YYYY');
}

const AXIS_UNITS: [bigint, string][] = [
  [1_000_000_000n, ' M'],
  [1_000_000n, ' jt'],
  [1_000n, ' rb'],
];

/** Axis label without a currency symbol: "1,2 jt", "350 rb", "500", "−2,5 M". */
export function formatAxisMinor(minor: string, minorUnit: number): string {
  const n = BigInt(minor);
  const units = abs(n) / 10n ** BigInt(minorUnit);
  const sign = n < 0n ? MINUS : '';
  for (const [unit, suffix] of AXIS_UNITS) {
    if (units >= unit) {
      const tenths = (units * 10n + unit / 2n) / unit;
      const frac = tenths % 10n;
      return `${sign}${tenths / 10n}${frac ? `,${frac}` : ''}${suffix}`;
    }
  }
  return units === 0n ? '0' : `${sign}${units}`;
}

export interface BalanceChartModel {
  /** step line in a 0..100 x 0..100 box (preserveAspectRatio none) */
  line: string;
  area: string;
  yTicks: { topPct: number; label: string }[];
  xTicks: { leftPct: number; label: string; align: 'start' | 'center' | 'end' }[];
  last: { leftPct: number; topPct: number };
}

const PAD_TOP = 10;
const PAD_BOTTOM = 10;
const X_TICKS = 5;
const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Geometry for the balance chart. Money stays bigint (offsets), only the final ratio is a float.
 * The balance holds until the next day, so the line steps; the last point is "Hari ini".
 */
export function balanceChartModel(
  points: AccountBalanceHistory['points'],
  minorUnit: number,
): BalanceChartModel {
  const v = points.map((p) => BigInt(p.balance_minor));
  const n = v.length;
  const min = v.reduce((a, b) => (b < a ? b : a), v[0] ?? 0n);
  const max = v.reduce((a, b) => (b > a ? b : a), v[0] ?? 0n);
  const range = max - min;
  const topOf = (x: bigint) =>
    range === 0n
      ? 50
      : round(
          PAD_TOP +
            (100 - PAD_TOP - PAD_BOTTOM) * (1 - Number(((x - min) * 1_000_000n) / range) / 1e6),
        );
  const leftOf = (i: number) => (n <= 1 ? 100 : round((100 * i) / (n - 1)));
  const xy = v.map((x, i) => ({ x: leftOf(i), y: topOf(x) }));

  let line = '';
  xy.forEach((p, i) => {
    line += i === 0 ? `M${p.x},${p.y}` : ` H${p.x} V${p.y}`;
  });
  const area = n ? `${line} V100 H0 Z` : '';

  const yTicks =
    range === 0n
      ? [{ topPct: 50, label: formatAxisMinor(max.toString(), minorUnit) }]
      : [max, (max + min) / 2n, min].map((x) => ({
          topPct: topOf(x),
          label: formatAxisMinor(x.toString(), minorUnit),
        }));

  const count = Math.min(X_TICKS, n);
  const idx = [
    ...new Set(
      Array.from({ length: count }, (_, k) =>
        count <= 1 ? 0 : Math.round((k * (n - 1)) / (count - 1)),
      ),
    ),
  ];
  const xTicks = idx.map((i, k) => ({
    leftPct: leftOf(i),
    label: i === n - 1 && n > 1 ? 'Hari ini' : dayjs(points[i]!.date).format('DD/MM'),
    align: (k === 0 ? 'start' : k === idx.length - 1 ? 'end' : 'center') as
      'start' | 'center' | 'end',
  }));
  const lastXY = xy.at(-1) ?? { x: 100, y: 50 };
  return { line, area, yTicks, xTicks, last: { leftPct: lastXY.x, topPct: lastXY.y } };
}
