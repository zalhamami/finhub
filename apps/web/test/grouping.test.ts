import { describe, expect, it } from 'vitest';
import { buildAccountSections, moveItem, resolveValues } from '../src/lib/accounts';
import type {
  ApiAccount,
  ApiAccountType,
  ApiCategory,
  BalancesReport,
  NetWorthReport,
} from '../src/lib/api';
import { ApiRequestError } from '../src/lib/api';
import { flattenCategories, parentOptions } from '../src/lib/categories';
import { friendlyError } from '../src/lib/errors';

const type = (id: string, kind: ApiAccountType['kind'], name = id): ApiAccountType => ({
  id,
  name,
  icon: null,
  kind,
  has_credit_limit: false,
  has_due_day: false,
  has_holdings: false,
});
const types = [
  type('t-cash', 'cash'),
  type('t-bank', 'bank'),
  type('t-inv', 'investment'),
  type('t-liab', 'liability'),
];
const account = (id: string, type_id: string, extra: Partial<ApiAccount> = {}): ApiAccount => ({
  id,
  name: id,
  type_id,
  group_id: null,
  currency: 'IDR',
  icon: null,
  color: null,
  opening_balance_minor: '0',
  opening_date: null,
  credit_limit_minor: null,
  statement_day: null,
  due_day: null,
  include_in_net_worth: true,
  sort_order: 0,
  archived_at: null,
  ...extra,
});

describe('buildAccountSections', () => {
  const accounts = [
    account('bca', 't-bank', { sort_order: 1 }),
    account('mandiri', 't-bank', { sort_order: 0 }),
    account('dompet', 't-cash'),
    account('kartu', 't-liab'),
    account('lama', 't-bank', { archived_at: '2026-01-01T00:00:00Z', sort_order: 2 }),
  ];
  const values = new Map<string, string | null>([
    ['bca', '300000000'],
    ['mandiri', '100000000'],
    ['dompet', '5000000'],
    ['kartu', '200000000'], // owed-positive: still shown negative
    ['lama', '999'],
  ]);
  const input = { accounts, types, groups: [], values, showArchived: false };

  it('orders kinds Kas, Bank, ..., Liabilitas and omits empty kinds', () => {
    expect(buildAccountSections(input).map((s) => s.label)).toEqual(['Kas', 'Bank', 'Liabilitas']);
  });

  it('sorts rows by sort_order, sums totals in bigint, makes liabilities negative', () => {
    const [cash, bank, liab] = buildAccountSections(input);
    expect(bank!.rows.map((r) => r.account.id)).toEqual(['mandiri', 'bca']);
    expect(bank!.total).toBe('400000000');
    expect(cash!.total).toBe('5000000');
    expect(liab!.rows[0]!.value).toBe('-200000000');
    expect(liab!.total).toBe('-200000000');
  });

  it('hides archived accounts by default; shown they have no value and do not count', () => {
    const shown = buildAccountSections({ ...input, showArchived: true });
    const bank = shown.find((s) => s.kind === 'bank')!;
    expect(bank.rows.map((r) => r.account.id)).toEqual(['mandiri', 'bca', 'lama']);
    expect(bank.rows[2]).toMatchObject({ archived: true, value: null });
    expect(bank.total).toBe('400000000');
  });

  it('keeps totals exact beyond 2^53', () => {
    const big = new Map([
      ['bca', '9007199254740993'],
      ['mandiri', '1'],
    ]);
    const bank = buildAccountSections({ ...input, values: big }).find((s) => s.kind === 'bank')!;
    expect(bank.total).toBe('9007199254740994');
  });

  it('a missing value shows null and adds nothing', () => {
    const sections = buildAccountSections({ ...input, values: new Map() });
    expect(sections[0]!.rows[0]!.value).toBeNull();
    expect(sections[0]!.total).toBe('0');
  });
});

describe('resolveValues', () => {
  it('net worth values (holdings included) override plain balances', () => {
    const balances = {
      base_currency: 'IDR',
      groups: [
        {
          accounts: [
            { id: 'a', value_base_minor: '100' },
            { id: 'b', value_base_minor: '5' },
          ],
        },
      ],
    } as BalancesReport;
    const nw = { accounts: [{ id: 'a', value_base_minor: '900' }] } as NetWorthReport;
    expect([...resolveValues(balances, nw)]).toEqual([
      ['a', '900'],
      ['b', '5'],
    ]);
    expect(resolveValues(undefined, undefined).size).toBe(0);
  });
});

describe('moveItem', () => {
  const items = [
    { id: 'a', sort_order: 0 },
    { id: 'b', sort_order: 0 },
    { id: 'c', sort_order: 0 },
  ];
  it('renumbers 0..n-1 even when all sort orders tie, returning only changes', () => {
    expect(moveItem(items, 'b', 'up')).toEqual(
      [
        { id: 'b', sort_order: 0 },
        { id: 'a', sort_order: 1 },
        { id: 'c', sort_order: 2 },
      ].filter((u) => u.id !== 'b'),
    );
  });
  it('down swaps with the next', () => {
    const ordered = [
      { id: 'a', sort_order: 0 },
      { id: 'b', sort_order: 1 },
      { id: 'c', sort_order: 2 },
    ];
    expect(moveItem(ordered, 'a', 'down')).toEqual([
      { id: 'b', sort_order: 0 },
      { id: 'a', sort_order: 1 },
    ]);
  });
  it('is a no-op at the edges or for an unknown id', () => {
    expect(moveItem(items, 'a', 'up')).toEqual([]);
    expect(moveItem(items, 'c', 'down')).toEqual([]);
    expect(moveItem(items, 'zzz', 'up')).toEqual([]);
  });
});

const cat = (
  id: string,
  kind: 'expense' | 'income',
  children: ApiCategory[] = [],
  extra: Partial<ApiCategory> = {},
): ApiCategory => ({
  id,
  parent_id: null,
  kind,
  name: id,
  icon: null,
  color: null,
  sort_order: 0,
  archived_at: null,
  children,
  ...extra,
});

describe('flattenCategories / parentOptions', () => {
  const tree = [
    cat('makan', 'expense', [
      cat('kopi', 'expense'),
      cat('lama', 'expense', [], { archived_at: 'x' }),
    ]),
    cat('gaji', 'income'),
    cat('arsip', 'expense', [], { archived_at: 'x' }),
  ];
  it('keeps tree order, depth and only the requested kind', () => {
    const rows = flattenCategories(tree, 'expense', false);
    expect(rows.map((r) => [r.category.id, r.depth])).toEqual([
      ['makan', 0],
      ['kopi', 1],
    ]);
    expect(flattenCategories(tree, 'income', false).map((r) => r.category.id)).toEqual(['gaji']);
  });
  it('archived nodes appear only when asked, flagged', () => {
    const rows = flattenCategories(tree, 'expense', true);
    expect(rows.map((r) => r.category.id)).toEqual(['makan', 'kopi', 'lama', 'arsip']);
    expect(rows.filter((r) => r.archived).map((r) => r.category.id)).toEqual(['lama', 'arsip']);
  });
  it('siblingIds scope reordering to the same parent', () => {
    const rows = flattenCategories(tree, 'expense', false);
    expect(rows[0]!.siblingIds).toEqual(['makan']);
    expect(rows[1]!.siblingIds).toEqual(['kopi']);
  });
  it('deeper levels are displayed at depth 1', () => {
    const deep = [cat('a', 'expense', [cat('b', 'expense', [cat('c', 'expense')])])];
    expect(flattenCategories(deep, 'expense', false).map((r) => r.depth)).toEqual([0, 1, 1]);
  });
  it('parent options: active top-level, same kind, not self', () => {
    expect(parentOptions(tree, 'expense').map((c) => c.id)).toEqual(['makan']);
    expect(parentOptions(tree, 'expense', 'makan')).toEqual([]);
    expect(parentOptions(tree, 'income').map((c) => c.id)).toEqual(['gaji']);
  });
});

describe('friendlyError', () => {
  it('maps in-use conflicts to an "archive instead" message', () => {
    expect(friendlyError(new ApiRequestError('x', 409, 'account_has_entries'))).toMatch(/Arsipkan/);
    expect(friendlyError(new ApiRequestError('x', 409, 'category_in_use'))).toMatch(/Arsipkan/);
    expect(friendlyError(new ApiRequestError('x', 409, 'account_type_in_use'))).toMatch(
      /masih dipakai/,
    );
  });
  it('falls back for unknown codes and non-API errors', () => {
    expect(friendlyError(new ApiRequestError('x', 409, 'something_else'))).toMatch(/bentrok/);
    expect(friendlyError(new ApiRequestError('x', 500))).toMatch(/Server/);
    expect(friendlyError(new Error('boom'))).toMatch(/kesalahan/);
  });
});
