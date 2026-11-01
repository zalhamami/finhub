import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { amountPreview, minorToInputText, parseAmountText } from '../src/lib/amount';
import { foreignValue, formatMinorCurrency } from '../src/lib/money';
import { accountFormSchema, emptyAccountForm } from '../src/lib/schemas';
import { baseEquivalent, describeTransaction, txFormSchema } from '../src/lib/transactions';
import { RouterProvider, createAppRouter } from '../src/router';
import { ThemeRoot } from '../src/theme/AccentProvider';
import type { ApiAccount, ApiTransaction } from '../src/lib/api';

afterEach(() => vi.unstubAllGlobals());

describe('currency formatting', () => {
  it('formats each currency with its own symbol and decimals', () => {
    expect(formatMinorCurrency('125000', 'USD')).toBe('US$1.250,00');
    expect(formatMinorCurrency('-6150', 'SGD')).toBe('-S$61,50');
    expect(formatMinorCurrency('2031250000', 'IDR')).toBe('Rp20.312.500');
    expect(formatMinorCurrency('150', 'XYZ')).toBe('XYZ 1,50');
  });

  it('foreignValue: own amount + base equivalent, "kurs belum ada" without a rate, null for base', () => {
    expect(foreignValue('125000', 'USD', '2031250000', 'IDR')).toEqual({
      native: 'US$1.250,00',
      secondary: '≈ Rp20.312.500',
    });
    expect(foreignValue('125000', 'USD', null, 'IDR')).toEqual({
      native: 'US$1.250,00',
      secondary: 'kurs belum ada',
    });
    expect(foreignValue('125000', 'IDR', '125000', 'IDR')).toBeNull();
  });
});

describe('amount parsing follows the currency decimals', () => {
  it('USD (2) keeps cents; a 0-decimal currency rescales and rejects fractions', () => {
    expect(parseAmountText('12,50', 2)).toEqual({ status: 'ok', minor: 1250n });
    expect(parseAmountText('1,5jt', 0)).toEqual({ status: 'ok', minor: 1_500_000n });
    expect(parseAmountText('1500,50', 0)).toEqual({ status: 'invalid' });
    expect(parseAmountText('1,5', 3)).toEqual({ status: 'invalid' });
    expect(parseAmountText('1,500', 3)).toEqual({ status: 'ok', minor: 1500n });
    expect(parseAmountText('250rb', 3)).toEqual({ status: 'ok', minor: 250_000_000n });
  });
  it('preview and editable text use the currency', () => {
    expect(amountPreview('12,50', 'USD')).toBe('US$12,50');
    expect(amountPreview('1,5jt')).toBe('Rp1.500.000');
    expect(minorToInputText('1250')).toBe('12,50');
    expect(minorToInputText('1500', 3)).toBe('1,500');
    expect(minorToInputText('-1500', 0)).toBe('-1500');
  });
});

describe('payload builders use the account currency', () => {
  it('account form: USD opening balance and limit are parsed in cents', () => {
    const out = accountFormSchema({ has_credit_limit: true, has_due_day: false }).parse({
      ...emptyAccountForm(),
      name: 'Bank Demo USD',
      type_id: 't',
      currency: 'USD',
      opening_text: '2000',
      credit_limit_text: '12,50',
    });
    expect(out.opening_balance_minor).toBe('200000');
    expect(out.credit_limit_minor).toBe('1250');
  });
  it('transaction form: USD expense amount in cents', () => {
    const r = txFormSchema({
      accounts: new Map([['usd', { currency: 'USD' }]]),
      categories: new Map([['c', 'expense' as const]]),
    }).parse({
      type: 'expense',
      amount_text: '9,99',
      account_id: 'usd',
      category_id: 'c',
      to_account_id: '',
      to_amount_text: '',
      fee_text: '',
      fee_category_id: '',
      date: '2026-03-01',
      time: '12:00',
      note: '',
      payee: '',
    });
    expect(r.type === 'expense' && r.body.amount_minor).toBe('999');
  });
});

const acct = (id: string, name: string, currency = 'IDR') =>
  ({ id, name, currency, icon: null, color: 'jade' }) as ApiAccount;
const entry = (account_id: string, amount_minor: string, currency: string, cat: string | null) => ({
  id: account_id + amount_minor,
  account_id,
  category_id: cat,
  amount_minor,
  currency,
  fx_rate: null,
  is_fee: false,
});
const tx = (over: Partial<ApiTransaction>): ApiTransaction => ({
  id: 't',
  occurred_at: '2026-03-10T05:00:00Z',
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

describe('transaction rows in a foreign currency', () => {
  const accounts = new Map([
    ['usd', acct('usd', 'Bank Demo USD', 'USD')],
    ['idr', acct('idr', 'Bank Demo Utama')],
  ]);
  const cats = new Map<string, { name: string; icon: null; color: null }>();
  const fx = {
    baseCurrency: 'IDR',
    rates: [
      { base: 'USD', quote: 'IDR', date: '2026-03-01', rate: '16000' },
      { base: 'USD', quote: 'IDR', date: '2026-03-20', rate: '17000' },
    ],
  };

  it('uses the latest rate on or before the Jakarta date', () => {
    expect(baseEquivalent('999', 'USD', '2026-03-10', fx)).toBe('15984000'); // 9,99 x 16000
    expect(baseEquivalent('999', 'USD', '2026-02-01', fx)).toBeNull();
    expect(baseEquivalent('999', 'IDR', '2026-02-01', fx)).toBe('999');
  });

  it('expense: own currency main, "≈ Rp" secondary; none for IDR rows or without fx', () => {
    const t = tx({ entries: [entry('usd', '-999', 'USD', null)] });
    const m = describeTransaction(t, accounts, cats, fx);
    expect(m.amount).toMatchObject({ minor: '-999', currency: 'USD' });
    expect(m.secondary).toBe('≈ -Rp159.840');
    expect(describeTransaction(t, accounts, cats).secondary).toBeNull();
    const idr = tx({ entries: [entry('idr', '-5000', 'IDR', null)] });
    expect(describeTransaction(idr, accounts, cats, fx).secondary).toBeNull();
    const old = tx({
      occurred_at: '2026-02-01T05:00:00Z',
      entries: [entry('usd', '-999', 'USD', null)],
    });
    expect(describeTransaction(old, accounts, cats, fx).secondary).toBe('kurs belum ada');
  });

  it('cross-currency transfer shows both legs', () => {
    const t = tx({
      kind: 'transfer',
      entries: [entry('idr', '-810000000', 'IDR', null), entry('usd', '50154', 'USD', null)],
    });
    const m = describeTransaction(t, accounts, cats, fx);
    expect(m.amount).toMatchObject({ minor: '810000000', currency: 'IDR' });
    expect(m.secondary).toBe('→ US$501,54');
  });
});

describe('Akun page with a USD account', () => {
  it('shows the USD amount as the main figure with the IDR equivalent below; totals stay IDR', async () => {
    const routes: Record<string, unknown> = {
      '/api/v1/accounts?include_archived=true': [
        {
          ...acct('u1', 'Bank Demo USD', 'USD'),
          type_id: 't1',
          group_id: null,
          opening_balance_minor: '0',
          opening_date: null,
          credit_limit_minor: null,
          statement_day: null,
          due_day: null,
          include_in_net_worth: true,
          sort_order: 0,
          archived_at: null,
        },
      ],
      '/api/v1/account-types': [
        {
          id: 't1',
          name: 'Bank',
          icon: null,
          kind: 'bank',
          has_credit_limit: false,
          has_due_day: false,
          has_holdings: false,
        },
      ],
      '/api/v1/account-groups': [],
      '/api/v1/currencies': [],
      '/api/v1/reports/balances?group_by=account': {
        base_currency: 'IDR',
        groups: [
          {
            accounts: [
              {
                id: 'u1',
                currency: 'USD',
                balance_minor: '125000',
                value_base_minor: '2031250000',
              },
            ],
          },
        ],
      },
      '/api/v1/reports/net-worth': {
        base_currency: 'IDR',
        accounts: [
          { id: 'u1', currency: 'USD', balance_minor: '125000', value_base_minor: '2031250000' },
        ],
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url in routes
          ? new Response(JSON.stringify({ data: routes[url] }), { status: 200 })
          : new Response(JSON.stringify({ error: { message: 'x' } }), { status: 404 }),
      ),
    );
    const router = createAppRouter(createMemoryHistory({ initialEntries: ['/akun'] }));
    render(
      <ThemeRoot>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ThemeRoot>,
    );
    const section = within(await screen.findByRole('region', { name: 'Bank' }));
    expect(section.getByText('US$1.250,00')).toBeTruthy();
    expect(section.getByText('≈ Rp20.312.500')).toBeTruthy();
    expect(section.getByText('Rp20.312.500')).toBeTruthy(); // the group total, in IDR
  });
});
