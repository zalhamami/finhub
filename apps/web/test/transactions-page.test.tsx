import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RouterProvider, createAppRouter } from '../src/router';
import { ThemeRoot } from '../src/theme/AccentProvider';

afterEach(() => vi.unstubAllGlobals());

const A_BCA = '00000000-0000-4000-8000-0000000000a1';
const A_CASH = '00000000-0000-4000-8000-0000000000a2';
const C_FOOD = '00000000-0000-4000-8000-0000000000c1';
const C_SALARY = '00000000-0000-4000-8000-0000000000c2';
const C_FEE = '00000000-0000-4000-8000-0000000000c3';

const acc = (id: string, name: string) => ({
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
});
const cat = (id: string, name: string, kind: string) => ({
  id,
  parent_id: null,
  kind,
  name,
  icon: null,
  color: 'teal',
  sort_order: 0,
  archived_at: null,
  children: [],
});
const entry = (
  account_id: string,
  amount_minor: string,
  category_id: string | null,
  is_fee = false,
) => ({
  id: `${account_id}-${amount_minor}-${is_fee}`,
  account_id,
  category_id,
  amount_minor,
  currency: 'IDR',
  fx_rate: null,
  is_fee,
});
const tx = (id: string, occurred_at: string, kind: string, entries: unknown[], extra = {}) => ({
  id,
  occurred_at,
  kind,
  payee: null,
  note: null,
  status: 'posted',
  source: 'manual',
  archived_at: null,
  entries,
  tag_ids: [],
  ...extra,
});

// fixed old dates so "Hari ini" / "Kemarin" never apply (2025-03-12 is a Wednesday)
const LIST = [
  tx('1', '2025-03-12T08:00:00Z', 'income', [entry(A_BCA, '900000000', C_SALARY)]),
  tx('2', '2025-03-12T05:00:00Z', 'expense', [entry(A_BCA, '-2500000', C_FOOD)], {
    note: 'kopi pagi',
  }),
  tx('3', '2025-03-11T05:00:00Z', 'transfer', [
    entry(A_BCA, '-100000000', null),
    entry(A_CASH, '100000000', null),
    entry(A_BCA, '-650000', C_FEE, true),
  ]),
];

interface Stub {
  list?: (url: URL) => { data: unknown[]; next_cursor: string | null };
}
function stubApi({ list }: Stub = {}) {
  const calls: URL[] = [];
  const routes: Record<string, unknown> = {
    '/api/v1/accounts': [acc(A_BCA, 'BCA'), acc(A_CASH, 'Dompet')],
    '/api/v1/account-types': [],
    '/api/v1/categories': [
      cat(C_FOOD, 'Makan', 'expense'),
      cat(C_SALARY, 'Gaji', 'income'),
      cat(C_FEE, 'Biaya Admin', 'expense'),
    ],
    '/api/v1/reports/balances': { base_currency: 'IDR', groups: [] },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input, 'http://localhost');
      if (url.pathname === '/api/v1/transactions') {
        calls.push(url);
        const body = list ? list(url) : { data: LIST, next_cursor: null };
        return new Response(JSON.stringify(body), { status: 200 });
      }
      return url.pathname in routes
        ? new Response(JSON.stringify({ data: routes[url.pathname] }), { status: 200 })
        : new Response(JSON.stringify({ error: { message: 'x' } }), { status: 404 });
    }),
  );
  return { calls };
}

function renderAt(path: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  render(
    <ThemeRoot>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeRoot>,
  );
  return router;
}

const openFilters = () => fireEvent.click(screen.getByRole('button', { name: /Filter/ }));
async function pick(label: string, option: string) {
  const input = screen.getByRole('combobox', { name: label });
  fireEvent.click(input);
  const listbox = await waitFor(() => {
    const el = document.getElementById(input.getAttribute('aria-controls') ?? '');
    if (!el) throw new Error('no listbox');
    return el;
  });
  fireEvent.click(await within(listbox).findByRole('option', { name: option, hidden: true }));
}

describe('Transaksi page', () => {
  it('renders day groups (Jakarta days) with daily net, titles, notes and transfers', async () => {
    stubApi();
    renderAt('/transaksi');
    const wed = await screen.findByRole('region', { name: 'Rabu, 12 Mar 2025' });
    const tue = screen.getByRole('region', { name: 'Selasa, 11 Mar 2025' });
    // income +9.000.000 and expense -25.000 on the Wednesday
    expect(within(wed).getByText('Rp8.975.000')).toBeTruthy();
    expect(within(wed).getByText('Gaji')).toBeTruthy();
    expect(within(wed).getByText('Makan')).toBeTruthy();
    expect(within(wed).getByText('kopi pagi')).toBeTruthy();
    expect(within(wed).getByText('-Rp25.000')).toBeTruthy();
    // transfer: both accounts in the title, only the fee counts toward the day
    expect(within(tue).getByText('Transfer: BCA → Dompet')).toBeTruthy();
    expect(within(tue).getByText('-Rp6.500', { selector: 'span' })).toBeTruthy();
  });

  it('sends URL filters to the API', async () => {
    const { calls } = stubApi();
    renderAt(`/transaksi?type=income&from=2025-03-01&to=2025-03-31&q=gaji&category=${C_SALARY}`);
    await screen.findByRole('region', { name: 'Rabu, 12 Mar 2025' });
    const q = Object.fromEntries(calls[0]!.searchParams);
    expect(q).toMatchObject({
      kind: 'income',
      from: '2025-03-01',
      to: '2025-03-31',
      q: 'gaji',
      category_id: C_SALARY,
      include_subcategories: 'true',
      limit: '50',
    });
  });

  it('changing a filter updates the URL and refetches', async () => {
    const { calls } = stubApi();
    const router = renderAt('/transaksi');
    await screen.findByRole('region', { name: 'Rabu, 12 Mar 2025' });
    openFilters();
    await pick('Jenis', 'Pengeluaran');
    await waitFor(() => expect(router.state.location.search).toEqual({ type: 'expense' }));
    await waitFor(() =>
      expect(calls.some((u) => u.searchParams.get('kind') === 'expense')).toBe(true),
    );
    await pick('Akun', 'Dompet');
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ type: 'expense', account: A_CASH }),
    );
  });

  it('a quick date preset sets from/to in the URL', async () => {
    stubApi();
    const router = renderAt('/transaksi');
    await screen.findByRole('region', { name: 'Rabu, 12 Mar 2025' });
    openFilters();
    fireEvent.click(screen.getByRole('button', { name: 'Bulan ini' }));
    await waitFor(() => {
      const s = router.state.location.search as { from?: string; to?: string };
      expect(s.from).toMatch(/^\d{4}-\d{2}-01$/);
      expect(s.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  it('search is debounced 300 ms before it reaches the URL', async () => {
    stubApi();
    const router = renderAt('/transaksi');
    await screen.findByRole('region', { name: 'Rabu, 12 Mar 2025' });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fireEvent.change(screen.getByLabelText('Cari transaksi'), { target: { value: 'kop' } });
      fireEvent.change(screen.getByLabelText('Cari transaksi'), { target: { value: 'kopi' } });
      vi.advanceTimersByTime(250);
      expect(router.state.location.search).toEqual({});
      vi.advanceTimersByTime(100);
    } finally {
      vi.useRealTimers();
    }
    await waitFor(() => expect(router.state.location.search).toEqual({ q: 'kopi' }));
  });

  it('no results with filters: message and a reset button that clears the URL', async () => {
    stubApi({ list: () => ({ data: [], next_cursor: null }) });
    const router = renderAt('/transaksi?type=transfer&q=zzz');
    expect(await screen.findByText('Tidak ada transaksi yang cocok')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Reset filter' }).at(-1)!);
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(await screen.findByText('Belum ada transaksi')).toBeTruthy();
  });

  it('empty without filters: invites the first transaction', async () => {
    stubApi({ list: () => ({ data: [], next_cursor: null }) });
    renderAt('/transaksi');
    expect(await screen.findByText('Belum ada transaksi')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Tambah transaksi' }).length).toBeGreaterThan(0);
  });

  it('"Muat lebih banyak" loads the next page with the cursor', async () => {
    const { calls } = stubApi({
      list: (url) =>
        url.searchParams.get('cursor') === 'CUR1'
          ? { data: [LIST[2]], next_cursor: null }
          : { data: [LIST[0], LIST[1]], next_cursor: 'CUR1' },
    });
    renderAt('/transaksi');
    fireEvent.click(await screen.findByRole('button', { name: 'Muat lebih banyak' }));
    expect(await screen.findByRole('region', { name: 'Selasa, 11 Mar 2025' })).toBeTruthy();
    expect(calls.at(-1)!.searchParams.get('cursor')).toBe('CUR1');
    expect(screen.queryByRole('button', { name: 'Muat lebih banyak' })).toBeNull();
  });

  it('clicking a row opens the edit sheet, prefilled', async () => {
    stubApi();
    renderAt('/transaksi');
    fireEvent.click(await screen.findByRole('button', { name: /Makan/ }));
    expect(await screen.findByText('Ubah transaksi')).toBeTruthy();
    const amount = (await screen.findByLabelText('Nominal')) as HTMLInputElement;
    expect(amount.value).toBe('25000');
    expect(screen.getByRole('button', { name: 'Hapus' })).toBeTruthy();
  });
});
