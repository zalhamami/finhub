import { describe, expect, it } from 'vitest';
import type { ApiTransaction } from '../src/lib/api';
import {
  emptyTxForm,
  groupByDay,
  jakartaDate,
  jakartaTime,
  transactionToForm,
  txFormSchema,
  type TxFormContext,
  type TxFormValues,
} from '../src/lib/transactions';

const A_BCA = '00000000-0000-4000-8000-0000000000a1';
const A_CASH = '00000000-0000-4000-8000-0000000000a2';
const A_USD = '00000000-0000-4000-8000-0000000000a3';
const C_FOOD = '00000000-0000-4000-8000-0000000000c1';
const C_SALARY = '00000000-0000-4000-8000-0000000000c2';
const C_FEE = '00000000-0000-4000-8000-0000000000c3';

const NOW = new Date('2026-11-01T03:30:15Z'); // 10:30:15 Jakarta
const ctx: TxFormContext = {
  accounts: new Map([
    [A_BCA, { currency: 'IDR' }],
    [A_CASH, { currency: 'IDR' }],
    [A_USD, { currency: 'USD' }],
  ]),
  categories: new Map([
    [C_FOOD, 'expense'],
    [C_SALARY, 'income'],
    [C_FEE, 'expense'],
  ]),
  now: NOW,
};

const form = (over: Partial<TxFormValues>): TxFormValues => ({
  ...emptyTxForm('2026-10-31'),
  ...over,
});
const parse = (over: Partial<TxFormValues>) => txFormSchema(ctx).safeParse(form(over));
const messages = (over: Partial<TxFormValues>) => {
  const r = parse(over);
  if (r.success) return {};
  return Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]));
};

describe('txFormSchema: payload', () => {
  it('expense: "1,5jt" -> positive magnitude, Jakarta offset timestamp', () => {
    const r = parse({
      type: 'expense',
      amount_text: '1,5jt',
      account_id: A_BCA,
      category_id: C_FOOD,
      time: '19:05',
      note: 'makan',
      payee: 'Warteg',
    });
    expect(r.success && r.data).toEqual({
      type: 'expense',
      body: {
        kind: 'expense',
        account_id: A_BCA,
        amount_minor: '150000000',
        category_id: C_FOOD,
        occurred_at: '2026-10-31T19:05:00+07:00',
        note: 'makan',
        payee: 'Warteg',
      },
    });
  });

  it('income: empty optional text becomes null', () => {
    const r = parse({
      type: 'income',
      amount_text: '5jt',
      account_id: A_BCA,
      category_id: C_SALARY,
      time: '08:00',
    });
    expect(r.success && r.data.body).toMatchObject({
      kind: 'income',
      amount_minor: '500000000',
      note: null,
      payee: null,
    });
  });

  it('empty time: today uses the current Jakarta time, other days noon', () => {
    const base = {
      type: 'expense',
      amount_text: '1rb',
      account_id: A_BCA,
      category_id: C_FOOD,
    } as const;
    const today = parse({ ...base, date: '2026-11-01' });
    expect(today.success && (today.data.body as { occurred_at: string }).occurred_at).toBe(
      '2026-11-01T10:30:15+07:00',
    );
    const past = parse({ ...base, date: '2026-10-01' });
    expect(past.success && (past.data.body as { occurred_at: string }).occurred_at).toBe(
      '2026-10-01T12:00:00+07:00',
    );
  });

  it('same-currency transfer without fee: no to_amount, null fee, no payee', () => {
    const r = parse({
      type: 'transfer',
      amount_text: '250rb',
      account_id: A_BCA,
      to_account_id: A_CASH,
      time: '09:00',
    });
    expect(r.success && r.data).toEqual({
      type: 'transfer',
      body: {
        from_account_id: A_BCA,
        to_account_id: A_CASH,
        amount_minor: '25000000',
        to_amount_minor: null,
        fee_minor: null,
        fee_category_id: null,
        occurred_at: '2026-10-31T09:00:00+07:00',
        note: null,
      },
    });
  });

  it('transfer with fee sends fee_minor and fee_category_id', () => {
    const r = parse({
      type: 'transfer',
      amount_text: '1jt',
      account_id: A_BCA,
      to_account_id: A_CASH,
      fee_text: '6500',
      fee_category_id: C_FEE,
      time: '09:00',
    });
    expect(r.success && r.data.body).toMatchObject({
      amount_minor: '100000000',
      fee_minor: '650000',
      fee_category_id: C_FEE,
    });
  });

  it('cross-currency transfer sends the received amount', () => {
    const r = parse({
      type: 'transfer',
      amount_text: '1jt',
      account_id: A_BCA,
      to_account_id: A_USD,
      to_amount_text: '61,50',
      time: '09:00',
    });
    expect(r.success && r.data.body).toMatchObject({ to_amount_minor: '6150' });
  });

  it('ignores fields of the other type (stale category on a transfer, to-account on an expense)', () => {
    const r = parse({
      type: 'expense',
      amount_text: '1rb',
      account_id: A_BCA,
      category_id: C_FOOD,
      to_account_id: A_CASH,
      fee_text: '500',
      time: '09:00',
    });
    expect(r.success && Object.keys(r.data.body).sort()).toEqual(
      ['account_id', 'amount_minor', 'category_id', 'kind', 'note', 'occurred_at', 'payee'].sort(),
    );
  });
});

describe('txFormSchema: validation', () => {
  const ok = { amount_text: '10rb', account_id: A_BCA, category_id: C_FOOD, time: '09:00' };

  it('amount must be present, parseable and > 0', () => {
    expect(messages({ ...ok, amount_text: '' }).amount_text).toBe('Nominal wajib diisi');
    expect(messages({ ...ok, amount_text: 'banyak' }).amount_text).toMatch(/tidak dikenali/);
    expect(messages({ ...ok, amount_text: '0' }).amount_text).toBe('Nominal harus lebih dari 0');
    expect(messages({ ...ok, amount_text: '-5rb' }).amount_text).toBe('Nominal harus lebih dari 0');
  });

  it('account and category are required for expense / income', () => {
    expect(messages({ ...ok, account_id: '' }).account_id).toBe('Pilih akun');
    expect(messages({ ...ok, category_id: '' }).category_id).toBe('Pilih kategori');
  });

  it('category must match the kind', () => {
    expect(messages({ ...ok, type: 'expense', category_id: C_SALARY }).category_id).toBe(
      'Kategori ini bukan kategori pengeluaran',
    );
    expect(messages({ ...ok, type: 'income', category_id: C_FOOD }).category_id).toBe(
      'Kategori ini bukan kategori pemasukan',
    );
  });

  it('date required and well formed; time well formed', () => {
    expect(messages({ ...ok, date: '' }).date).toBe('Tanggal wajib diisi');
    expect(messages({ ...ok, date: '31/10/2026' }).date).toBe('Tanggal tidak valid');
    expect(messages({ ...ok, time: '25:00' }).time).toBe('Jam tidak valid');
  });

  it('note is at most 500 characters', () => {
    expect(messages({ ...ok, note: 'x'.repeat(501) }).note).toBe('Maksimal 500 karakter');
    expect(messages({ ...ok, note: 'x'.repeat(500) }).note).toBeUndefined();
  });

  describe('transfer', () => {
    const t = { ...ok, type: 'transfer', to_account_id: A_CASH } as const;

    it('needs a destination that differs from the source', () => {
      expect(messages({ ...t, to_account_id: '' }).to_account_id).toBe('Pilih akun tujuan');
      expect(messages({ ...t, to_account_id: A_BCA }).to_account_id).toBe(
        'Akun tujuan harus berbeda dari akun asal',
      );
    });

    it('does not need a category', () => {
      expect(messages({ ...t, category_id: '' }).category_id).toBeUndefined();
    });

    it('fee > 0 requires an expense fee category', () => {
      expect(messages({ ...t, fee_text: '5rb' }).fee_category_id).toBe('Pilih kategori biaya');
      expect(messages({ ...t, fee_text: '5rb', fee_category_id: C_SALARY }).fee_category_id).toBe(
        'Kategori ini bukan kategori pengeluaran',
      );
      expect(
        messages({ ...t, fee_text: '5rb', fee_category_id: C_FEE }).fee_category_id,
      ).toBeUndefined();
    });

    it('a zero or empty fee needs no category and is sent as null', () => {
      const r = parse({ ...t, fee_text: '0', fee_category_id: '' });
      expect(r.success && r.data.body).toMatchObject({ fee_minor: null, fee_category_id: null });
    });

    it('a negative fee is rejected', () => {
      expect(messages({ ...t, fee_text: '-1rb', fee_category_id: C_FEE }).fee_text).toBe(
        'Biaya tidak boleh negatif',
      );
    });

    it('cross-currency requires the received amount, > 0', () => {
      const x = { ...t, to_account_id: A_USD } as const;
      expect(messages(x).to_amount_text).toBe('Isi jumlah yang diterima (mata uang berbeda)');
      expect(messages({ ...x, to_amount_text: '0' }).to_amount_text).toBe(
        'Jumlah diterima harus lebih dari 0',
      );
    });

    it('same-currency transfer ignores a stale received amount', () => {
      const r = parse({ ...t, to_amount_text: '99' });
      expect(r.success && r.data.body).toMatchObject({ to_amount_minor: null });
    });
  });
});

const tx = (over: Partial<ApiTransaction>): ApiTransaction => ({
  id: 'tx1',
  occurred_at: '2026-10-31T12:05:00.000Z',
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
const entry = (
  account_id: string,
  amount_minor: string,
  category_id: string | null = null,
  extra: { currency?: string; is_fee?: boolean } = {},
) => ({
  id: `${account_id}-${amount_minor}`,
  account_id,
  category_id,
  amount_minor,
  currency: extra.currency ?? 'IDR',
  fx_rate: null,
  is_fee: extra.is_fee ?? false,
});

describe('transactionToForm (API -> form)', () => {
  it('expense: magnitude as text, Jakarta date and time', () => {
    const f = transactionToForm(
      tx({
        kind: 'expense',
        payee: 'Warteg',
        note: 'makan',
        entries: [entry(A_BCA, '-150000000', C_FOOD)],
      }),
    );
    expect(f).toEqual({
      ...emptyTxForm('2026-10-31'),
      type: 'expense',
      amount_text: '1500000',
      account_id: A_BCA,
      category_id: C_FOOD,
      date: '2026-10-31',
      time: '19:05',
      note: 'makan',
      payee: 'Warteg',
    });
  });

  it('Jakarta day rollover: 20:00Z is already the next day in Jakarta', () => {
    const f = transactionToForm(
      tx({ occurred_at: '2026-10-31T20:00:00Z', entries: [entry(A_BCA, '-100', C_FOOD)] }),
    );
    expect(f).toMatchObject({ date: '2026-11-01', time: '03:00' });
  });

  it('income', () => {
    const f = transactionToForm(
      tx({ kind: 'income', entries: [entry(A_BCA, '500000000', C_SALARY)] }),
    );
    expect(f).toMatchObject({ type: 'income', amount_text: '5000000', category_id: C_SALARY });
  });

  it('transfer with fee line: legs and fee separated, fee not mistaken for a leg', () => {
    const f = transactionToForm(
      tx({
        kind: 'transfer',
        entries: [
          entry(A_BCA, '-100000000'),
          entry(A_CASH, '100000000'),
          entry(A_BCA, '-650000', C_FEE, { is_fee: true }),
        ],
      }),
    );
    expect(f).toMatchObject({
      type: 'transfer',
      amount_text: '1000000',
      account_id: A_BCA,
      to_account_id: A_CASH,
      to_amount_text: '',
      fee_text: '6500',
      fee_category_id: C_FEE,
      category_id: '',
    });
  });

  it('cross-currency transfer keeps both amounts', () => {
    const f = transactionToForm(
      tx({
        kind: 'transfer',
        entries: [entry(A_BCA, '-100000000'), entry(A_USD, '6150', null, { currency: 'USD' })],
      }),
    );
    expect(f).toMatchObject({ amount_text: '1000000', to_amount_text: '61,50' });
  });

  it('adjustments are not editable here', () => {
    expect(
      transactionToForm(tx({ kind: 'adjustment', entries: [entry(A_BCA, '100')] })),
    ).toBeNull();
  });

  it('round trip: form -> payload -> API transaction -> form', () => {
    const original = form({
      type: 'transfer',
      amount_text: '1000000',
      account_id: A_BCA,
      to_account_id: A_USD,
      to_amount_text: '61,50',
      fee_text: '6500',
      fee_category_id: C_FEE,
      date: '2026-10-31',
      time: '19:05',
      note: 'kirim',
    });
    const parsed = txFormSchema(ctx).parse(original);
    const b = parsed.body as unknown as Record<string, string | null>;
    const back = transactionToForm(
      tx({
        kind: 'transfer',
        occurred_at: new Date(b.occurred_at!).toISOString(),
        note: b.note,
        entries: [
          entry(b.from_account_id!, `-${b.amount_minor}`),
          entry(b.to_account_id!, b.to_amount_minor!, null, { currency: 'USD' }),
          entry(b.from_account_id!, `-${b.fee_minor}`, b.fee_category_id, { is_fee: true }),
        ],
      }),
    );
    expect(back).toEqual(original);
  });
});

describe('jakartaDate / jakartaTime', () => {
  it('converts instants to Asia/Jakarta (UTC+7)', () => {
    expect(jakartaDate('2026-10-31T16:59:59Z')).toBe('2026-10-31');
    expect(jakartaDate('2026-10-31T17:00:00Z')).toBe('2026-11-01');
    expect(jakartaDate('2026-11-01T00:30:00+07:00')).toBe('2026-11-01');
    expect(jakartaTime('2026-10-31T17:00:00Z')).toBe('00:00');
  });
});

describe('groupByDay', () => {
  it('groups by Jakarta day, newest first as given, with a daily net per currency', () => {
    const list = [
      tx({
        id: '1',
        occurred_at: '2026-10-31T17:30:00Z',
        kind: 'income',
        entries: [entry(A_BCA, '500000', C_SALARY)],
      }),
      tx({
        id: '2',
        occurred_at: '2026-10-31T16:00:00Z',
        entries: [entry(A_BCA, '-120000', C_FOOD)],
      }),
      tx({
        id: '3',
        occurred_at: '2026-10-31T10:00:00Z',
        entries: [entry(A_BCA, '-30000', C_FOOD)],
      }),
    ];
    const groups = groupByDay(list);
    expect(groups.map((g) => [g.date, g.items.map((i) => i.id)])).toEqual([
      ['2026-11-01', ['1']],
      ['2026-10-31', ['2', '3']],
    ]);
    expect(groups[0]!.nets).toEqual([{ currency: 'IDR', minor: '500000' }]);
    expect(groups[1]!.nets).toEqual([{ currency: 'IDR', minor: '-150000' }]);
  });

  it('transfer legs net out; only the fee line counts', () => {
    const groups = groupByDay([
      tx({
        kind: 'transfer',
        entries: [
          entry(A_BCA, '-100000000'),
          entry(A_CASH, '100000000'),
          entry(A_BCA, '-650000', C_FEE, { is_fee: true }),
        ],
      }),
    ]);
    expect(groups[0]!.nets).toEqual([{ currency: 'IDR', minor: '-650000' }]);
  });

  it('a plain transfer contributes no net; mixed currencies stay separate (IDR first)', () => {
    const groups = groupByDay([
      tx({ id: 'a', kind: 'transfer', entries: [entry(A_BCA, '-100'), entry(A_CASH, '100')] }),
      tx({ id: 'b', entries: [entry(A_USD, '-250', C_FOOD, { currency: 'USD' })] }),
      tx({ id: 'c', entries: [entry(A_BCA, '-1000', C_FOOD)] }),
    ]);
    expect(groups[0]!.nets).toEqual([
      { currency: 'IDR', minor: '-1000' },
      { currency: 'USD', minor: '-250' },
    ]);
  });

  it('sums beyond 2^53 exactly', () => {
    const big = '9007199254740993';
    const groups = groupByDay([
      tx({ id: 'a', entries: [entry(A_BCA, `-${big}`, C_FOOD)] }),
      tx({ id: 'b', entries: [entry(A_BCA, '-1', C_FOOD)] }),
    ]);
    expect(groups[0]!.nets[0]!.minor).toBe('-9007199254740994');
  });

  it('empty list -> no groups', () => {
    expect(groupByDay([])).toEqual([]);
  });
});

import { dayLabel } from '../src/lib/transactions';

describe('dayLabel', () => {
  it('Hari ini / Kemarin / weekday and date in Indonesian', () => {
    expect(dayLabel('2026-11-01', '2026-11-01')).toBe('Hari ini');
    expect(dayLabel('2026-10-31', '2026-11-01')).toBe('Kemarin');
    expect(dayLabel('2026-10-28', '2026-11-01')).toBe('Rabu, 28 Okt 2026');
  });
});
