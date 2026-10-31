import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql as q } from 'drizzle-orm';
import postgres from 'postgres';
import { createDb, type DbHandle } from '../src/client';
import { runMigrations } from '../src/migrate';
import { seed } from '../src/seed';
import * as s from '../src/schema';

const url = process.env.DATABASE_URL;
if (!url) console.warn('[finhub/db] DATABASE_URL is not set: skipping DB integration tests');

describe.skipIf(!url)('db schema (real Postgres, scratch database)', () => {
  const dbName = `finhub_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  let admin: postgres.Sql;
  let h: DbHandle;
  let ws: string;
  let acctA: string;
  let acctB: string;

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE ${dbName}`);
    const u = new URL(url!);
    u.pathname = `/${dbName}`;
    h = createDb(u.toString(), { max: 2 });
    await runMigrations(h.db);
    await seed(h.db);

    const [w] = await h.db.insert(s.workspaces).values({ slug: 't', name: 'T' }).returning();
    ws = w!.id;
    const [t] = await h.db
      .insert(s.accountTypes)
      .values({ workspaceId: ws, name: 'Bank', kind: 'bank' })
      .returning();
    const mk = async (name: string) =>
      (
        await h.db.insert(s.accounts).values({ workspaceId: ws, name, typeId: t!.id }).returning()
      )[0]!.id;
    acctA = await mk('A');
    acctB = await mk('B');
  });

  afterAll(async () => {
    await h?.close();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end({ timeout: 5 });
  });

  type E = { account: string; amount: bigint; currency?: string };
  /** Insert header + entries in one DB transaction; constraint triggers fire at commit. */
  const post = (kind: 'expense' | 'income' | 'transfer', status: 'draft' | 'posted', es: E[]) =>
    h.db.transaction(async (tx) => {
      const [t] = await tx
        .insert(s.transactions)
        .values({ workspaceId: ws, kind, status, occurredAt: new Date() })
        .returning();
      if (es.length)
        await tx.insert(s.entries).values(
          es.map((e) => ({
            workspaceId: ws,
            transactionId: t!.id,
            accountId: e.account,
            amountMinor: e.amount,
            currency: e.currency ?? 'IDR',
          })),
        );
      return t!.id;
    });

  it('applied migrations on a fresh database', async () => {
    const r =
      await h.sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'`;
    expect(r[0]!.n).toBeGreaterThanOrEqual(20);
  });

  it('every *_minor column is bigint and no float column exists', async () => {
    const cols = await h.sql<{ column_name: string; data_type: string }[]>`
      SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public'`;
    const minorCols = cols.filter((c) => c.column_name.endsWith('_minor'));
    expect(minorCols.length).toBeGreaterThan(5);
    for (const c of minorCols) expect(c.data_type, c.column_name).toBe('bigint');
    const floats = cols.filter((c) => ['real', 'double precision'].includes(c.data_type));
    expect(floats).toEqual([]);
  });

  it('every user-owned table has NOT NULL workspace_id', async () => {
    const global = ['currencies', 'users', 'workspaces', '__drizzle_migrations'];
    const tables = await h.sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE'`;
    const withWs = await h.sql<{ table_name: string; is_nullable: string }[]>`
      SELECT table_name, is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND column_name='workspace_id'`;
    const map = new Map(withWs.map((r) => [r.table_name, r.is_nullable]));
    for (const { table_name } of tables) {
      if (global.includes(table_name)) continue;
      expect(map.get(table_name), table_name).toBe('NO');
    }
  });

  it('commits a balanced posted transfer', async () => {
    await expect(
      post('transfer', 'posted', [
        { account: acctA, amount: -1000n },
        { account: acctB, amount: 1000n },
      ]),
    ).resolves.toBeTypeOf('string');
  });

  it('rejects an unbalanced posted transfer at commit', async () => {
    await expect(
      post('transfer', 'posted', [
        { account: acctA, amount: -1000n },
        { account: acctB, amount: 900n },
      ]),
    ).rejects.toThrow(/sum to/);
  });

  it('accepts cross-currency transfer keeping both amounts', async () => {
    await expect(
      post('transfer', 'posted', [
        { account: acctA, amount: -1600000n },
        { account: acctB, amount: 10000n, currency: 'USD' },
      ]),
    ).resolves.toBeTypeOf('string');
  });

  it('treats categorised transfer entries as fee lines (excluded from the zero-sum)', async () => {
    const [cat] = await h.db
      .insert(s.categories)
      .values({ workspaceId: ws, kind: 'expense', name: 'Fee' })
      .returning();
    const run = (legs: bigint[], fee?: bigint) =>
      h.db.transaction(async (tx) => {
        const [t] = await tx
          .insert(s.transactions)
          .values({ workspaceId: ws, kind: 'transfer', occurredAt: new Date() })
          .returning();
        const mk = (accountId: string, amountMinor: bigint, categoryId?: string) => ({
          workspaceId: ws,
          transactionId: t!.id,
          accountId,
          amountMinor,
          currency: 'IDR',
          categoryId,
        });
        const rows = legs.map((a, i) => mk(i === 0 ? acctA : acctB, a));
        if (fee !== undefined) rows.push(mk(acctA, fee, cat!.id));
        await tx.insert(s.entries).values(rows);
      });
    await expect(run([-1000n, 1000n], -25n)).resolves.toBeUndefined();
    await expect(run([-1000n, 900n], -25n)).rejects.toThrow(/legs sum to/);
    await expect(run([-1000n], -25n)).rejects.toThrow(/at least two entries/);
  });

  it('rejects expense with two account entries, and posted expense with none', async () => {
    await expect(
      post('expense', 'posted', [
        { account: acctA, amount: -1n },
        { account: acctB, amount: -1n },
      ]),
    ).rejects.toThrow(/exactly one entry/);
    await expect(post('expense', 'posted', [])).rejects.toThrow(/exactly one entry/);
    await expect(post('income', 'posted', [{ account: acctA, amount: 5n }])).resolves.toBeTypeOf(
      'string',
    );
  });

  it('does not check drafts, but checks on draft -> posted', async () => {
    const id = await post('transfer', 'draft', [{ account: acctA, amount: -5n }]);
    const err = await h.db
      .update(s.transactions)
      .set({ status: 'posted' })
      .where(q`id = ${id}`)
      .then(
        () => null,
        (e: Error) => e,
      );
    // drizzle wraps driver errors; the Postgres message is on `cause`
    expect(String((err?.cause as Error | undefined)?.message)).toMatch(/at least two entries/);
  });

  it('round-trips bigint beyond 2^53', async () => {
    const big = 9007199254740993n; // 2^53 + 1
    const id = await post('income', 'posted', [{ account: acctA, amount: big }]);
    const [row] = await h.db
      .select()
      .from(s.entries)
      .where(q`transaction_id = ${id}`);
    expect(row!.amountMinor).toBe(big);
    const [r] =
      await h.sql`SELECT amount_minor::text AS v FROM entries WHERE transaction_id = ${id}`;
    expect(r!.v).toBe('9007199254740993');
  });

  it('enforces unique constraints on fx_rates, prices, balance_snapshots', async () => {
    const fx = {
      workspaceId: ws,
      base: 'USD',
      quote: 'IDR',
      date: '2026-01-01',
      rate: '16000.1234567890',
      source: 'x',
    };
    await h.db.insert(s.fxRates).values(fx);
    await expect(h.db.insert(s.fxRates).values(fx)).rejects.toThrow();
    await h.db.insert(s.fxRates).values({ ...fx, source: 'y' }); // different source ok
    const [row] = await h.db
      .select()
      .from(s.fxRates)
      .where(q`source = 'x'`);
    expect(row!.rate).toBe('16000.1234567890'); // numeric -> exact string

    const [inst] = await h.db
      .insert(s.instruments)
      .values({ workspaceId: ws, kind: 'stock', symbol: 'TEST', name: 'Test' })
      .returning();
    const pr = {
      workspaceId: ws,
      instrumentId: inst!.id,
      date: '2026-01-01',
      price: '100',
      currency: 'IDR',
      source: 'x',
    };
    await h.db.insert(s.prices).values(pr);
    await expect(h.db.insert(s.prices).values(pr)).rejects.toThrow();

    const bs = {
      workspaceId: ws,
      accountId: acctA,
      date: '2026-01-01',
      balanceMinor: 1n,
      valueBaseMinor: 1n,
    };
    await h.db.insert(s.balanceSnapshots).values(bs);
    await expect(h.db.insert(s.balanceSnapshots).values(bs)).rejects.toThrow();
  });

  it('seed is idempotent', async () => {
    const count = async () =>
      (
        await h.sql`SELECT (SELECT count(*) FROM currencies) c, (SELECT count(*) FROM workspaces) w,
          (SELECT count(*) FROM settings) s, (SELECT count(*) FROM account_types) t,
          (SELECT count(*) FROM categories) k`
      )[0]!;
    const before = await count();
    await seed(h.db);
    await seed(h.db);
    expect(await count()).toEqual(before);
    expect(Number(before.c)).toBe(3);
    expect(Number(before.t)).toBe(10 + 1); // 10 seeded + 'Bank' from this test
  });
});
