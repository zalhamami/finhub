import { describe, expect, it } from 'vitest';
import { asLiability, formatMinorIDR } from '../src/lib/money';

describe('money formatting', () => {
  it('formats bigint strings without losing precision', () => {
    expect(formatMinorIDR('2500000')).toBe('Rp25.000');
    expect(formatMinorIDR('-230000000')).toBe('-Rp2.300.000');
    // beyond 2^53: a JS number would round this
    expect(formatMinorIDR('900719925474099300')).toBe('Rp9.007.199.254.740.993');
  });
  it('shows a dash for missing values', () => {
    expect(formatMinorIDR(null)).toBe('–');
  });
  it('liabilities are always negative', () => {
    expect(asLiability('100')).toBe('-100');
    expect(asLiability('-100')).toBe('-100');
    expect(asLiability(null)).toBeNull();
  });
});
