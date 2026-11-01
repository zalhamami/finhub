import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const notify = vi.hoisted(() => ({ notifySuccess: vi.fn(), notifyError: vi.fn() }));
vi.mock('../src/lib/notify', () => notify);

import TransactionSheet from '../src/features/TransactionSheet';
import type { ApiTransaction } from '../src/lib/api';
import { ThemeRoot } from '../src/theme/AccentProvider';

const A_BCA = '00000000-0000-4000-8000-0000000000a1';
const C_FOOD = '00000000-0000-4000-8000-0000000000c1';

const account = {
  id: A_BCA,
  name: 'BCA',
  type_id: 't1',
  group_id: null,
  currency: 'IDR',
  icon: null,
  color: 'jade',
  opening_balance_minor: '0',
  opening_date: null,
  credit_limit_minor: null,
  statement_day: null,
  due_day: null,
  include_in_net_worth: true,
  sort_order: 0,
  archived_at: null,
};
const food = {
  id: C_FOOD,
  parent_id: null,
  kind: 'expense',
  name: 'Makan',
  icon: null,
  color: null,
  sort_order: 0,
  archived_at: null,
  children: [
    {
      id: '00000000-0000-4000-8000-0000000000c9',
      parent_id: C_FOOD,
      kind: 'expense',
      name: 'Kopi',
      icon: null,
      color: null,
      sort_order: 0,
      archived_at: null,
      children: [],
    },
  ],
};
const existing: ApiTransaction = {
  id: '00000000-0000-4000-8000-0000000000f1',
  occurred_at: '2026-10-31T12:00:00+07:00',
  kind: 'expense',
  payee: null,
  note: null,
  status: 'posted',
  source: 'web',
  archived_at: null,
  entries: [
    {
      id: 'e1',
      account_id: A_BCA,
      category_id: C_FOOD,
      amount_minor: '-1500000',
      currency: 'IDR',
      fx_rate: null,
      is_fee: false,
    },
  ],
  tag_ids: [],
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(status < 400 ? { data } : data), { status });

function stubApi(onWrite: (method: string, url: string) => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method !== 'GET') return onWrite(method, url);
      if (url.includes('/accounts')) return json([account]);
      if (url.includes('/categories')) return json([food]);
      if (url.includes('/reports/balances')) return json({ base_currency: 'IDR', groups: [] });
      return json([]);
    }),
  );
}

function renderSheet(sheet: Parameters<typeof TransactionSheet>[0]['sheet']) {
  render(
    <ThemeRoot>
      <QueryClientProvider client={new QueryClient()}>
        <TransactionSheet sheet={sheet} opened onClose={() => {}} />
      </QueryClientProvider>
    </ThemeRoot>,
  );
}

beforeEach(() => {
  notify.notifySuccess.mockClear();
  notify.notifyError.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe('transaction toasts', () => {
  it('creating an expense toasts "Transaksi tersimpan" with amount and category', async () => {
    stubApi(() => json(existing, 201));
    renderSheet({ mode: 'create' });
    fireEvent.change(await screen.findByLabelText('Nominal'), { target: { value: '15000' } });
    const input = screen.getByRole('combobox', { name: 'Kategori' });
    fireEvent.click(input);
    const listbox = await waitFor(() => {
      const el = document.getElementById(input.getAttribute('aria-controls') ?? '');
      if (!el) throw new Error('no listbox');
      return el;
    });
    fireEvent.click(await within(listbox).findByRole('option', { name: 'Kopi', hidden: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(notify.notifySuccess).toHaveBeenCalledTimes(1));
    expect(notify.notifySuccess).toHaveBeenCalledWith('Transaksi tersimpan', 'Rp15.000 · Kopi');
  });

  it('a failed delete toasts the Indonesian error message', async () => {
    stubApi(() => json({ error: { code: 'not_found', message: 'nope' } }, 404));
    renderSheet({ mode: 'edit', tx: existing });
    fireEvent.click(await screen.findByRole('button', { name: 'Hapus' }));
    const dialog = await screen.findByRole('dialog', { name: 'Hapus transaksi?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
    await waitFor(() => expect(notify.notifyError).toHaveBeenCalledTimes(1));
    expect(notify.notifyError).toHaveBeenCalledWith(
      'Transaksi ini sudah tidak ada. Muat ulang daftar transaksi.',
    );
    expect(notify.notifySuccess).not.toHaveBeenCalled();
  });
});
