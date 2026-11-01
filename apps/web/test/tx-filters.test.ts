import { describe, expect, it } from 'vitest';
import {
  datePreset,
  filtersToApiQuery,
  filtersToSearch,
  hasActiveFilters,
  searchToFilters,
  type TxFilters,
} from '../src/lib/txFilters';

const ID1 = '00000000-0000-4000-8000-000000000001';
const ID2 = '00000000-0000-4000-8000-000000000002';

describe('filters <-> URL search params', () => {
  it('round-trips a full filter state', () => {
    const f: TxFilters = {
      account: ID1,
      category: ID2,
      type: 'transfer',
      from: '2026-10-01',
      to: '2026-10-31',
      q: 'kopi susu',
    };
    const search = filtersToSearch(f);
    expect(search).toEqual({
      account: ID1,
      category: ID2,
      type: 'transfer',
      from: '2026-10-01',
      to: '2026-10-31',
      q: 'kopi susu',
    });
    expect(searchToFilters(search)).toEqual(f);
    // through a real query string too
    const qs = new URLSearchParams(search).toString();
    expect(searchToFilters(Object.fromEntries(new URLSearchParams(qs)))).toEqual(f);
  });

  it('omits empty filters', () => {
    expect(filtersToSearch({})).toEqual({});
    expect(filtersToSearch({ q: '   ', account: '' })).toEqual({});
  });

  it('drops garbage instead of throwing', () => {
    expect(
      searchToFilters({
        account: 'not-a-uuid',
        category: 5,
        type: 'bogus',
        from: '31-10-2026',
        to: '2026-02-30',
        q: ['x'],
        extra: 'y',
      }),
    ).toEqual({});
  });

  it('accepts numbers (the router JSON-parses "123") for q', () => {
    expect(searchToFilters({ q: 123 })).toEqual({ q: '123' });
  });

  it('trims q and caps it at 200 chars', () => {
    expect(searchToFilters({ q: '  kopi  ' })).toEqual({ q: 'kopi' });
    expect(searchToFilters({ q: 'x'.repeat(300) }).q).toHaveLength(200);
  });

  it('swaps a reversed date range', () => {
    expect(searchToFilters({ from: '2026-10-31', to: '2026-10-01' })).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    });
  });

  it('hasActiveFilters', () => {
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters({ q: 'x' })).toBe(true);
    expect(hasActiveFilters({ from: '2026-10-01' })).toBe(true);
  });
});

describe('filters -> API query string', () => {
  it('maps to the server parameters', () => {
    const qs = new URLSearchParams(
      filtersToApiQuery(
        {
          account: ID1,
          category: ID2,
          type: 'income',
          from: '2026-10-01',
          to: '2026-10-31',
          q: 'a&b',
        },
        { limit: 30, cursor: 'abc' },
      ),
    );
    expect(Object.fromEntries(qs)).toEqual({
      account_id: ID1,
      category_id: ID2,
      include_subcategories: 'true',
      kind: 'income',
      from: '2026-10-01',
      to: '2026-10-31',
      q: 'a&b',
      limit: '30',
      cursor: 'abc',
    });
  });

  it('no filters: only the limit', () => {
    expect(filtersToApiQuery({}, { limit: 50 })).toBe('limit=50');
  });

  it('the type filter alone has no include_subcategories', () => {
    expect(filtersToApiQuery({ type: 'expense' }, { limit: 50 })).toBe('kind=expense&limit=50');
  });
});

describe('datePreset (today is a Jakarta date)', () => {
  it('this month', () => {
    expect(datePreset('this-month', '2026-11-18')).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
    });
  });
  it('last month, across a year boundary and in February', () => {
    expect(datePreset('last-month', '2026-01-05')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(datePreset('last-month', '2024-03-10')).toEqual({
      from: '2024-02-01',
      to: '2024-02-29',
    });
  });
  it('last 30 days is inclusive of today', () => {
    expect(datePreset('last-30', '2026-11-30')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(datePreset('last-30', '2026-03-05')).toEqual({ from: '2026-02-04', to: '2026-03-05' });
  });
});
