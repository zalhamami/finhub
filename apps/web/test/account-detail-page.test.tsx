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
const entry = (account_id: string, amount_minor: string, extra = {}) => ({
  id: `e-${account_id}-${amount_minor}`,
  account_id,
  category_id: null,
  amount_minor,
  currency: 'IDR',
  fx_rate: null,
  is_fee: false,
  ...extra,
});
const tx = (id: string, occurred_at: string, kind: string, entries: unknown[]) => ({
  id,
  occurred_at,
  kind,
  payee: null,
  note: null,
  status: 'posted',
  source: 'web',
  archived_at: null,
  tag_ids: [],
  entries,
});
const history = {
  currency: 'IDR',
  from: '2026-10-02',
  to: '2026-11-01',
  points: [
    { date: '2026-10-02', balance_minor: '100000000' },
    { date: '2026-10-20', balance_minor: '150000000' },
    { date: '2026-11-01', balance_minor: '120000000' },
  ],
  start_balance_minor: '100000000',
  end_balance_minor: '120000000',
};

function stubApi(opts: { accounts?: unknown[]; txs?: unknown[] } = {}) {
  const accounts = opts.accounts ?? [acc('a1', 'BCA Tahapan'), acc('a2', 'Dompet')];
  const txs = opts.txs ?? [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = url.split('?')[0]!;
      const ok = (data: unknown, extra = {}) =>
        new Response(JSON.stringify({ data, ...extra }), { status: 200 });
      if (path === '/api/v1/accounts') return ok(accounts);
      if (/\/accounts\/[^/]+\/balance-history$/.test(path)) return ok(history);
      if (path === '/api/v1/transactions') return ok(txs, { next_cursor: null });
      if (path === '/api/v1/account-types') return ok([TYPE_BANK]);
      if (path === '/api/v1/account-groups') return ok([]);
      if (path === '/api/v1/categories') return ok([]);
      if (path === '/api/v1/fx-rates') return ok([]);
      if (path === '/api/v1/settings')
        return ok({
          base_currency: 'IDR',
          locale: 'id-ID',
          month_start_day: 1,
          timezone: 'Asia/Jakarta',
          accent: 'amber',
        });
      if (path === '/api/v1/currencies')
        return ok([{ code: 'IDR', minor_unit: 2, display_decimals: 0, symbol: 'Rp' }]);
      if (path === '/api/v1/reports/balances')
        return ok({
          base_currency: 'IDR',
          groups: [
            { accounts: [{ id: 'a1', balance_minor: '120000000', value_base_minor: '120000000' }] },
          ],
        });
      if (path === '/api/v1/reports/net-worth') return ok({ base_currency: 'IDR', accounts: [] });
      return new Response(JSON.stringify({ error: { message: 'x' } }), { status: 404 });
    }),
  );
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

describe('AccountDetailPage', () => {
  it('renders header, name, Ubah, summary caption, balance and change badge', async () => {
    stubApi();
    renderAt('/akun/a1');
    expect(await screen.findByRole('heading', { level: 2, name: 'BCA Tahapan' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ubah' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Kembali ke daftar akun' }).getAttribute('href')).toBe(
      '/akun',
    );
    expect(screen.getByText('30 HARI TERAKHIR')).toBeTruthy();
    const summary = within(screen.getByRole('region', { name: 'Ringkasan akun' }));
    expect(await summary.findByText('Rp1.200.000')).toBeTruthy();
    expect(summary.getByLabelText('Perubahan 30 hari: +20%')).toBeTruthy();
    expect(summary.getByRole('img', { name: /Saldo BCA Tahapan/ })).toBeTruthy();
    expect(summary.getByText('Hari ini')).toBeTruthy(); // last x tick
  });

  it('Ubah opens the AccountForm with the account', async () => {
    stubApi();
    renderAt('/akun/a1');
    fireEvent.click(await screen.findByRole('button', { name: 'Ubah' }));
    expect(((await screen.findByLabelText(/Nama akun/)) as HTMLInputElement).value).toBe(
      'BCA Tahapan',
    );
  });

  it('unknown id -> "Akun tidak ditemukan" with a link back', async () => {
    stubApi();
    renderAt('/akun/nope');
    expect(await screen.findByText('Akun tidak ditemukan')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Kembali ke daftar akun' }).getAttribute('href')).toBe(
      '/akun',
    );
  });

  it('groups by Jakarta day with Indonesian headers; transfers are signed for this account', async () => {
    const out = tx('t1', '2026-10-22T09:00:00+07:00', 'transfer', [
      entry('a1', '-5000000'),
      entry('a2', '5000000'),
    ]);
    const incoming = tx('t2', '2026-10-21T09:00:00+07:00', 'transfer', [
      entry('a2', '-2500000'),
      entry('a1', '2500000'),
    ]);
    stubApi({ txs: [out, incoming] });
    renderAt('/akun/a1');
    const day22 = within(await screen.findByRole('region', { name: '22 Oktober' }));
    expect(day22.getByText('Transfer keluar')).toBeTruthy();
    expect(day22.getByText('BCA Tahapan')).toBeTruthy();
    expect(day22.getByText('Dompet')).toBeTruthy();
    expect(day22.getByText('-Rp50.000')).toBeTruthy();
    expect(day22.getByText('09:00')).toBeTruthy();
    const day21 = within(screen.getByRole('region', { name: '21 Oktober' }));
    expect(day21.getByText('Rp25.000')).toBeTruthy();
    expect(day21.getByText('Transfer masuk')).toBeTruthy();
  });

  it('the mobile floating add button uses the primary color, not gray', async () => {
    stubApi();
    renderAt('/akun/a1');
    await screen.findAllByRole('button', { name: 'Tambah transaksi di akun ini' });
    const fab = document.querySelector('[data-fab]') as HTMLElement;
    expect(fab).toBeTruthy();
    expect(fab.getAttribute('data-variant')).toBe('filled');
    expect(fab.getAttribute('style') ?? '').not.toMatch(/gray/);
    expect(fab.getAttribute('style') ?? '').toMatch(/primary|--ai-bg/);
  });

  it('empty state with an add button', async () => {
    stubApi({ txs: [] });
    renderAt('/akun/a1');
    expect(await screen.findByText('Belum ada transaksi di akun ini')).toBeTruthy();
    expect(
      screen.getAllByRole('button', { name: 'Tambah transaksi di akun ini' }).length,
    ).toBeGreaterThan(0);
  });

  it('the add button opens the sheet with this account preselected', async () => {
    stubApi();
    renderAt('/akun/a1');
    const [btn] = await screen.findAllByRole('button', { name: 'Tambah transaksi di akun ini' });
    fireEvent.click(btn!);
    const dialog = await screen.findByRole('dialog', { name: 'Tambah transaksi' });
    expect(await within(dialog).findByDisplayValue(/BCA Tahapan/)).toBeTruthy();
  });

  it('no add buttons for an archived account', async () => {
    stubApi({ accounts: [acc('a1', 'Lama', { archived_at: '2026-01-01T00:00:00Z' })] });
    renderAt('/akun/a1');
    await screen.findByRole('heading', { level: 2, name: /Lama/ });
    expect(screen.queryByRole('button', { name: 'Tambah transaksi di akun ini' })).toBeNull();
  });
});
