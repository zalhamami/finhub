import { describe, expect, it } from 'vitest';
import {
  compareMonths,
  daysInMonth,
  historyDates,
  monthBounds,
  pricesForDate,
  prevMonth,
  topExpenseCategories,
  type Flow,
  type PricePoint,
} from './index';

const f = (
  date: string,
  kind: 'income' | 'expense',
  amountMinor: bigint,
  categoryId: string | null = null,
): Flow => ({ date, kind, amountMinor, categoryId });

describe('month helpers', () => {
  it('prevMonth crosses year, daysInMonth handles leap years', () => {
    expect(prevMonth('2026-01')).toBe('2025-12');
    expect(prevMonth('2026-11')).toBe('2026-10');
    expect(daysInMonth('2024-02')).toBe(29);
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2026-11')).toBe(30);
  });
  it('monthBounds is inclusive start / exclusive end', () => {
    expect(monthBounds('2026-12')).toEqual({ start: '2026-12-01', endExclusive: '2027-01-01' });
  });
});

describe('compareMonths', () => {
  const flows = [
    f('2026-10-02', 'expense', 100n),
    f('2026-10-20', 'expense', 400n), // after the compare day
    f('2026-10-31', 'income', 1000n),
    f('2026-11-01', 'expense', 150n),
    f('2026-11-03', 'income', 500n),
    f('2026-09-30', 'expense', 999n), // outside both months
  ];
  it('current month: pace compares up to today’s day of the previous month', () => {
    const r = compareMonths(flows, '2026-11', '2026-11-03');
    expect(r.compareDay).toBe(3);
    expect(r.current).toEqual({ incomeMinor: 500n, expenseMinor: 150n, netMinor: 350n });
    expect(r.previous).toEqual({ incomeMinor: 1000n, expenseMinor: 500n, netMinor: 500n });
    expect(r.previousExpenseToDateMinor).toBe(100n);
    expect(r.expenseVsPreviousToDateMinor).toBe(50n); // spent 50 more than at the same day
  });
  it('past month compares the whole month, clamped to the shorter previous month', () => {
    const r = compareMonths(flows, '2026-10', '2026-11-03');
    expect(r.compareDay).toBe(31);
    expect(r.previous.expenseMinor).toBe(999n);
    expect(r.previousExpenseToDateMinor).toBe(999n); // Sep has 30 days, all included
    expect(r.expenseVsPreviousToDateMinor).toBe(500n - 999n);
  });
  it('empty data is all zero', () => {
    const r = compareMonths([], '2026-11', '2026-11-15');
    expect(r.current.netMinor).toBe(0n);
    expect(r.expenseVsPreviousToDateMinor).toBe(0n);
  });
  it('refunds (negative expense) reduce expense', () => {
    const r = compareMonths(
      [f('2026-11-02', 'expense', -30n), f('2026-11-02', 'expense', 100n)],
      '2026-11',
      '2026-11-05',
    );
    expect(r.current.expenseMinor).toBe(70n);
  });
});

describe('topExpenseCategories', () => {
  const parent = new Map<string, string | null>([
    ['food', null],
    ['coffee', 'food'],
    ['rent', null],
    ['fun', null],
    ['gym', null],
    ['bus', null],
    ['gift', null],
  ]);
  it('rolls children up, ranks, top N + Lainnya, with shares and previous amounts', () => {
    const flows = [
      f('2026-11-01', 'expense', 300n, 'food'),
      f('2026-11-02', 'expense', 200n, 'coffee'), // -> food = 500
      f('2026-11-02', 'expense', 400n, 'rent'),
      f('2026-11-03', 'expense', 50n, 'fun'),
      f('2026-11-03', 'expense', 40n, 'gym'),
      f('2026-11-03', 'expense', 30n, 'bus'),
      f('2026-11-04', 'expense', 20n, 'gift'),
      f('2026-11-04', 'expense', 10n, null), // uncategorized -> Lainnya
      f('2026-11-04', 'income', 9999n, 'rent'), // ignored
      f('2026-10-05', 'expense', 100n, 'coffee'),
      f('2026-10-06', 'expense', 70n, 'gift'),
      f('2026-10-06', 'expense', 5n, 'fun'),
    ];
    const r = topExpenseCategories(flows, '2026-11', parent, 3);
    expect(r.totalMinor).toBe(1050n);
    expect(r.top.map((x) => [x.categoryId, x.amountMinor, x.previousAmountMinor])).toEqual([
      ['food', 500n, 100n],
      ['rent', 400n, 0n],
      ['fun', 50n, 5n],
    ]);
    expect(r.top[0]!.shareBps).toBe(4762); // 500/1050
    expect(r.other).toEqual({ amountMinor: 100n, previousAmountMinor: 70n, shareBps: 952 });
  });
  it('no other row when everything fits; empty month has no rows', () => {
    const r = topExpenseCategories([f('2026-11-01', 'expense', 10n, 'food')], '2026-11', parent, 5);
    expect(r.other).toBeNull();
    expect(r.top[0]!.shareBps).toBe(10000);
    const e = topExpenseCategories([], '2026-11', parent, 5);
    expect(e).toEqual({ totalMinor: 0n, top: [], other: null });
  });
  it('unknown category ids are treated as their own root; cycles do not hang', () => {
    const cyc = new Map<string, string | null>([
      ['a', 'b'],
      ['b', 'a'],
    ]);
    const r = topExpenseCategories(
      [f('2026-11-01', 'expense', 10n, 'a'), f('2026-11-01', 'expense', 5n, 'zzz')],
      '2026-11',
      cyc,
      5,
    );
    expect(r.top.length).toBe(2);
  });
});

describe('historyDates', () => {
  it('monthly: month ends, last point is today', () => {
    expect(historyDates('2026-11-15', 3, 'month')).toEqual([
      '2026-09-30',
      '2026-10-31',
      '2026-11-15',
    ]);
  });
  it('monthly across a year boundary and a short month', () => {
    expect(historyDates('2026-03-31', 3, 'month')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ]);
  });
  it('weekly: 7-day steps back from today, within the oldest month', () => {
    const d = historyDates('2026-11-15', 1, 'week');
    expect(d).toEqual(['2026-11-01', '2026-11-08', '2026-11-15']);
  });
});

describe('pricesForDate', () => {
  const p = (instrumentId: string, date: string, price: string): PricePoint => ({
    instrumentId,
    date,
    price,
    currency: 'IDR',
  });
  const all = [p('a', '2026-01-01', '10'), p('a', '2026-05-01', '20'), p('b', '2026-05-01', '7')];
  it('keeps prices on/before the date', () => {
    const r = pricesForDate(all, '2026-03-01');
    expect(r.filter((x) => x.instrumentId === 'a').map((x) => x.price)).toEqual(['10']);
  });
  it('instrument with no price yet falls back to its latest known price', () => {
    const r = pricesForDate(all, '2026-03-01');
    const b = r.filter((x) => x.instrumentId === 'b');
    expect(b).toHaveLength(1);
    expect(b[0]!.price).toBe('7');
    expect(b[0]!.date <= '2026-03-01').toBe(true);
  });
});
