import { describe, expect, it } from 'vitest';
import {
  MissingPriceError,
  MissingRateError,
  convertMinor,
  netWorth,
  pickRate,
  type NetWorthAccount,
  type ValuationContext,
} from './index';

const IDR = { code: 'IDR', minorUnit: 2 };
const USD = { code: 'USD', minorUnit: 2 };
const JPY = { code: 'JPY', minorUnit: 0 };

describe('pickRate', () => {
  const rates = [
    { base: 'USD', quote: 'IDR', date: '2026-01-01', rate: '16000' },
    { base: 'USD', quote: 'IDR', date: '2026-02-01', rate: '16500' },
    { base: 'USD', quote: 'IDR', date: '2026-03-01', rate: '17000' },
  ];
  it('is identity for same currency without any data', () => {
    expect(pickRate([], 'IDR', 'IDR', '2026-01-01').toString()).toBe('1');
  });
  it('picks latest on or before the date (inclusive)', () => {
    expect(pickRate(rates, 'USD', 'IDR', '2026-02-01').toString()).toBe('16500');
    expect(pickRate(rates, 'USD', 'IDR', '2026-02-28').toString()).toBe('16500');
    expect(pickRate(rates, 'USD', 'IDR', '2026-12-31').toString()).toBe('17000');
  });
  it('errors when only future rates exist', () => {
    expect(() => pickRate(rates, 'USD', 'IDR', '2025-12-31')).toThrow(MissingRateError);
  });
  it('uses the inverse rate', () => {
    expect(pickRate(rates, 'IDR', 'USD', '2026-01-15').mul(16000).toString()).toBe('1');
  });
  it('prefers the more recent of direct/inverse, direct on ties', () => {
    const mixed = [
      { base: 'USD', quote: 'IDR', date: '2026-01-01', rate: '16000' },
      { base: 'IDR', quote: 'USD', date: '2026-02-01', rate: '0.00005' },
    ];
    expect(pickRate(mixed, 'USD', 'IDR', '2026-03-01').toString()).toBe('20000');
    const tie = [
      { base: 'USD', quote: 'IDR', date: '2026-01-01', rate: '16000' },
      { base: 'IDR', quote: 'USD', date: '2026-01-01', rate: '0.00005' },
    ];
    expect(pickRate(tie, 'USD', 'IDR', '2026-03-01').toString()).toBe('16000');
  });
  it('error names the pair and date', () => {
    expect(() => pickRate([], 'SGD', 'IDR', '2026-05-05')).toThrow(
      'No FX rate for SGD/IDR on or before 2026-05-05',
    );
  });
});

describe('convertMinor', () => {
  it('converts USD cents to IDR minor', () => {
    expect(convertMinor(1050n, USD, IDR, '16000')).toBe(16_800_000n); // $10.50 -> Rp168.000
  });
  it('handles different minor units', () => {
    expect(convertMinor(1000n, JPY, IDR, '110.5')).toBe(11_050_000n); // ¥1000 -> Rp110.500
    expect(convertMinor(11_050_000n, IDR, JPY, '0.009049773755656108597285067873')).toBe(1000n);
  });
  it('rounds half-even once at the end', () => {
    // 5 cents * 0.5 = 2.5 minor -> 2 ; 7 * 0.5 = 3.5 -> 4 ; negatives symmetric
    expect(convertMinor(5n, USD, IDR, '0.5')).toBe(2n);
    expect(convertMinor(7n, USD, IDR, '0.5')).toBe(4n);
    expect(convertMinor(-5n, USD, IDR, '0.5')).toBe(-2n);
    expect(convertMinor(-7n, USD, IDR, '0.5')).toBe(-4n);
    expect(convertMinor(3n, USD, JPY, '0.5')).toBe(0n); // 0.03*0.5=0.015 yen -> 0
  });
  it('is exact for huge values', () => {
    expect(convertMinor(900719925474099300n, IDR, IDR, '1')).toBe(900719925474099300n);
  });
});

const ctx = (over: Partial<ValuationContext> = {}): ValuationContext => ({
  baseCurrency: 'IDR',
  date: '2026-06-30',
  currencies: [IDR, USD],
  fxRates: [{ base: 'USD', quote: 'IDR', date: '2026-06-01', rate: '16000' }],
  prices: [],
  ...over,
});
const acct = (over: Partial<NetWorthAccount>): NetWorthAccount => ({
  id: 'a',
  kind: 'bank',
  currency: 'IDR',
  balanceMinor: 0n,
  includeInNetWorth: true,
  archived: false,
  ...over,
});

describe('netWorth', () => {
  it('sums IDR accounts, USD account converted, liability negative', () => {
    const r = netWorth(
      [
        acct({ id: 'bank', balanceMinor: 1_000_000_00n }),
        acct({ id: 'cash', kind: 'cash', balanceMinor: 50_000_00n }),
        acct({ id: 'usd', currency: 'USD', balanceMinor: 100_00n }), // $100 = Rp1.600.000
        acct({ id: 'cc', kind: 'liability', balanceMinor: 300_000_00n }), // owed-positive
        acct({ id: 'loan', kind: 'liability', balanceMinor: -200_000_00n }), // ledger-negative
      ],
      ctx(),
    );
    expect(r.assetsMinor).toBe(1_000_000_00n + 50_000_00n + 1_600_000_00n);
    expect(r.liabilitiesMinor).toBe(-500_000_00n);
    expect(r.netWorthMinor).toBe(r.assetsMinor + r.liabilitiesMinor);
    expect(r.byKind).toEqual({
      cash: 50_000_00n,
      bank: 2_600_000_00n,
      ewallet: 0n,
      investment: 0n,
      liability: -500_000_00n,
    });
    expect(r.perAccount.usd).toBe(1_600_000_00n);
  });

  it('skips archived and excluded accounts', () => {
    const r = netWorth(
      [
        acct({ id: '1', balanceMinor: 100n }),
        acct({ id: '2', balanceMinor: 900n, archived: true }),
        acct({ id: '3', balanceMinor: 900n, includeInNetWorth: false }),
        acct({ id: '4', kind: 'liability', balanceMinor: 50n, archived: true }),
      ],
      // skipped accounts must not even need rates
      ctx({ fxRates: [] }),
    );
    expect(r.netWorthMinor).toBe(100n);
    expect(r.liabilitiesMinor).toBe(0n);
  });

  it('values investment accounts as cash + holdings x price x fx', () => {
    const r = netWorth(
      [
        acct({
          id: 'inv',
          kind: 'investment',
          balanceMinor: 1_000_00n,
          holdings: [
            { instrumentId: 'BBCA', units: '100' }, // 100 x Rp9.000 = Rp900.000
            { instrumentId: 'AAPL', units: '2.5' }, // 2.5 x $200 x 16000 = Rp8.000.000
          ],
        }),
      ],
      ctx({
        prices: [
          { instrumentId: 'BBCA', date: '2026-06-01', price: '8000', currency: 'IDR' },
          { instrumentId: 'BBCA', date: '2026-06-20', price: '9000', currency: 'IDR' },
          { instrumentId: 'BBCA', date: '2026-07-01', price: '99999', currency: 'IDR' }, // future
          { instrumentId: 'AAPL', date: '2026-06-29', price: '200', currency: 'USD' },
        ],
      }),
    );
    expect(r.byKind.investment).toBe(1_000_00n + 900_000_00n + 8_000_000_00n);
    expect(r.assetsMinor).toBe(r.byKind.investment);
  });

  it('ignores holdings on non-investment accounts', () => {
    const r = netWorth(
      [acct({ balanceMinor: 100n, holdings: [{ instrumentId: 'X', units: '1' }] })],
      ctx(),
    );
    expect(r.netWorthMinor).toBe(100n);
  });

  it('rounds once for the whole investment account, not per holding', () => {
    // each holding = 0.005 IDR = 0.5 minor; per-holding half-even rounding would give 0+0,
    // a single rounding of the 1.5 minor total gives 2.
    const r = netWorth(
      [
        acct({
          kind: 'investment',
          holdings: [
            { instrumentId: 'A', units: '1' },
            { instrumentId: 'B', units: '1' },
            { instrumentId: 'C', units: '1' },
          ],
        }),
      ],
      ctx({
        prices: ['A', 'B', 'C'].map((i) => ({
          instrumentId: i,
          date: '2026-01-01',
          price: '0.005',
          currency: 'IDR',
        })),
      }),
    );
    expect(r.byKind.investment).toBe(2n);
  });

  it('rounding edge: half-even on converted balance', () => {
    const c = ctx({ fxRates: [{ base: 'USD', quote: 'IDR', date: '2026-01-01', rate: '0.5' }] });
    expect(netWorth([acct({ currency: 'USD', balanceMinor: 5n })], c).netWorthMinor).toBe(2n);
    expect(netWorth([acct({ currency: 'USD', balanceMinor: 7n })], c).netWorthMinor).toBe(4n);
  });

  it('works with an inverse-only rate', () => {
    const c = ctx({
      fxRates: [{ base: 'IDR', quote: 'USD', date: '2026-01-01', rate: '0.0000625' }],
    });
    expect(netWorth([acct({ currency: 'USD', balanceMinor: 100_00n })], c).netWorthMinor).toBe(
      1_600_000_00n,
    );
  });

  it('errors clearly on a missing rate for a counted account', () => {
    expect(() =>
      netWorth([acct({ currency: 'USD', balanceMinor: 1n })], ctx({ fxRates: [] })),
    ).toThrow(MissingRateError);
  });

  it('errors on a missing price', () => {
    expect(() =>
      netWorth(
        [acct({ kind: 'investment', holdings: [{ instrumentId: 'Z', units: '1' }] })],
        ctx(),
      ),
    ).toThrow(MissingPriceError);
  });
});
