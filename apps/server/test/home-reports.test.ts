import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@finhub/db';
import { createApp } from '../src/app';
import { client, createTestEnv, DATABASE_URL, lookups, type Api, type TestEnv } from './helpers';

const NOW = new Date('2026-11-10T03:00:00Z'); // 2026-11-10 10:00 Asia/Jakarta
const at = (d: string, t = '12:00:00') => `${d}T${t}+07:00`;

describe.skipIf(!DATABASE_URL)('reports: monthly-summary', () => {
  let env: TestEnv;
  let A: Api;
  let AO: Api;

  beforeAll(async () => {
    env = await createTestEnv();
    const app = createApp({ db: env.h.db, now: () => NOW });
    A = client(app, env.demo);
    AO = client(app, env.other);
    const L = await lookups(A);
    const bca = await L.account('BCA', 'Bank');
    const dompet = await L.account('Dompet', 'Cash');
    const wise = await L.account('Wise', 'Bank', { currency: 'USD' });
    const sgd = await L.account('DBS', 'Bank', { currency: 'SGD' });
    await A('POST', '/fx-rates', { base: 'USD', quote: 'IDR', date: '2026-10-01', rate: '16000' });
    await A('POST', '/fx-rates', { base: 'USD', quote: 'IDR', date: '2026-11-05', rate: '17000' });

    const exp = (account_id: string, cat: string, amount_minor: string, occurred_at: string) =>
      A('POST', '/transactions', {
        occurred_at,
        kind: 'expense',
        account_id,
        amount_minor,
        category_id: L.cat(cat),
      });
    const inc = (amount_minor: string, occurred_at: string) =>
      A('POST', '/transactions', {
        occurred_at,
        kind: 'income',
        account_id: bca,
        amount_minor,
        category_id: L.cat('Gaji'),
      });

    // October
    await exp(bca, 'Kopi', '20000', at('2026-10-03'));
    await exp(bca, 'Transportasi', '50000', at('2026-10-20'));
    await exp(bca, 'Belanja', '7000', at('2026-10-31', '23:30:00')); // still October in Jakarta
    await inc('1000000', at('2026-10-05'));
    // November
    await exp(bca, 'Belanja', '3000', at('2026-11-01', '00:30:00')); // 2026-10-31T17:30Z: November in Jakarta
    await exp(bca, 'Makan & Minum', '40000', at('2026-11-02'));
    await exp(wise, 'Transportasi', '10', at('2026-11-03')); // $0.10 x 16000 = Rp1.600
    await exp(wise, 'Transportasi', '10', at('2026-11-06')); // $0.10 x 17000 = Rp1.700
    await exp(sgd, 'Belanja', '100', at('2026-11-08')); // no SGD rate: left out, reported
    await exp(bca, 'Kopi', '10000', at('2026-11-09'));
    await inc('2000000', at('2026-11-05'));
    const tr = await A('POST', '/transfers', {
      occurred_at: at('2026-11-04'),
      from_account_id: bca,
      to_account_id: dompet,
      amount_minor: '500000',
      fee_minor: '1000',
      fee_category_id: L.cat('Biaya admin'),
    });
    expect(tr.status).toBe(201);
    const gone = await exp(bca, 'Belanja', '999999', at('2026-11-07'));
    await A('POST', `/transactions/${gone.data.id}/archive`);
  });
  afterAll(() => env?.close());

  it('totals, previous month, same-day pace, fees included, Jakarta month boundaries', async () => {
    const r = await A('GET', '/reports/monthly-summary?month=2026-11');
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({
      month: '2026-11',
      base_currency: 'IDR',
      current: { income_minor: '2000000', expense_minor: '384000', net_minor: '1616000' },
      previous: {
        month: '2026-10',
        income_minor: '1000000',
        expense_minor: '77000',
        net_minor: '923000',
        expense_to_date_minor: '20000',
      },
      compare_day: 10,
      expense_vs_previous_to_date_minor: '364000',
      transaction_count: 8, // 7 income/expense + 1 transfer; archived excluded
    });
  });

  it('foreign entries use the latest rate on/before their own date; missing rate is reported', async () => {
    const r = await A('GET', '/reports/monthly-summary?month=2026-11');
    expect(r.data.missing_rates).toEqual([{ currency: 'SGD', quote: 'IDR' }]);
    expect(r.data.unconverted_count).toBe(1);
    // 160000 (rate 16000 on 11-03) + 170000 (rate 17000 on 11-06)
    const transport = r.data.top_categories.find(
      (c: { name: string }) => c.name === 'Transportasi',
    );
    expect(transport.amount_minor).toBe('330000');
  });

  it('top categories: children roll up, ranked, shares, last month amounts', async () => {
    const r = await A('GET', '/reports/monthly-summary?month=2026-11');
    const rows = r.data.top_categories as Record<string, unknown>[];
    expect(
      rows.map((x) => [x.name, x.amount_minor, x.previous_amount_minor, x.share_bps, x.is_other]),
    ).toEqual([
      ['Transportasi', '330000', '50000', 8594, false], // 330000/384000
      ['Makan & Minum', '50000', '20000', 1302, false], // + Kopi 10000
      ['Belanja', '3000', '7000', 78, false],
      ['Biaya admin', '1000', '0', 26, false], // transfer fee
    ]);
    expect(rows[0]).toMatchObject({ category_id: expect.any(String), icon: null });
  });

  it('defaults to the current Jakarta month; a past month paces against the whole previous month', async () => {
    expect((await A('GET', '/reports/monthly-summary')).data.month).toBe('2026-11');
    const oct = await A('GET', '/reports/monthly-summary?month=2026-10');
    expect(oct.data.current.expense_minor).toBe('77000');
    expect(oct.data.compare_day).toBe(31);
    expect(oct.data.transaction_count).toBe(4);
  });

  it('empty month / other workspace: zeros, no rows', async () => {
    for (const r of [
      await A('GET', '/reports/monthly-summary?month=2025-01'),
      await AO('GET', '/reports/monthly-summary?month=2026-11'),
    ]) {
      expect(r.status).toBe(200);
      expect(r.data.current).toEqual({ income_minor: '0', expense_minor: '0', net_minor: '0' });
      expect(r.data.top_categories).toEqual([]);
      expect(r.data.transaction_count).toBe(0);
    }
  });

  it('validates month', async () => {
    for (const m of ['2026-13', '202611', 'nov', '2026-1', '']) {
      expect((await A('GET', `/reports/monthly-summary?month=${m}`)).status, m).toBe(400);
    }
  });
});

describe.skipIf(!DATABASE_URL)('reports: net-worth-history', () => {
  let env: TestEnv;
  let A: Api;
  let AO: Api;

  beforeAll(async () => {
    env = await createTestEnv();
    const app = createApp({ db: env.h.db, now: () => NOW });
    A = client(app, env.demo);
    AO = client(app, env.other);
    const L = await lookups(A);
    const bca = await L.account('BCA', 'Bank', { opening_balance_minor: '1000000' });
    await L.account('Wise', 'Bank', { currency: 'USD', opening_balance_minor: '100' });
    const broker = await L.account('Bibit', 'Saham');
    await L.account('Kartu', 'Credit card', { opening_balance_minor: '300000' });
    await A('POST', '/fx-rates', { base: 'USD', quote: 'IDR', date: '2026-01-01', rate: '16000' });
    await A('POST', '/fx-rates', { base: 'USD', quote: 'IDR', date: '2026-11-03', rate: '17000' });
    await A('POST', '/transactions', {
      occurred_at: at('2026-10-15'),
      kind: 'expense',
      account_id: bca,
      amount_minor: '100000',
      category_id: L.cat('Belanja'),
    });
    await A('POST', '/transactions', {
      occurred_at: at('2026-11-05'),
      kind: 'income',
      account_id: bca,
      amount_minor: '500000',
      category_id: L.cat('Gaji'),
    });
    const db = env.h.db;
    const [inst] = await db
      .insert(schema.instruments)
      .values({
        workspaceId: env.demo,
        kind: 'stock',
        symbol: 'BBCA',
        name: 'BCA',
        currency: 'IDR',
      })
      .returning();
    await db
      .insert(schema.holdings)
      .values({ workspaceId: env.demo, accountId: broker, instrumentId: inst!.id, units: '10' });
    await db.insert(schema.prices).values(
      [
        ['2026-10-01', '1000'],
        ['2026-11-02', '1500'],
      ].map(([date, price]) => ({
        workspaceId: env.demo,
        instrumentId: inst!.id,
        date: date!,
        price: price!,
        currency: 'IDR',
        source: 'manual' as const,
      })),
    );
  });
  afterAll(() => env?.close());

  const pts = (r: { data: { points: Record<string, unknown>[] } }) =>
    r.data.points.map((p) => [p.date, p.net_worth_minor, p.source, p.complete]);

  it('computes month-end points from the ledger (balances, fx and prices as of each date)', async () => {
    const r = await A('GET', '/reports/net-worth-history?months=3');
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ base_currency: 'IDR', granularity: 'month' });
    expect(pts(r)).toEqual([
      // BCA 1.000.000 + Wise 1.600.000 + Bibit 10 x 1500 (no price yet: latest used) 1.500.000 - card 300.000
      ['2026-09-30', '3800000', 'ledger', true],
      // BCA 900.000 (10-15 expense) + 1.600.000 + 10 x 1000 = 1.000.000 - 300.000
      ['2026-10-31', '3200000', 'ledger', true],
      // BCA 1.400.000 + $1 x 17000 + 10 x 1500 - 300.000
      ['2026-11-10', '4300000', 'ledger', true],
    ]);
    const p0 = r.data.points[0];
    expect(p0).toMatchObject({ assets_minor: '4100000', liabilities_minor: '-300000' });
  });

  it('the last point equals the live net worth', async () => {
    const live = await A('GET', '/reports/net-worth?as_of=2026-11-10');
    const h = await A('GET', '/reports/net-worth-history');
    expect(h.data.points).toHaveLength(6);
    expect(h.data.points.at(-1).net_worth_minor).toBe(live.data.net_worth_minor);
  });

  it('weekly granularity, validation', async () => {
    const w = await A('GET', '/reports/net-worth-history?months=1&granularity=week');
    expect(w.data.points.map((p: { date: string }) => p.date)).toEqual([
      '2026-11-03',
      '2026-11-10',
    ]);
    for (const q of [
      'months=0',
      'months=61',
      'months=x',
      'granularity=day',
      'months=13&granularity=week',
    ]) {
      expect((await A('GET', `/reports/net-worth-history?${q}`)).status, q).toBe(400);
    }
  });

  it('uses net_worth_snapshots for past dates when present; today is always live', async () => {
    await env.h.db.insert(schema.netWorthSnapshots).values([
      {
        workspaceId: env.demo,
        date: '2026-10-31',
        assetsBaseMinor: 9999999n,
        liabilitiesBaseMinor: -1n,
        netWorthBaseMinor: 9999998n,
        byKind: {},
      },
      {
        workspaceId: env.demo,
        date: '2026-11-10',
        assetsBaseMinor: 1n,
        liabilitiesBaseMinor: 0n,
        netWorthBaseMinor: 1n,
        byKind: {},
      },
    ]);
    const r = await A('GET', '/reports/net-worth-history?months=3');
    expect(pts(r)).toEqual([
      ['2026-09-30', '3800000', 'ledger', true],
      ['2026-10-31', '9999998', 'snapshot', true],
      ['2026-11-10', '4300000', 'ledger', true],
    ]);
  });

  it('other workspace: zero points, scoped', async () => {
    const r = await AO('GET', '/reports/net-worth-history?months=2');
    expect(pts(r)).toEqual([
      ['2026-10-31', '0', 'ledger', true],
      ['2026-11-10', '0', 'ledger', true],
    ]);
  });
});
