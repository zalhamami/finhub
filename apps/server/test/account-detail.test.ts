import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import {
  client,
  createTestEnv,
  DATABASE_URL,
  iso,
  lookups,
  type Api,
  type TestEnv,
} from './helpers';

const TODAY = '2026-03-10';

describe.skipIf(!DATABASE_URL)('account detail: balance history + list filter', () => {
  let env: TestEnv;
  let A: Api;
  let B: Api;
  let L: Awaited<ReturnType<typeof lookups>>;

  beforeAll(async () => {
    env = await createTestEnv();
    // fixed clock: 2026-03-10 12:00 Jakarta
    const app = createApp({ db: env.h.db, now: () => new Date(`${TODAY}T12:00:00+07:00`) });
    A = client(app, env.demo);
    B = client(app, env.other);
    L = await lookups(A);
  });
  afterAll(() => env?.close());

  const expense = (account_id: string, amount: string, occurred_at: string) =>
    A('POST', '/transactions', {
      occurred_at,
      kind: 'expense',
      account_id,
      amount_minor: amount,
      category_id: L.cat('Makan & Minum'),
    });
  const income = (account_id: string, amount: string, occurred_at: string) =>
    A('POST', '/transactions', {
      occurred_at,
      kind: 'income',
      account_id,
      amount_minor: amount,
      category_id: L.cat('Gaji'),
    });
  const transfer = (from: string, to: string, amount: string, occurred_at: string) =>
    A('POST', '/transfers', {
      occurred_at,
      from_account_id: from,
      to_account_id: to,
      amount_minor: amount,
    });
  const hist = (id: string, q = '') => A('GET', `/accounts/${id}/balance-history${q}`);

  it('empty account: flat zero series, days+1 points ending today', async () => {
    const id = await L.account('Kosong', 'Bank');
    const r = await hist(id, '?days=30');
    expect(r.status).toBe(200);
    expect(r.data.currency).toBe('IDR');
    expect(r.data.points).toHaveLength(31);
    expect(r.data.points[0]).toEqual({ date: '2026-02-08', balance_minor: '0' });
    expect(r.data.points.at(-1)).toEqual({ date: TODAY, balance_minor: '0' });
    expect(r.data.start_balance_minor).toBe('0');
    expect(r.data.end_balance_minor).toBe('0');
  });

  it('opening balance only (default days=30), native currency', async () => {
    const id = await L.account('USD', 'Bank', { currency: 'USD', opening_balance_minor: '12345' });
    const r = await hist(id);
    expect(r.data.currency).toBe('USD');
    expect(r.data.points).toHaveLength(31);
    expect(new Set(r.data.points.map((p: { balance_minor: string }) => p.balance_minor))).toEqual(
      new Set(['12345']),
    );
    expect(r.data.start_balance_minor).toBe('12345');
    expect(r.data.end_balance_minor).toBe('12345');
  });

  it('expenses, incomes, transfers in/out across days; start is the balance days ago', async () => {
    const a = await L.account('Utama', 'Bank', { opening_balance_minor: '1000000' });
    const b = await L.account('Kedua', 'Bank');
    await expense(a, '100000', iso('2026-01-01')); // before window -> folded into start
    await income(a, '500000', iso('2026-03-05'));
    await expense(a, '200000', iso('2026-03-07'));
    await transfer(a, b, '300000', iso('2026-03-08')); // out
    await transfer(b, a, '50000', iso('2026-03-09')); // in
    const r = await hist(a, '?days=7');
    // window 2026-03-03 .. 2026-03-10 (8 points)
    const m = Object.fromEntries(
      r.data.points.map((p: { date: string; balance_minor: string }) => [p.date, p.balance_minor]),
    );
    expect(r.data.points).toHaveLength(8);
    expect(m['2026-03-03']).toBe('900000');
    expect(m['2026-03-04']).toBe('900000');
    expect(m['2026-03-05']).toBe('1400000');
    expect(m['2026-03-06']).toBe('1400000');
    expect(m['2026-03-07']).toBe('1200000');
    expect(m['2026-03-08']).toBe('900000');
    expect(m['2026-03-09']).toBe('950000');
    expect(m['2026-03-10']).toBe('950000');
    expect(r.data.start_balance_minor).toBe('900000');
    expect(r.data.end_balance_minor).toBe('950000');
    // the other side of the transfers
    const rb = await hist(b, '?days=7');
    expect(rb.data.end_balance_minor).toBe('250000');
  });

  it('day boundary at Jakarta midnight', async () => {
    const id = await L.account('Batas', 'Bank');
    await income(id, '1000', '2026-03-08T23:59:59+07:00'); // 08 (= 16:59:59Z)
    await income(id, '10', '2026-03-09T00:00:00+07:00'); // 09 (= 17:00Z on 08th UTC)
    const r = await hist(id, '?days=3');
    const m = Object.fromEntries(
      r.data.points.map((p: { date: string; balance_minor: string }) => [p.date, p.balance_minor]),
    );
    expect(m['2026-03-07']).toBe('0');
    expect(m['2026-03-08']).toBe('1000');
    expect(m['2026-03-09']).toBe('1010');
  });

  it('ignores archived transactions', async () => {
    const id = await L.account('Arsip', 'Bank');
    const tx = await income(id, '777', iso('2026-03-09'));
    await A('POST', `/transactions/${tx.data.id}/archive`);
    expect((await hist(id, '?days=3')).data.end_balance_minor).toBe('0');
  });

  it('another workspace account / unknown id -> 404; bad id -> 400', async () => {
    const id = await L.account('Rahasia', 'Bank');
    expect((await B('GET', `/accounts/${id}/balance-history`)).status).toBe(404);
    expect((await hist('00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await hist('nope')).status).toBe(400);
  });

  it('validates days (1..365)', async () => {
    const id = await L.account('Valid', 'Bank');
    for (const bad of ['0', '366', '-1', 'abc', '1.5']) {
      expect((await hist(id, `?days=${bad}`)).status, bad).toBe(400);
    }
    expect((await hist(id, '?days=1')).data.points).toHaveLength(2);
    expect((await hist(id, '?days=365')).data.points).toHaveLength(366);
  });

  it('GET /transactions?account_id returns transfers from either side and paginates', async () => {
    const a = await L.account('List A', 'Bank', { opening_balance_minor: '9000000' });
    const b = await L.account('List B', 'Bank');
    const c = await L.account('List C', 'Bank');
    const t1 = await expense(a, '1000', iso('2026-02-01'));
    const t2 = await transfer(a, b, '2000', iso('2026-02-02')); // out of a
    const t3 = await transfer(b, a, '3000', iso('2026-02-03')); // into a
    const t4 = await income(a, '4000', iso('2026-02-04'));
    const other = await transfer(b, c, '5000', iso('2026-02-05')); // not a
    const want = [t4, t3, t2, t1].map((x) => x.data.id);

    const all = await A('GET', `/transactions?account_id=${a}`);
    expect(all.data.map((x: { id: string }) => x.id)).toEqual(want);
    expect(all.data.map((x: { id: string }) => x.id)).not.toContain(other.data.id);

    const got: string[] = [];
    let cursor: string | null = null;
    do {
      const r: { json: { data: { id: string }[]; next_cursor: string | null } } = await A(
        'GET',
        `/transactions?account_id=${a}&limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      got.push(...r.json.data.map((x) => x.id));
      cursor = r.json.next_cursor;
    } while (cursor);
    expect(got).toEqual(want);
  });
});
