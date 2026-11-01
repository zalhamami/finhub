import { describe, expect, it } from 'vitest';
import type { ApiAccount, ApiCategory, ApiTransaction } from '../src/lib/api';
import { categorySelectData, defaultFeeCategory, indexCategories } from '../src/lib/categories';
import { formatMinorCurrency } from '../src/lib/money';
import { isTypingTarget } from '../src/lib/shortcuts';
import { describeTransaction } from '../src/lib/transactions';

const cat = (
  id: string,
  name: string,
  kind: 'expense' | 'income',
  children: ApiCategory[] = [],
  extra: Partial<ApiCategory> = {},
): ApiCategory => ({
  id,
  parent_id: null,
  kind,
  name,
  icon: 'cart',
  color: 'teal',
  sort_order: 0,
  archived_at: null,
  children,
  ...extra,
});
const TREE = [
  cat('food', 'Makanan', 'expense', [
    cat('coffee', 'Kopi', 'expense', [], { parent_id: 'food' }),
    cat('old', 'Lama', 'expense', [], { parent_id: 'food', archived_at: '2026-01-01T00:00:00Z' }),
  ]),
  cat('fees', 'Biaya Admin', 'expense'),
  cat('arch', 'Arsip', 'expense', [], { archived_at: '2026-01-01T00:00:00Z' }),
  cat('salary', 'Gaji', 'income'),
];

describe('categorySelectData', () => {
  it('groups by parent (parent first), filters by kind, hides archived', () => {
    expect(categorySelectData(TREE, 'expense')).toEqual([
      {
        group: 'Makanan',
        items: [
          { value: 'food', label: 'Makanan' },
          { value: 'coffee', label: 'Kopi' },
        ],
      },
      { group: 'Biaya Admin', items: [{ value: 'fees', label: 'Biaya Admin' }] },
    ]);
  });

  it('keeps an archived category that is currently selected (editing an old entry)', () => {
    const data = categorySelectData(TREE, 'expense', { keep: 'old' });
    expect(data[0]!.items.map((i) => i.value)).toEqual(['food', 'coffee', 'old']);
  });

  it('income only', () => {
    expect(categorySelectData(TREE, 'income')).toEqual([
      { group: 'Gaji', items: [{ value: 'salary', label: 'Gaji' }] },
    ]);
  });

  it('no kind: both kinds, group labels carry the kind', () => {
    const groups = categorySelectData(TREE, null).map((g) => g.group);
    expect(groups).toEqual([
      'Pengeluaran · Makanan',
      'Pengeluaran · Biaya Admin',
      'Pemasukan · Gaji',
    ]);
  });
});

describe('defaultFeeCategory', () => {
  it('finds an expense category named like "Biaya Admin", else "Biaya…"', () => {
    expect(defaultFeeCategory(TREE)).toBe('fees');
    expect(defaultFeeCategory([cat('b', 'Biaya', 'expense')])).toBe('b');
    expect(defaultFeeCategory([cat('b', 'biaya bank', 'expense')])).toBe('b');
  });
  it('prefers admin over plain biaya, ignores income / archived / unrelated', () => {
    const t = [cat('b', 'Biaya', 'expense'), cat('a', 'Biaya Admin', 'expense')];
    expect(defaultFeeCategory(t)).toBe('a');
    expect(defaultFeeCategory([cat('i', 'Biaya Admin', 'income')])).toBe('');
    expect(defaultFeeCategory([cat('x', 'Biaya', 'expense', [], { archived_at: 'x' })])).toBe('');
    expect(defaultFeeCategory([cat('k', 'Kopi', 'expense')])).toBe('');
  });
  it('also finds a subcategory', () => {
    const t = [cat('p', 'Bank', 'expense', [cat('s', 'Biaya Admin', 'expense')])];
    expect(defaultFeeCategory(t)).toBe('s');
  });
});

describe('formatMinorCurrency', () => {
  it('IDR without decimals, other currencies with 2', () => {
    expect(formatMinorCurrency('-150000000', 'IDR')).toBe('-Rp1.500.000');
    expect(formatMinorCurrency('6150', 'USD')).toBe('USD 61,50');
    expect(formatMinorCurrency(null, 'IDR')).toBe('–');
  });
});

describe('isTypingTarget', () => {
  const el = (html: string) => {
    const d = document.createElement('div');
    d.innerHTML = html;
    return d.firstElementChild as HTMLElement;
  };
  it('is true for fields and editable content', () => {
    expect(isTypingTarget(el('<input type="text">'))).toBe(true);
    expect(isTypingTarget(el('<textarea></textarea>'))).toBe(true);
    expect(isTypingTarget(el('<select></select>'))).toBe(true);
    expect(isTypingTarget(el('<div contenteditable="true"></div>'))).toBe(true);
    expect(isTypingTarget(el('<div role="textbox"></div>'))).toBe(true);
  });
  it('is false for buttons, body and null', () => {
    expect(isTypingTarget(el('<button></button>'))).toBe(false);
    expect(isTypingTarget(document.body)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

const account = (id: string, name: string, currency = 'IDR'): ApiAccount =>
  ({ id, name, currency, icon: null, color: 'jade' }) as ApiAccount;
const tx = (over: Partial<ApiTransaction>): ApiTransaction => ({
  id: 't',
  occurred_at: '2026-10-31T05:00:00Z',
  kind: 'expense',
  payee: null,
  note: null,
  status: 'posted',
  source: 'manual',
  archived_at: null,
  entries: [],
  tag_ids: [],
  ...over,
});
const e = (
  account_id: string,
  amount_minor: string,
  category_id: string | null,
  is_fee = false,
  currency = 'IDR',
) => ({
  id: `${account_id}${amount_minor}`,
  account_id,
  category_id,
  amount_minor,
  currency,
  fx_rate: null,
  is_fee,
});

describe('describeTransaction (list row)', () => {
  const accounts = new Map([
    ['bca', account('bca', 'BCA')],
    ['cash', account('cash', 'Dompet')],
    ['usd', account('usd', 'Wise', 'USD')],
  ]);
  const cats = indexCategories(TREE);

  it('expense: category title, negative neutral amount, account, payee · note', () => {
    const m = describeTransaction(
      tx({ payee: 'Warung', note: 'siang', entries: [e('bca', '-2500000', 'coffee')] }),
      accounts,
      cats,
    );
    expect(m).toMatchObject({
      title: 'Kopi',
      category: { icon: 'cart', color: 'teal' },
      detail: 'Warung · siang',
      accountName: 'BCA',
      amount: { minor: '-2500000', currency: 'IDR', tone: 'neutral' },
    });
  });

  it('income: sage tone', () => {
    const m = describeTransaction(
      tx({ kind: 'income', entries: [e('bca', '900000000', 'salary')] }),
      accounts,
      cats,
    );
    expect(m).toMatchObject({ title: 'Gaji', amount: { minor: '900000000', tone: 'income' } });
  });

  it('transfer: "Transfer: A → B", sent amount (positive, dimmed), fee noted', () => {
    const m = describeTransaction(
      tx({
        kind: 'transfer',
        entries: [
          e('bca', '-100000', null),
          e('cash', '100000', null),
          e('bca', '-650', 'fees', true),
        ],
      }),
      accounts,
      cats,
    );
    expect(m).toMatchObject({
      title: 'Transfer: BCA → Dompet',
      accountName: '',
      category: null,
      amount: { minor: '100000', currency: 'IDR', tone: 'dimmed' },
      feeMinor: '650',
    });
  });

  it('cross-currency transfer shows the sent amount in the source currency', () => {
    const m = describeTransaction(
      tx({
        kind: 'transfer',
        entries: [e('usd', '-6150', null, false, 'USD'), e('bca', '100000', null)],
      }),
      accounts,
      cats,
    );
    expect(m.title).toBe('Transfer: Wise → BCA');
    expect(m.amount).toMatchObject({ minor: '6150', currency: 'USD' });
  });

  it('unknown category / account fall back to neutral labels', () => {
    const m = describeTransaction(tx({ entries: [e('zzz', '-1', null)] }), accounts, cats);
    expect(m).toMatchObject({
      title: 'Tanpa kategori',
      accountName: 'Akun tidak dikenal',
      category: null,
    });
  });

  it('adjustment: signed, titled', () => {
    const m = describeTransaction(
      tx({ kind: 'adjustment', entries: [e('bca', '-500', null)] }),
      accounts,
      cats,
    );
    expect(m).toMatchObject({
      title: 'Penyesuaian saldo',
      amount: { minor: '-500', tone: 'neutral' },
    });
  });
});

import { ApiRequestError } from '../src/lib/api';
import { friendlyError } from '../src/lib/errors';

describe('friendlyError in the transaction context', () => {
  const e = (code: string, status: number) => new ApiRequestError('raw english', status, code);
  it('maps ledger / category / archived-account errors to Indonesian', () => {
    expect(friendlyError(e('ledger_invalid', 400), 'transaction')).toMatch(
      /Transaksi tidak seimbang/,
    );
    expect(friendlyError(e('category_kind_mismatch', 400), 'transaction')).toMatch(
      /Kategori tidak cocok dengan jenis transaksi/,
    );
    expect(friendlyError(e('account_archived', 409), 'transaction')).toMatch(/diarsipkan/);
    expect(friendlyError(e('invalid_reference', 400), 'transaction')).toMatch(/tidak ditemukan/);
  });
  it('the category context keeps its own wording for category_kind_mismatch', () => {
    expect(friendlyError(e('category_kind_mismatch', 400), 'category')).toMatch(/Induk harus/);
  });
});
