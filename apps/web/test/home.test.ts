import { describe, expect, it } from 'vitest';
import {
  canGoNext,
  categoryLink,
  changePct,
  formatCompact,
  monthLabel,
  paceHint,
  shiftMonth,
  sparkline,
} from '../src/lib/home';

describe('months', () => {
  it('monthLabel is Indonesian', () => {
    expect(monthLabel('2026-11')).toBe('November 2026');
    expect(monthLabel('2026-08')).toBe('Agustus 2026');
  });
  it('shiftMonth crosses years', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-05', -6)).toBe('2025-11');
  });
  it('no future months', () => {
    expect(canGoNext('2026-10', '2026-11-03')).toBe(true);
    expect(canGoNext('2026-11', '2026-11-03')).toBe(false);
    expect(canGoNext('2026-12', '2026-11-03')).toBe(false);
  });
});

describe('changePct', () => {
  it('rounds, signs, and is null without a base', () => {
    expect(changePct(150n, 100n)).toBe(50);
    expect(changePct(80n, 100n)).toBe(-20);
    expect(changePct(1n, 3n)).toBe(-67);
    expect(changePct(5n, 0n)).toBeNull();
    expect(changePct(0n, 0n)).toBeNull();
  });
});

describe('formatCompact (IDR, minor units)', () => {
  it.each([
    ['120000000', 'Rp1,2 jt'],
    ['100000000', 'Rp1 jt'],
    ['250000000000', 'Rp2,5 M'],
    ['35000000', 'Rp350 rb'],
    ['50000', 'Rp500'],
    ['0', 'Rp0'],
    ['-120000000', 'Rp1,2 jt'], // magnitude only; the sentence carries the direction
  ])('%s -> %s', (minor, out) => expect(formatCompact(minor)).toBe(out));
});

describe('paceHint', () => {
  it('saving vs same day last month', () => {
    expect(paceHint('-120000000', true)).toEqual({
      text: 'Rp1,2 jt lebih hemat dari bulan lalu di tanggal yang sama',
      tone: 'better',
    });
  });
  it('overspending uses the over tone', () => {
    expect(paceHint('50000000', true)).toEqual({
      text: 'Rp500 rb lebih boros dari bulan lalu di tanggal yang sama',
      tone: 'over',
    });
  });
  it('same, and past-month wording', () => {
    expect(paceHint('0', true).tone).toBe('same');
    expect(paceHint('-100000000', false).text).toBe(
      'Rp1 jt lebih hemat dari bulan sebelumnya di tanggal yang sama',
    );
  });
});

describe('categoryLink', () => {
  it('filters /transaksi by category and the whole calendar month', () => {
    expect(categoryLink('abc', '2026-02')).toEqual({
      category: 'abc',
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });
});

describe('sparkline', () => {
  it('maps values to a polyline inside the box; higher value = smaller y', () => {
    const s = sparkline(['0', '50', '100'], 100, 50, 5);
    expect(s.points).toHaveLength(3);
    expect(s.points[0]).toEqual({ x: 5, y: 45 });
    expect(s.points[2]).toEqual({ x: 95, y: 5 });
    expect(s.points[1]!.y).toBe(25);
    expect(s.path.startsWith('M5,45')).toBe(true);
  });
  it('handles negative values, flat series, one point and none', () => {
    expect(sparkline(['-100', '0'], 100, 50, 0).points.map((p) => p.y)).toEqual([50, 0]);
    expect(sparkline(['7', '7', '7'], 100, 50, 0).points.map((p) => p.y)).toEqual([25, 25, 25]);
    expect(sparkline(['7'], 100, 50, 0).points).toEqual([{ x: 50, y: 25 }]);
    expect(sparkline([], 100, 50, 0)).toEqual({ points: [], path: '' });
  });
  it('is exact for values beyond 2^53', () => {
    const big = 10n ** 20n;
    const s = sparkline([String(big), String(big + 1n)], 100, 50, 0);
    expect(s.points.map((p) => p.y)).toEqual([50, 0]);
  });
});
