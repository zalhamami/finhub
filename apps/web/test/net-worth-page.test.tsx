import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NetWorthPage } from '../src/pages/NetWorthPage';
import { theme } from '../src/theme/theme';

const netWorth = {
  as_of: '2026-11-01',
  base_currency: 'IDR',
  assets_minor: '17140000000',
  liabilities_minor: '-230000000',
  net_worth_minor: '16910000000',
  by_kind: {
    cash: '85000000',
    bank: '4230000000',
    ewallet: '125000000',
    investment: '12700000000',
    liability: '-230000000',
  },
  missing_rates: [{ account_id: 'x', account_name: 'Pluang USD', type: 'fx_rate' }],
};
const acc = (id: string, name: string, kind: string, v: string | null) => ({
  id,
  name,
  kind,
  currency: 'IDR',
  value_base_minor: v,
});
const balances = {
  as_of: '2026-11-01',
  base_currency: 'IDR',
  total_base_minor: '0',
  groups: [
    {
      key: 'bank',
      name: 'bank',
      total_base_minor: '4230000000',
      accounts: [acc('1', 'BCA', 'bank', '3810000000')],
    },
    {
      key: 'liability',
      name: 'liability',
      total_base_minor: '230000000',
      accounts: [acc('2', 'CC BCA', 'liability', '230000000')],
    },
  ],
  missing_rates: [],
};

function mockApi(responses: Record<string, unknown>, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const key = Object.keys(responses).find((k) => url.includes(k))!;
      return new Response(
        JSON.stringify(ok ? { data: responses[key] } : { error: { message: 'boom' } }),
        {
          status: ok ? 200 : 500,
        },
      );
    }),
  );
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider theme={theme}>
      <QueryClientProvider client={client}>
        <NetWorthPage />
      </QueryClientProvider>
    </MantineProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('NetWorthPage', () => {
  it('renders the hero, groups, accounts and the missing-rate note from the API', async () => {
    mockApi({ 'net-worth': netWorth, balances });
    renderPage();
    expect(await screen.findByText('Rp169.100.000')).toBeTruthy();
    expect(screen.getByText('Kekayaan bersih')).toBeTruthy();
    expect(screen.getByText('BCA')).toBeTruthy();
    expect(screen.getByText('Rp38.100.000')).toBeTruthy();
    // liability shown negative regardless of stored sign
    expect(screen.getByText('CC BCA')).toBeTruthy();
    expect(screen.getAllByText('-Rp2.300.000').length).toBeGreaterThan(0);
    expect(screen.getByRole('note').textContent).toContain('Pluang USD');
  });

  it('shows an empty state when there are no accounts', async () => {
    mockApi({
      'net-worth': { ...netWorth, missing_rates: [] },
      balances: { ...balances, groups: [] },
    });
    renderPage();
    expect(await screen.findByText('Belum ada akun')).toBeTruthy();
  });

  it('shows an error state', async () => {
    mockApi({ 'net-worth': null, balances: null }, false);
    renderPage();
    expect(await screen.findByText('Gagal memuat data')).toBeTruthy();
  });
});
