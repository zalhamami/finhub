import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@finhub/db';
import { client, createTestEnv, DATABASE_URL, lookups, type Api, type TestEnv } from './helpers';

describe.skipIf(!DATABASE_URL)('reports', () => {
  let env: TestEnv;
  let A: Api;
  let L: Awaited<ReturnType<typeof lookups>>;
  let bca: string;
  let wise: string;
  let card: string;
  let broker: string;
  let sgd: string;
  let groupId: string;

  beforeAll(async () => {
    env = await createTestEnv();
    A = client(env.app, env.demo);
    L = await lookups(A);
    groupId = (await A('POST', '/account-groups', { name: 'Daily' })).data.id;
    bca = await L.account('BCA', 'Bank', { opening_balance_minor: '100000000', group_id: groupId });
    wise = await L.account('Wise', 'Bank', { currency: 'USD', opening_balance_minor: '10000' });
    card = await L.account('Kartu', 'Credit card', { opening_balance_minor: '3000000' });
    broker = await L.account('Bibit', 'Saham');
    sgd = await L.account('DBS SGD', 'Bank', { currency: 'SGD', opening_balance_minor: '5000' });

    await A('POST', '/fx-rates', { base: 'USD', quote: 'IDR', date: '2026-02-01', rate: '16000' });
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
    await db.insert(schema.prices).values([
      {
        workspaceId: env.demo,
        instrumentId: inst!.id,
        date: '2026-01-01',
        price: '1000',
        currency: 'IDR',
        source: 'manual',
      },
      {
        workspaceId: env.demo,
        instrumentId: inst!.id,
        date: '2026-02-01',
        price: '1500',
        currency: 'IDR',
        source: 'manual',
      },
    ]);
  });
  afterAll(() => env?.close());

  const byAccount = (r: { data: { groups: { accounts: { id: string }[] }[] } }) =>
    Object.fromEntries(
      r.data.groups.flatMap((g) => g.accounts).map((a) => [a.id, a]),
    ) as unknown as Record<string, { balance_minor: string; value_base_minor: string | null }>;

  it('balances: per account in own currency and base; missing rate -> null + missing_rates (no 500)', async () => {
    const r = await A('GET', '/reports/balances?group_by=account&as_of=2026-03-01');
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({
      as_of: '2026-03-01',
      base_currency: 'IDR',
      group_by: 'account',
    });
    const a = byAccount(r);
    expect(a[bca]).toMatchObject({ balance_minor: '100000000', value_base_minor: '100000000' });
    expect(a[wise]).toMatchObject({ balance_minor: '10000', value_base_minor: '160000000' }); // $100 x 16000
    expect(a[card]).toMatchObject({ balance_minor: '3000000', value_base_minor: '3000000' });
    expect(a[sgd]).toMatchObject({ balance_minor: '5000', value_base_minor: null });
    expect(r.data.missing_rates).toEqual([
      expect.objectContaining({ account_id: sgd, type: 'fx_rate', currency: 'SGD', quote: 'IDR' }),
    ]);
    expect(r.data.total_base_minor).toBe('263000000'); // missing account excluded from the sum
  });

  it('balances: group_by kind and group', async () => {
    const k = await A('GET', '/reports/balances?group_by=kind&as_of=2026-03-01');
    const kinds = Object.fromEntries(
      k.data.groups.map((g: { key: string; total_base_minor: string }) => [
        g.key,
        g.total_base_minor,
      ]),
    );
    expect(kinds).toEqual({ bank: '260000000', liability: '3000000', investment: '0' });
    expect(k.data.groups.map((g: { key: string }) => g.key)).toEqual([
      'bank',
      'investment',
      'liability',
    ]);
    const g = await A('GET', '/reports/balances?group_by=group&as_of=2026-03-01');
    expect(
      g.data.groups.map((x: { name: string; total_base_minor: string }) => [
        x.name,
        x.total_base_minor,
      ]),
    ).toEqual([
      ['Daily', '100000000'],
      ['Ungrouped', '163000000'],
    ]);
    expect(g.data.groups[1].key).toBeNull();
    expect((await A('GET', '/reports/balances?group_by=nope')).status).toBe(400);
    expect((await A('GET', '/reports/balances?as_of=2026-02-30')).status).toBe(400);
    // default group_by is kind, default as_of is today
    expect((await A('GET', '/reports/balances')).data.group_by).toBe('kind');
  });

  it('balances: fx uses the latest rate on or before as_of; earlier as_of has none', async () => {
    const early = await A('GET', '/reports/balances?group_by=account&as_of=2026-01-15');
    expect(byAccount(early)[wise]!.value_base_minor).toBeNull();
    expect(
      early.data.missing_rates.map((m: { account_id: string }) => m.account_id).sort(),
    ).toEqual([wise, sgd].sort());
    await A('POST', '/fx-rates', { base: 'USD', quote: 'IDR', date: '2026-03-10', rate: '17000' });
    const mid = await A('GET', '/reports/balances?group_by=account&as_of=2026-03-01');
    expect(byAccount(mid)[wise]!.value_base_minor).toBe('160000000');
    const late = await A('GET', '/reports/balances?group_by=account&as_of=2026-03-10');
    expect(byAccount(late)[wise]!.value_base_minor).toBe('170000000');
  });

  it('balances: as_of is end of day in Asia/Jakarta; draft and archived transactions excluded', async () => {
    const acc = await L.account('Tz', 'Cash');
    const post = (occurred_at: string, extra = {}) =>
      A('POST', '/transactions', {
        occurred_at,
        kind: 'income',
        account_id: acc,
        amount_minor: '100',
        category_id: L.cat('Gaji'),
        ...extra,
      });
    await post('2026-04-10T23:30:00+07:00'); // 16:30Z on the 10th: in 04-10
    await post('2026-04-11T00:30:00+07:00'); // 17:30Z on the 10th (UTC date) but 11th in Jakarta
    await post('2026-04-10T10:00:00+07:00', { status: 'draft' });
    const arch = await post('2026-04-10T10:00:00+07:00');
    await A('POST', `/transactions/${arch.data.id}/archive`);
    const bal = async (d: string) =>
      byAccount(await A('GET', `/reports/balances?group_by=account&as_of=${d}`))[acc]!
        .balance_minor;
    expect(await bal('2026-04-09')).toBe('0');
    expect(await bal('2026-04-10')).toBe('100');
    expect(await bal('2026-04-11')).toBe('200');
  });

  it('balances: archived accounts are skipped', async () => {
    const acc = await L.account('Gone', 'Cash', { opening_balance_minor: '1' });
    await A('POST', `/accounts/${acc}/archive`);
    expect(byAccount(await A('GET', '/reports/balances?group_by=account'))[acc]).toBeUndefined();
  });

  it('net-worth: USD via fx, liability negative, holdings x latest price, missing rate listed', async () => {
    const r = await A('GET', '/reports/net-worth?as_of=2026-03-01');
    expect(r.status).toBe(200);
    // assets: 100,000,000 + 160,000,000 + holdings 10 x 1500 IDR = 1,500,000 (+ Tz/Gone are 0 / archived)
    expect(r.data).toMatchObject({
      as_of: '2026-03-01',
      base_currency: 'IDR',
      assets_minor: '261500000',
      liabilities_minor: '-3000000',
      net_worth_minor: '258500000',
    });
    expect(r.data.by_kind).toMatchObject({
      bank: '260000000',
      investment: '1500000',
      liability: '-3000000',
      cash: expect.any(String),
    });
    expect(r.data.missing_rates).toEqual([
      expect.objectContaining({ account_id: sgd, type: 'fx_rate', currency: 'SGD' }),
    ]);
  });

  it('net-worth: per-account rows include holdings and sum to the kind totals', async () => {
    const r = await A('GET', '/reports/net-worth?as_of=2026-03-01');
    const rows = r.data.accounts as {
      id: string;
      kind: string;
      value_base_minor: string | null;
    }[];
    const row = (id: string) => rows.find((x) => x.id === id)!;
    expect(row(broker).value_base_minor).toBe('1500000'); // 10 units x 1500, no cash balance
    expect(row(card).value_base_minor).toBe('-3000000');
    expect(row(sgd).value_base_minor).toBeNull(); // missing rate
    const sums: Record<string, bigint> = {};
    for (const x of rows) sums[x.kind] = (sums[x.kind] ?? 0n) + BigInt(x.value_base_minor ?? 0);
    for (const [kind, total] of Object.entries(r.data.by_kind as Record<string, string>)) {
      expect(sums[kind] ?? 0n).toBe(BigInt(total));
    }
  });

  it('net-worth: price as of date; missing price is reported instead of failing', async () => {
    const jan = await A('GET', '/reports/net-worth?as_of=2026-01-15');
    // price 1000 on 2026-01-01 -> 10 x 1000 = 10,000 IDR = 1,000,000 minor; USD rate not yet available
    expect(jan.data.by_kind.investment).toBe('1000000');
    expect(jan.data.missing_rates.map((m: { account_id: string }) => m.account_id).sort()).toEqual(
      [wise, sgd].sort(),
    );
    const dec = await A('GET', '/reports/net-worth?as_of=2025-12-31');
    expect(dec.status).toBe(200);
    expect(dec.data.missing_rates).toEqual(
      expect.arrayContaining([expect.objectContaining({ account_id: broker, type: 'price' })]),
    );
    expect(dec.data.by_kind.investment).toBe('0');
  });

  it('net-worth reflects transactions, ignores archived/draft, include_in_net_worth=false and other workspaces', async () => {
    const before = BigInt(
      (await A('GET', '/reports/net-worth?as_of=2026-03-01')).data.net_worth_minor,
    );
    const t = await A('POST', '/transactions', {
      occurred_at: '2026-02-15T10:00:00+07:00',
      kind: 'expense',
      account_id: bca,
      amount_minor: '1000000',
      category_id: L.cat('Belanja'),
    });
    const after = BigInt(
      (await A('GET', '/reports/net-worth?as_of=2026-03-01')).data.net_worth_minor,
    );
    expect(before - after).toBe(1000000n);
    await A('POST', `/transactions/${t.data.id}/archive`);
    expect(
      BigInt((await A('GET', '/reports/net-worth?as_of=2026-03-01')).data.net_worth_minor),
    ).toBe(before);
    // liability balance stored ledger-negative counts the same way (-|value|)
    await A('PATCH', `/accounts/${card}`, { opening_balance_minor: '-3000000' });
    expect((await A('GET', '/reports/net-worth?as_of=2026-03-01')).data.liabilities_minor).toBe(
      '-3000000',
    );
    await A('PATCH', `/accounts/${bca}`, { include_in_net_worth: false });
    expect(
      BigInt((await A('GET', '/reports/net-worth?as_of=2026-03-01')).data.net_worth_minor),
    ).toBe(before - 100000000n);
    const other = await client(env.app, env.other)('GET', '/reports/net-worth?as_of=2026-03-01');
    expect(other.data).toMatchObject({
      assets_minor: '0',
      liabilities_minor: '0',
      net_worth_minor: '0',
      missing_rates: [],
    });
  });
});
