import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MonthlySummary } from '../src/lib/api';
import { RouterProvider, createAppRouter } from '../src/router';
import { ThemeRoot } from '../src/theme/AccentProvider';

const CAT = '11111111-1111-4111-8111-111111111111';

const summary = (over: Partial<MonthlySummary> = {}): MonthlySummary => ({
  month: '2026-11',
  base_currency: 'IDR',
  current: { income_minor: '200000000', expense_minor: '38400000', net_minor: '161600000' },
  previous: {
    month: '2026-10',
    income_minor: '100000000',
    expense_minor: '7700000',
    net_minor: '92300000',
    expense_to_date_minor: '2000000',
  },
  compare_day: 10,
  expense_vs_previous_to_date_minor: '-120000000',
  top_categories: [
    {
      category_id: CAT,
      name: 'Makan & Minum',
      icon: 'tools-kitchen-2',
      color: 'orange',
      is_other: false,
      amount_minor: '30000000',
      share_bps: 7813,
      previous_amount_minor: '2000000',
    },
    {
      category_id: null,
      name: 'Lainnya',
      icon: null,
      color: null,
      is_other: true,
      amount_minor: '8400000',
      share_bps: 2187,
      previous_amount_minor: '0',
    },
  ],
  transaction_count: 5,
  missing_rates: [],
  unconverted_count: 0,
  ...over,
});

const json = (data: unknown) =>
  new Response(JSON.stringify({ data, next_cursor: null }), { status: 200 });

function stubApi(opts: { summary?: MonthlySummary; accounts?: unknown[]; txs?: unknown[] } = {}) {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      urls.push(input);
      if (input.includes('monthly-summary')) return json(opts.summary ?? summary());
      if (input.includes('net-worth-history'))
        return json({
          base_currency: 'IDR',
          granularity: 'month',
          points: ['100', '200', '300'].map((v, i) => ({
            date: `2026-0${9 + i}-28`.replace('2026-012', '2026-12'),
            net_worth_minor: v,
            assets_minor: v,
            liabilities_minor: '0',
            source: 'ledger',
            complete: true,
          })),
        });
      if (input.includes('reports/net-worth'))
        return json({
          as_of: '2026-11-10',
          base_currency: 'IDR',
          assets_minor: '430000000',
          liabilities_minor: '0',
          net_worth_minor: '430000000',
          by_kind: {},
          accounts: [],
          missing_rates: [],
        });
      if (input.includes('/transactions')) return json(opts.txs ?? []);
      if (input.includes('/accounts')) return json(opts.accounts ?? [{ id: 'a' }]);
      if (input.includes('/settings'))
        return json({
          base_currency: 'IDR',
          locale: 'id-ID',
          month_start_day: 1,
          timezone: 'Asia/Jakarta',
          accent: 'amber',
        });
      return json([]);
    }),
  );
  return urls;
}

let router: ReturnType<typeof createAppRouter>;
function renderAt(path = '/beranda') {
  router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-10T03:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Beranda', () => {
  it('shows the month, spending vs last month with the pace hint, income and net', async () => {
    stubApi();
    renderAt();
    expect(await screen.findByRole('heading', { name: 'November 2026' })).toBeTruthy();
    expect(
      await screen.findByText('Rp1,2 jt lebih hemat dari bulan lalu di tanggal yang sama'),
    ).toBeTruthy();
    expect(screen.getByLabelText('Perubahan dari bulan lalu').textContent).toBe('+399%');
    expect(screen.getByText('Pemasukan')).toBeTruthy();
    expect(screen.getByText('Selisih')).toBeTruthy();
  });

  it('month switcher: previous works, next is disabled on the current month', async () => {
    const urls = stubApi();
    renderAt();
    await screen.findByRole('heading', { name: 'November 2026' });
    const next = screen.getByRole('button', { name: 'Bulan berikutnya' }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Bulan sebelumnya' }));
    expect(await screen.findByRole('heading', { name: 'Oktober 2026' })).toBeTruthy();
    expect(urls.some((u) => u.includes('monthly-summary?month=2026-10'))).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Bulan berikutnya' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('top categories link to /transaksi filtered by category and month; Lainnya is not a link', async () => {
    stubApi();
    renderAt();
    const link = await screen.findByRole('link', { name: 'Makan & Minum: lihat transaksi' });
    fireEvent.click(link);
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/transaksi'));
    expect(router.state.location.search).toMatchObject({
      category: CAT,
      from: '2026-11-01',
      to: '2026-11-30',
    });
  });

  it('the Lainnya roll-up row is not a link', async () => {
    stubApi();
    renderAt();
    await screen.findByRole('link', { name: 'Makan & Minum: lihat transaksi' });
    expect(screen.getAllByRole('link', { name: /lihat transaksi/ })).toHaveLength(1);
  });

  it('net worth card: current amount, trend, link to /kekayaan', async () => {
    stubApi();
    renderAt();
    expect(await screen.findByRole('img', { name: /Tren kekayaan bersih/ })).toBeTruthy();
    const quick = within(screen.getByRole('navigation', { name: 'Pintasan' }));
    expect(quick.getByRole('link', { name: 'Kekayaan' }).getAttribute('href')).toBe('/kekayaan');
    expect(quick.getByRole('link', { name: 'Akun' }).getAttribute('href')).toBe('/akun');
    expect(quick.getByRole('link', { name: 'Kategori' }).getAttribute('href')).toBe('/kategori');
    fireEvent.click(quick.getByRole('button', { name: 'Tambah transaksi' }));
    expect(await screen.findByRole('dialog', { name: 'Tambah transaksi' })).toBeTruthy();
  });

  it('fresh workspace: welcome card instead of empty cards', async () => {
    stubApi({
      accounts: [],
      txs: [],
      summary: summary({ transaction_count: 0, top_categories: [] }),
    });
    renderAt();
    expect(await screen.findByText('Selamat datang di Finhub')).toBeTruthy();
    expect(screen.queryByText('Kategori teratas')).toBeNull();
  });

  it('empty month with accounts: per-card empty states, recent link present', async () => {
    stubApi({
      txs: [],
      summary: summary({
        current: { income_minor: '0', expense_minor: '0', net_minor: '0' },
        top_categories: [],
        transaction_count: 0,
      }),
    });
    renderAt();
    expect(await screen.findByText('Belum ada pengeluaran bulan ini.')).toBeTruthy();
    expect(screen.getByText('Belum ada transaksi bulan ini.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Lihat semua' }).getAttribute('href')).toBe(
      '/transaksi',
    );
  });

  it('shows skeletons while loading', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    renderAt();
    expect((await screen.findAllByLabelText('Memuat')).length).toBeGreaterThan(0);
  });

  it('API failure shows a retry card, not a crash', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 500 })),
    );
    renderAt();
    expect((await screen.findAllByRole('button', { name: 'Coba lagi' })).length).toBeGreaterThan(0);
  });
});
