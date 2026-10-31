import { describe, expect, it } from 'vitest';
import { parseIdrAmount } from './index';

const rp = (n: number) => BigInt(n) * 100n;

describe('parseIdrAmount', () => {
  const cases: [string, bigint][] = [
    ['25rb', rp(25_000)],
    ['25 rb', rp(25_000)],
    ['25ribu', rp(25_000)],
    ['25 Ribu', rp(25_000)],
    ['25k', rp(25_000)],
    ['25K', rp(25_000)],
    ['1,5jt', rp(1_500_000)],
    ['1.5jt', rp(1_500_000)],
    ['1jt', rp(1_000_000)],
    ['2 juta', rp(2_000_000)],
    ['2,5 juta', rp(2_500_000)],
    ['1,5rb', rp(1_500)],
    ['goceng', rp(5_000)],
    ['Goceng', rp(5_000)],
    ['ceban', rp(10_000)],
    ['gocap', rp(50_000)],
    ['cepek', rp(100)],
    ['seceng', rp(1_000)],
    ['25000', rp(25_000)],
    ['25.000', rp(25_000)],
    ['Rp25.000', rp(25_000)],
    ['Rp 1.250.000', rp(1_250_000)],
    ['rp. 1.250.000', rp(1_250_000)],
    ['IDR 1.250.000', rp(1_250_000)],
    ['Rp25.000,-', rp(25_000)],
    ['1.250.000,50', 125_000_050n],
    ['1,250,000', rp(1_250_000)],
    ['  75rb  ', rp(75_000)],
    ['500', rp(500)],
    ['1.000.000.000', rp(1_000_000_000)],
  ];
  it.each(cases)('%s', (input, expected) => {
    expect(parseIdrAmount(input)).toBe(expected);
  });

  const rejected = [
    '1,5', // ambiguous
    '1.5',
    '1,250', // ambiguous: thousands or decimal?
    '',
    '   ',
    'abc',
    'rp',
    '0',
    '0rb',
    '-25rb',
    '25 xyz',
    '1.2.3jt',
    '12.34.567',
    '1.2345',
    'goceng2',
    '25rb lunch',
  ];
  it.each(rejected)('rejects %j', (input) => {
    expect(parseIdrAmount(input)).toBeNull();
  });
});
