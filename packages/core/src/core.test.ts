import { describe, expect, it } from 'vitest';
import { accountBalance, formatIDR, formatMoney, validateTransaction } from './index';

const e = (amountMinor: bigint, currency = 'IDR', accountId = 'a') => ({
  accountId,
  amountMinor,
  currency,
});

describe('formatIDR', () => {
  it('formats with no decimals', () => {
    expect(formatIDR(2500000n)).toBe('Rp25.000');
    expect(formatIDR(0n)).toBe('Rp0');
    expect(formatIDR(-123456700n)).toBe('-Rp1.234.567');
  });
  it('rounds half-even once', () => {
    expect(formatIDR(50n)).toBe('Rp0');
    expect(formatIDR(150n)).toBe('Rp2');
    expect(formatIDR(250n)).toBe('Rp2');
    expect(formatIDR(251n)).toBe('Rp3');
  });
  it('is exact beyond 2^53', () => {
    expect(formatIDR(900719925474099300n)).toBe('Rp9.007.199.254.740.993');
  });
  it('formats USD with decimals', () => {
    expect(formatMoney(123456n, { symbol: '$', minorUnit: 2, displayDecimals: 2 })).toBe(
      '$1.234,56',
    );
  });
});

describe('validateTransaction', () => {
  const posted = (kind: 'expense' | 'income' | 'transfer') => ({ kind, status: 'posted' as const });
  it('accepts balanced transfer', () => {
    expect(
      validateTransaction(posted('transfer'), [e(-100n, 'IDR', 'a'), e(100n, 'IDR', 'b')]),
    ).toEqual([]);
  });
  it('rejects unbalanced transfer', () => {
    expect(validateTransaction(posted('transfer'), [e(-100n), e(90n)])[0]?.code).toBe(
      'transfer_not_balanced',
    );
  });
  it('allows transfer + fee only if balanced', () => {
    expect(validateTransaction(posted('transfer'), [e(-110n), e(100n), e(10n)])).toEqual([]);
  });
  it('accepts cross-currency transfer', () => {
    expect(validateTransaction(posted('transfer'), [e(-1600000n), e(100n, 'USD')])).toEqual([]);
  });
  it('rejects single-entry transfer', () => {
    expect(validateTransaction(posted('transfer'), [e(0n)])[0]?.code).toBe(
      'transfer_needs_two_accounts',
    );
  });
  it('requires exactly one entry for expense/income', () => {
    expect(validateTransaction(posted('expense'), [e(-1n), e(-2n)])).toHaveLength(1);
    expect(validateTransaction(posted('income'), [])).toHaveLength(1);
    expect(validateTransaction(posted('expense'), [e(-1n)])).toEqual([]);
  });
  it('skips drafts', () => {
    expect(validateTransaction({ kind: 'expense', status: 'draft' }, [])).toEqual([]);
  });
});

describe('accountBalance', () => {
  it('adds entries to opening', () => {
    expect(accountBalance(1000n, [e(-300n), e(50n)])).toBe(750n);
    expect(accountBalance(5n, [])).toBe(5n);
  });
});
