import { describe, expect, it } from 'vitest';
import {
  accountDayHeader,
  balanceChartModel,
  changeBadge,
  formatAxisMinor,
} from '../src/lib/accountDetail';
import type { ApiAccount, ApiTransaction } from '../src/lib/api';
import { describeTransaction } from '../src/lib/transactions';

describe('changeBadge', () => {
  const b = (start: string, end: string, cur = 'IDR') => changeBadge(start, end, cur);

  it('percent up / down, rounded to a whole percent', () => {
    expect(b('100000000', '112000000')).toMatchObject({ kind: 'pct', pct: 12, direction: 'up' });
    expect(b('100000000', '75000000')).toMatchObject({ kind: 'pct', pct: -25, direction: 'down' });
  });

  it('no change is "0%" and flat', () => {
    expect(b('500', '500')).toEqual({ kind: 'zero', direction: 'flat', label: '0%' });
    expect(b('0', '0')).toMatchObject({ kind: 'zero', label: '0%' });
  });

  it('start 0: absolute change, no percent', () => {
    const r = b('0', '120000000');
    expect(r).toMatchObject({ kind: 'abs', direction: 'up', label: '+Rp1,2 jt' });
  });

  it('tiny start (< 1% of end, or < 1 currency unit): absolute change', () => {
    expect(b('50000', '120000000')).toMatchObject({ kind: 'abs', direction: 'up' }); // Rp500 vs Rp1,2jt
    expect(b('50', '200')).toMatchObject({ kind: 'abs' }); // under Rp1
  });

  it('negative start uses |start| as the base; direction follows the sign of the change', () => {
    // -1.000.000 -> -500.000: improved by 50%
    expect(b('-100000000', '-50000000')).toMatchObject({ kind: 'pct', pct: 50, direction: 'up' });
    expect(b('-100000000', '-150000000')).toMatchObject({
      kind: 'pct',
      pct: -50,
      direction: 'down',
    });
  });

  it('clamps absurd percentages', () => {
    const c = b('1000000', '100000000'); // start is exactly 1% of end: +9900%
    expect(c).toMatchObject({ kind: 'pct', pct: 999, clamped: true, label: '+999%+' });
  });

  it('a nonzero change that rounds to 0% reads "<1%"', () => {
    expect(b('1000000000', '1001000000')).toMatchObject({ kind: 'pct', label: '+<1%' });
  });

  it('labels carry the sign; down-percent uses a real minus', () => {
    expect(b('100000000', '75000000').label).toBe('−25%');
    expect(b('100000000', '112000000').label).toBe('+12%');
  });

  it('foreign currency absolute change uses the currency format', () => {
    expect(b('0', '12345', 'USD').label).toBe('+US$123,45');
  });
});

describe('accountDayHeader', () => {
  const today = '2026-11-01';
  it('Hari ini / Kemarin', () => {
    expect(accountDayHeader('2026-11-01', today)).toBe('Hari ini');
    expect(accountDayHeader('2026-10-31', today)).toBe('Kemarin');
  });
  it('day + Indonesian month, year only when not the current year', () => {
    expect(accountDayHeader('2026-10-22', today)).toBe('22 Oktober');
    expect(accountDayHeader('2025-10-22', today)).toBe('22 Oktober 2025');
    expect(accountDayHeader('2026-01-05', today)).toBe('5 Januari');
  });
});

describe('formatAxisMinor', () => {
  it('compact, Indonesian decimal comma', () => {
    expect(formatAxisMinor('120000000', 2)).toBe('1,2 jt');
    expect(formatAxisMinor('35000000', 2)).toBe('350 rb');
    expect(formatAxisMinor('50000', 2)).toBe('500');
    expect(formatAxisMinor('-250000000000', 2)).toBe('−2,5 M');
    expect(formatAxisMinor('0', 2)).toBe('0');
  });
});

describe('balanceChartModel', () => {
  const dates = (n: number) =>
    Array.from({ length: n }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
  const pts = (vals: string[]) =>
    dates(vals.length).map((date, i) => ({ date, balance_minor: vals[i]! }));

  it('x ticks: ~5, dd/MM, last is "Hari ini"', () => {
    const m = balanceChartModel(pts(Array(31).fill('100')), 2);
    expect(m.xTicks).toHaveLength(5);
    expect(m.xTicks[0]).toMatchObject({ label: '01/10', leftPct: 0 });
    expect(m.xTicks.at(-1)).toMatchObject({ label: 'Hari ini', leftPct: 100 });
  });

  it('flat series: one y tick, line centered', () => {
    const m = balanceChartModel(pts(Array(5).fill('100000')), 2);
    expect(m.yTicks).toHaveLength(1);
    expect(m.last.topPct).toBe(50);
  });

  it('higher balance = smaller top%; step path is horizontal then vertical', () => {
    const m = balanceChartModel(pts(['0', '10000000', '10000000']), 2);
    expect(m.last.topPct).toBeLessThan(50);
    expect(m.line.startsWith('M0,')).toBe(true);
    expect(m.line).toContain('H50');
    expect(m.line).toContain('V');
    expect(m.yTicks.map((t) => t.label)).toEqual(['100 rb', '50 rb', '0']);
  });

  it('single point does not crash', () => {
    const m = balanceChartModel(pts(['5']), 2);
    expect(m.xTicks).toHaveLength(1);
  });
});

describe('transfer sign relative to the viewed account', () => {
  const acc = (id: string, name: string) => [id, { name }] as const;
  const accounts = new Map([acc('a', 'BCA'), acc('b', 'Dompet')]);
  const cats = new Map();
  const tx = (over: Partial<ApiTransaction> = {}): ApiTransaction => ({
    id: 't',
    occurred_at: '2026-10-22T05:00:00+07:00',
    kind: 'transfer',
    payee: null,
    note: null,
    status: 'posted',
    source: 'web',
    archived_at: null,
    tag_ids: [],
    entries: [
      {
        id: 'e1',
        account_id: 'a',
        category_id: null,
        amount_minor: '-5000000',
        currency: 'IDR',
        fx_rate: null,
        is_fee: false,
      },
      {
        id: 'e2',
        account_id: 'b',
        category_id: null,
        amount_minor: '5000000',
        currency: 'IDR',
        fx_rate: null,
        is_fee: false,
      },
    ],
    ...over,
  });

  it('outgoing leg is negative and neutral; "Transfer keluar" with route', () => {
    const m = describeTransaction(tx(), accounts, cats, undefined, 'a');
    expect(m.title).toBe('Transfer keluar');
    expect(m.route).toEqual({ from: 'BCA', to: 'Dompet' });
    expect(m.amount).toEqual({ minor: '-5000000', currency: 'IDR', tone: 'neutral' });
  });

  it('incoming leg is positive (income tone) and carries no fee', () => {
    const t = tx();
    t.entries.push({
      id: 'e3',
      account_id: 'a',
      category_id: 'c',
      amount_minor: '-250000',
      currency: 'IDR',
      fx_rate: null,
      is_fee: true,
    });
    const m = describeTransaction(t, accounts, cats, undefined, 'b');
    expect(m.title).toBe('Transfer masuk');
    expect(m.amount).toEqual({ minor: '5000000', currency: 'IDR', tone: 'income' });
    expect(m.feeMinor).toBeNull();
    expect(describeTransaction(t, accounts, cats, undefined, 'a').feeMinor).toBe('250000');
  });

  it('without a viewed account the old behavior stays (magnitude, dimmed)', () => {
    expect(describeTransaction(tx(), accounts, cats).amount.tone).toBe('dimmed');
  });

  it('cross-currency: each side shows its own leg', () => {
    const t = tx();
    t.entries[1] = { ...t.entries[1]!, amount_minor: '31000', currency: 'USD' };
    const m = describeTransaction(t, accounts, cats, undefined, 'b');
    expect(m.amount).toEqual({ minor: '31000', currency: 'USD', tone: 'income' });
  });
});

// type-only guard that ApiAccount is still what the page needs
export type _A = Pick<ApiAccount, 'id' | 'name' | 'currency'>;
