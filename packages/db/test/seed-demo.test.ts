import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql as q } from 'drizzle-orm';
import postgres from 'postgres';
import { createDb, type DbHandle } from '../src/client';
import { runMigrations } from '../src/migrate';
import { seedIfFresh } from '../src/seed';
import { seedDemo } from '../src/seed-demo';
import * as s from '../src/schema';

const url = process.env.DATABASE_URL;
if (!url) console.warn('[finhub/db] DATABASE_URL is not set: skipping seed-demo tests');

const TODAY = '2026-03-15';

describe.skipIf(!url)('demo seed (scratch database)', () => {
  const dbName = `finhub_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  let admin: postgres.Sql;
  let h: DbHandle;
  let ws: string;

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE ${dbName}`);
    const u = new URL(url!);
    u.pathname = `/${dbName}`;
    h = createDb(u.toString(), { max: 2 });
    await runMigrations(h.db);
  });

  afterAll(async () => {
    await h?.close();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end({ timeout: 5 });
  });

  const counts = async () => {
    const n = async (t: string) =>
      Number((await h.sql.unsafe(`select count(*)::int as n from ${t}`))[0]!.n);
    return {
      accounts: await n('accounts'),
      transactions: await n('transactions'),
      entries: await n('entries'),
      fx: await n('fx_rates'),
      prices: await n('prices'),
      holdings: await n('holdings'),
      categories: await n('categories'),
    };
  };

  it('seedIfFresh seeds an empty database once and never again (deleted base data stays deleted)', async () => {
    expect(await seedIfFresh(h.db)).toBe(true);
    const types = (await h.sql`select count(*)::int n from account_types`)[0]!.n;
    expect(types).toBeGreaterThan(5);
    await h.sql`delete from account_types where name = 'Loan'`;
    expect(await seedIfFresh(h.db)).toBe(false);
    const left = (await h.sql`select count(*)::int n from account_types where name = 'Loan'`)[0]!.n;
    expect(left).toBe(0);
    // no accounts / transactions from the base seed
    const accs = (await h.sql`select count(*)::int n from accounts`)[0]!.n;
    expect(accs).toBe(0);
  });

  it('creates accounts of every kind, holdings, rates and ~3 months of transactions', async () => {
    const r = await seedDemo(h.db, { today: TODAY });
    expect(r.created).toBe(true);
    expect(r.accounts).toBe(8);
    expect(r.transactions).toBeGreaterThan(150);

    ws = (await h.db.select().from(s.workspaces).where(eq(s.workspaces.slug, 'demo')))[0]!.id;
    const rows = await h.db
      .select({ name: s.accounts.name, kind: s.accountTypes.kind, currency: s.accounts.currency })
      .from(s.accounts)
      .innerJoin(s.accountTypes, eq(s.accounts.typeId, s.accountTypes.id))
      .where(eq(s.accounts.workspaceId, ws));
    expect(new Set(rows.map((x) => x.kind))).toEqual(
      new Set(['cash', 'bank', 'ewallet', 'investment', 'liability']),
    );
    expect(rows.find((x) => x.currency === 'USD')?.name).toBe('Bank Demo USD');

    const card = await h.db
      .select()
      .from(s.accounts)
      .where(eq(s.accounts.name, 'Kartu Kredit Demo'));
    expect(card[0]!.creditLimitMinor).toBe(2_000_000_000n);
    expect(card[0]!.statementDay).toBe(20);
    expect(card[0]!.dueDay).toBe(8);

    const span = (await h.sql`select min(occurred_at) a, max(occurred_at) b from transactions`)[0]!;
    const days = (new Date(span.b).getTime() - new Date(span.a).getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(80);
    expect(days).toBeLessThan(91);
  });

  it('is balanced: transfers net to zero (fee lines aside), one entry per expense/income', async () => {
    const bad = await h.sql`
      select t.id from transactions t join entries e on e.transaction_id = t.id
      where t.kind = 'transfer' and e.category_id is null
      group by t.id
      having count(distinct e.currency) = 1 and sum(e.amount_minor) <> 0`;
    expect(bad).toHaveLength(0);
    const single = await h.sql`
      select t.id from transactions t join entries e on e.transaction_id = t.id
      where t.kind in ('expense','income') group by t.id having count(*) <> 1`;
    expect(single).toHaveLength(0);
    const kinds = await h.sql`select kind, count(*)::int n from transactions group by kind`;
    const byKind = Object.fromEntries(kinds.map((k) => [k.kind as string, k.n as number]));
    expect(byKind.expense).toBeGreaterThan(100);
    expect(byKind.income).toBeGreaterThanOrEqual(5); // 3 salaries + freelance + bonus
    expect(byKind.transfer).toBeGreaterThan(8);
    const fees = await h.sql`
      select count(*)::int n from entries e join transactions t on t.id = e.transaction_id
      where t.kind = 'transfer' and e.category_id is not null and e.amount_minor < 0`;
    expect(fees[0]!.n).toBeGreaterThan(3);
    const cross = await h.sql`
      select t.id from transactions t join entries e on e.transaction_id = t.id
      where t.kind = 'transfer' group by t.id having count(distinct e.currency) = 2`;
    expect(cross.length).toBeGreaterThanOrEqual(1);
  });

  it('holdings: two instruments with prices; value = sum(units x latest price)', async () => {
    const hs = await h.db.select().from(s.holdings);
    expect(hs).toHaveLength(2);
    let total = 0n; // in IDR minor units, exact
    for (const hd of hs) {
      const [p] = await h.sql`
        select price::text p from prices where instrument_id = ${hd.instrumentId}
        order by date desc limit 1`;
      const [wholeU = '0', fracU = ''] = hd.units.split('.');
      const [wholeP = '0', fracP = ''] = (p!.p as string).split('.');
      // units x price, scaled by 10^(fracU+fracP digits), then to minor (x100)
      const scale = 10n ** BigInt(fracU.length + fracP.length);
      const prod = BigInt(wholeU + fracU) * BigInt(wholeP + fracP);
      total += (prod * 100n) / scale;
    }
    expect(total).toBeGreaterThan(30_000_000n * 100n);
    expect(total).toBeLessThan(80_000_000n * 100n);
    const instruments = await h.db.select().from(s.instruments);
    expect(instruments.map((i) => i.kind).sort()).toEqual(['gold', 'mutual_fund']);
  });

  it('USD account has rates covering the whole period (latest on the last day)', async () => {
    const rates = await h.db.select().from(s.fxRates).orderBy(s.fxRates.date);
    expect(rates.length).toBeGreaterThan(10);
    expect(rates.every((r) => r.base === 'USD' && r.quote === 'IDR')).toBe(true);
    expect(rates.at(-1)!.date).toBe(TODAY);
    expect(Number(rates[0]!.rate)).toBeGreaterThan(15_000);
  });

  it('rerun is a no-op (also with another seed / date)', async () => {
    const before = await counts();
    const again = await seedDemo(h.db, { today: TODAY });
    expect(again).toEqual({ created: false, accounts: 0, transactions: 0 });
    const other = await seedDemo(h.db, { today: '2026-06-01', seed: 7 });
    expect(other.created).toBe(false);
    expect(await counts()).toEqual(before);
  });

  it('is deterministic for a fixed today + seed', async () => {
    const snapshot = async () =>
      (
        await h.sql`select kind, payee, amount_minor::text amt from transactions t
          join entries e on e.transaction_id = t.id order by occurred_at, payee, amount_minor`
      ).map((r) => `${r.kind}|${r.payee}|${r.amt}`);
    const a = await snapshot();
    await h.db.execute(q`delete from transactions`);
    await h.db.execute(q`delete from accounts`);
    await seedDemo(h.db, { today: TODAY });
    expect(await snapshot()).toEqual(a);
  });
});
