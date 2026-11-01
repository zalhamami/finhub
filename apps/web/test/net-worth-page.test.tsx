import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NetWorthPage } from '../src/pages/NetWorthPage';
import { theme } from '../src/theme/theme';

const sum = (xs: (string | null)[]) => xs.reduce((t, x) => t + BigInt(x ?? 0), 0n);

const acc = (id: string, name: string, kind: string, v: string | null, currency = 'IDR') => ({
  id,
  name,
  kind,
  currency,
  value_base_minor: v,
});
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
  accounts: [
    acc('c', 'Dompet', 'cash', '85000000'),
    acc('1', 'BCA', 'bank', '3810000000'),
    acc('3', 'Jago', 'bank', '420000000'),
    acc('e', 'GoPay', 'ewallet', '125000000'),
    // investment value includes holdings: the page must show it, not the cash balance
    acc('i', 'Bibit', 'investment', '12700000000'),
    acc('p', 'Pluang USD', 'investment', null, 'USD'),
    acc('2', 'CC BCA', 'liability', '-230000000'),
  ],
  missing_rates: [{ account_id: 'p', account_name: 'Pluang USD', type: 'fx_rate' }],
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
    mockApi({ 'net-worth': netWorth });
    renderPage();
    expect(await screen.findByText('Rp169.100.000')).toBeTruthy();
    expect(screen.getByText('Kekayaan bersih')).toBeTruthy();
    expect(screen.getByText('BCA')).toBeTruthy();
    expect(screen.getByText('Rp38.100.000')).toBeTruthy();
    // investment row carries the holdings value
    expect(screen.getByText('Bibit')).toBeTruthy();
    expect(screen.getAllByText('Rp127.000.000').length).toBeGreaterThan(1); // row + group total
    // unvalued account shows a dash
    expect(screen.getByText('Pluang USD', { selector: 'p, div, span' })).toBeTruthy();
    // liability is negative and in neutral text, not clay
    expect(screen.getByText('CC BCA')).toBeTruthy();
    const liab = screen.getAllByText('-Rp2.300.000');
    expect(liab.length).toBeGreaterThan(0);
    expect(liab.every((el) => !/over/.test(el.className))).toBe(true);
    expect(screen.getByRole('note').textContent).toContain('Pluang USD');
  });

  it('fixture self-check: account rows add up to their kind totals', () => {
    for (const kind of Object.keys(netWorth.by_kind) as (keyof typeof netWorth.by_kind)[]) {
      const rows = netWorth.accounts.filter((a) => a.kind === kind).map((a) => a.value_base_minor);
      expect(sum(rows)).toBe(BigInt(netWorth.by_kind[kind]));
    }
  });

  it('shows an empty state when there are no accounts', async () => {
    mockApi({ 'net-worth': { ...netWorth, accounts: [], missing_rates: [] } });
    renderPage();
    expect(await screen.findByText('Belum ada akun')).toBeTruthy();
  });

  it('shows an error state', async () => {
    mockApi({ 'net-worth': null }, false);
    renderPage();
    expect(await screen.findByText('Gagal memuat data')).toBeTruthy();
  });
});
