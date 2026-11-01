import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RouterProvider, createAppRouter } from '../src/router';
import { ThemeRoot } from '../src/theme/AccentProvider';

afterEach(() => vi.unstubAllGlobals());

const TYPE_BANK = {
  id: 't1',
  name: 'Bank',
  icon: null,
  kind: 'bank',
  has_credit_limit: false,
  has_due_day: false,
  has_holdings: false,
};
const acc = (id: string, name: string, extra = {}) => ({
  id,
  name,
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
  ...extra,
});

function stubApi(accounts: unknown[]) {
  const routes: Record<string, unknown> = {
    '/api/v1/accounts?include_archived=true': accounts,
    '/api/v1/account-types': [TYPE_BANK],
    '/api/v1/account-groups': [],
    '/api/v1/currencies': [{ code: 'IDR', minor_unit: 2, display_decimals: 0, symbol: 'Rp' }],
    '/api/v1/reports/balances?group_by=account': {
      base_currency: 'IDR',
      groups: [{ accounts: [{ id: 'a1', value_base_minor: '150000000' }] }],
    },
    '/api/v1/reports/net-worth': {
      base_currency: 'IDR',
      accounts: [{ id: 'a1', value_base_minor: '150000000' }],
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
}

function renderAkun() {
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
}

describe('AccountsPage', () => {
  it('groups accounts by kind with the section total and each balance', async () => {
    stubApi([acc('a1', 'BCA Tahapan')]);
    renderAkun();
    const section = within(await screen.findByRole('region', { name: 'Bank' }));
    expect(section.getByText('BCA Tahapan')).toBeTruthy();
    expect(section.getAllByText('Rp1.500.000')).toHaveLength(2); // row + group total
  });

  it('archived accounts are hidden behind "Tampilkan arsip"', async () => {
    stubApi([
      acc('a1', 'BCA Tahapan'),
      acc('a2', 'Rekening Lama', { archived_at: '2026-01-01T00:00:00Z' }),
    ]);
    renderAkun();
    await screen.findByText('BCA Tahapan');
    expect(screen.queryByText('Rekening Lama')).toBeNull();
    fireEvent.click(screen.getByLabelText('Tampilkan arsip'));
    expect(screen.getByText('Rekening Lama')).toBeTruthy();
  });

  it('empty state offers a CTA that opens the create form', async () => {
    stubApi([]);
    renderAkun();
    expect(await screen.findByText('Belum ada akun')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tambah akun pertama' }));
    expect(await screen.findByLabelText(/Nama akun/)).toBeTruthy();
  });

  it('a row is a real link to the account detail page (no longer opens the edit form)', async () => {
    stubApi([acc('a1', 'BCA Tahapan')]);
    renderAkun();
    const link = (await screen.findByRole('link', {
      name: 'Buka BCA Tahapan',
    })) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/akun/a1');
    expect(screen.queryByLabelText(/Nama akun/)).toBeNull();
    fireEvent.click(link);
    expect(screen.queryByLabelText(/Nama akun/)).toBeNull();
  });
});
