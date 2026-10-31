import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  client,
  createTestEnv,
  DATABASE_URL,
  iso,
  lookups,
  type Api,
  type TestEnv,
} from './helpers';

describe.skipIf(!DATABASE_URL)('transactions & transfers', () => {
  let env: TestEnv;
  let A: Api;
  let B: Api;
  let L: Awaited<ReturnType<typeof lookups>>;
  let bca: string;
  let cash: string;
  let usd: string;
  let food: string;
  let coffee: string;
  let salary: string;
  let adminFee: string;

  beforeAll(async () => {
    env = await createTestEnv();
    A = client(env.app, env.demo);
    B = client(env.app, env.other);
    L = await lookups(A);
    bca = await L.account('BCA', 'Bank', { opening_balance_minor: '100000000' });
    cash = await L.account('Dompet', 'Cash');
    usd = await L.account('Wise USD', 'Bank', { currency: 'USD' });
    food = L.cat('Makan & Minum');
    coffee = L.cat('Kopi');
    salary = L.cat('Gaji');
    adminFee = L.cat('Biaya admin');
  });
  afterAll(() => env?.close());

  /** account id -> balance_minor (string) at as_of */
  const balances = async (asOf = '2030-01-01') => {
    const r = await A('GET', `/reports/balances?group_by=account&as_of=${asOf}`);
    const out: Record<string, string> = {};
    for (const g of r.data.groups) for (const a of g.accounts) out[a.id] = a.balance_minor;
    return out;
  };
  const expense = (over: Record<string, unknown> = {}) => ({
    occurred_at: iso('2026-03-01'),
    kind: 'expense',
    account_id: bca,
    amount_minor: '2500000',
    category_id: food,
    ...over,
  });

  it('expense: negative entry, header + entry in one response, bigint as string', async () => {
    const r = await A('POST', '/transactions', expense({ payee: 'Warung', note: 'lunch' }));
    expect(r.status).toBe(201);
    expect(r.data).toMatchObject({
      kind: 'expense',
      status: 'posted',
      source: 'manual',
      payee: 'Warung',
      note: 'lunch',
      archived_at: null,
      tag_ids: [],
    });
    expect(r.data.entries).toHaveLength(1);
    expect(r.data.entries[0]).toMatchObject({
      account_id: bca,
      category_id: food,
      amount_minor: '-2500000',
      currency: 'IDR',
      is_fee: false,
    });
    expect((await balances())[bca]).toBe('97500000');
    expect((await A('GET', `/transactions/${r.data.id}`)).data.entries[0].amount_minor).toBe(
      '-2500000',
    );
  });

  it('income is positive; adjustment is signed as given and has no category', async () => {
    const inc = await A('POST', '/transactions', {
      occurred_at: iso('2026-03-02'),
      kind: 'income',
      account_id: cash,
      amount_minor: 5000000,
      category_id: salary,
    });
    expect(inc.status).toBe(201);
    expect(inc.data.entries[0].amount_minor).toBe('5000000');
    const adj = await A('POST', '/transactions', {
      occurred_at: iso('2026-03-02'),
      kind: 'adjustment',
      account_id: cash,
      amount_minor: '-1000000',
    });
    expect(adj.status).toBe(201);
    expect(adj.data.entries[0]).toMatchObject({ amount_minor: '-1000000', category_id: null });
    const adj2 = await A('POST', '/transactions', {
      occurred_at: iso('2026-03-02'),
      kind: 'adjustment',
      account_id: cash,
      amount_minor: '300000',
    });
    expect(adj2.data.entries[0].amount_minor).toBe('300000');
    expect((await balances())[cash]).toBe('4300000');
  });

  it('validation errors', async () => {
    const bad: [string, Record<string, unknown>][] = [
      ['zero expense', expense({ amount_minor: '0' })],
      ['negative expense magnitude', expense({ amount_minor: '-5' })],
      ['expense without category', expense({ category_id: undefined })],
      ['null category on income', { ...expense({ kind: 'income', category_id: null }) }],
      ['unknown field', expense({ nope: 1 })],
      ['transfer kind on /transactions', expense({ kind: 'transfer' })],
      ['bad date', expense({ occurred_at: '2026-03-01' })],
      ['non-integer amount', expense({ amount_minor: '12.5' })],
      ['int64 overflow', expense({ amount_minor: '9223372036854775808' })],
      ['bad status', expense({ status: 'void' })],
    ];
    for (const [name, body] of bad) {
      const r = await A('POST', '/transactions', body);
      expect(r.status, name).toBe(400);
      expect(r.error.code, name).toBe('validation_error');
    }
    const adjCat = await A('POST', '/transactions', {
      ...expense({ kind: 'adjustment', amount_minor: '5' }),
    });
    expect(adjCat.status).toBe(400);
    const adjZero = await A('POST', '/transactions', {
      occurred_at: iso('2026-03-01'),
      kind: 'adjustment',
      account_id: bca,
      amount_minor: '0',
    });
    expect(adjZero.status).toBe(400);
  });

  it('category kind must match the transaction kind', async () => {
    const r1 = await A('POST', '/transactions', expense({ category_id: salary }));
    expect(r1.status).toBe(400);
    expect(r1.error.code).toBe('category_kind_mismatch');
    const r2 = await A('POST', '/transactions', expense({ kind: 'income', category_id: food }));
    expect(r2.error.code).toBe('category_kind_mismatch');
    const r3 = await A('POST', '/transfers', {
      occurred_at: iso('2026-03-01'),
      from_account_id: bca,
      to_account_id: cash,
      amount_minor: '1000',
      fee_minor: '10',
      fee_category_id: salary,
    });
    expect(r3.error.code).toBe('category_kind_mismatch');
  });

  it('rejects references from another workspace (400 invalid_reference) and archived accounts (409)', async () => {
    const bType = (await B('POST', '/account-types', { name: 'B', kind: 'bank' })).data.id;
    const bAcc = (await B('POST', '/accounts', { name: 'B acc', type_id: bType })).data.id;
    const bCat = (await B('POST', '/categories', { name: 'B cat', kind: 'expense' })).data.id;
    const bTag = (await B('POST', '/tags', { name: 'b-tag' })).data.id;
    const ref = async (body: unknown, path = '/transactions') => {
      const r = await A('POST', path, body);
      expect(r.status).toBe(400);
      expect(r.error.code).toBe('invalid_reference');
      return r.error.details.field;
    };
    expect(await ref(expense({ account_id: bAcc }))).toBe('account_id');
    expect(await ref(expense({ category_id: bCat }))).toBe('category_id');
    expect(await ref(expense({ tag_ids: [bTag] }))).toBe('tag_ids');
    const tr = {
      occurred_at: iso('2026-03-01'),
      amount_minor: '100',
      from_account_id: bca,
      to_account_id: cash,
    };
    expect(await ref({ ...tr, from_account_id: bAcc }, '/transfers')).toBe('from_account_id');
    expect(await ref({ ...tr, to_account_id: bAcc }, '/transfers')).toBe('to_account_id');
    expect(await ref({ ...tr, fee_minor: '1', fee_category_id: bCat }, '/transfers')).toBe(
      'fee_category_id',
    );
    expect(await ref({ ...tr, tag_ids: [bTag] }, '/transfers')).toBe('tag_ids');
    // list filters are checked too
    for (const q of [`account_id=${bAcc}`, `category_id=${bCat}`, `tag_id=${bTag}`]) {
      expect((await A('GET', `/transactions?${q}`)).error.code).toBe('invalid_reference');
    }
    // PATCH
    const t = (await A('POST', '/transactions', expense())).data.id;
    expect((await A('PATCH', `/transactions/${t}`, { account_id: bAcc })).error.code).toBe(
      'invalid_reference',
    );
    expect((await A('PATCH', `/transactions/${t}`, { category_id: bCat })).error.code).toBe(
      'invalid_reference',
    );
    expect((await A('PATCH', `/transactions/${t}`, { tag_ids: [bTag] })).error.code).toBe(
      'invalid_reference',
    );
    // other workspace cannot see/modify the transaction
    expect((await B('GET', `/transactions/${t}`)).status).toBe(404);
    expect((await B('PATCH', `/transactions/${t}`, { note: 'x' })).status).toBe(404);
    expect((await B('POST', `/transactions/${t}/archive`)).status).toBe(404);
    expect((await B('DELETE', `/transactions/${t}`)).status).toBe(404);
    expect((await B('GET', '/transactions')).data).toEqual([]);

    const old = await L.account('Old', 'Cash');
    await A('POST', `/accounts/${old}/archive`);
    const arch = await A('POST', '/transactions', expense({ account_id: old }));
    expect(arch.status).toBe(409);
    expect(arch.error.code).toBe('account_archived');
  });

  describe('transfers', () => {
    const tr = (over: Record<string, unknown> = {}) => ({
      occurred_at: iso('2026-04-01'),
      from_account_id: bca,
      to_account_id: cash,
      amount_minor: '10000000',
      ...over,
    });

    it('same currency: two legs netting to zero, balances move', async () => {
      const before = await balances();
      const r = await A('POST', '/transfers', tr({ note: 'tarik tunai' }));
      expect(r.status).toBe(201);
      expect(r.data.kind).toBe('transfer');
      expect(r.data.entries.map((e: { amount_minor: string }) => e.amount_minor)).toEqual([
        '-10000000',
        '10000000',
      ]);
      const after = await balances();
      expect(BigInt(after[bca]!) - BigInt(before[bca]!)).toBe(-10000000n);
      expect(BigInt(after[cash]!) - BigInt(before[cash]!)).toBe(10000000n);
    });

    it('with fee: fee is a separate negative entry on the source with the expense category', async () => {
      const before = await balances();
      const r = await A(
        'POST',
        '/transfers',
        tr({
          amount_minor: '5000000',
          fee_minor: '650000',
          fee_category_id: adminFee,
          tag_ids: [],
        }),
      );
      expect(r.status).toBe(201);
      expect(r.data.entries).toHaveLength(3);
      const [out, inn, fee] = r.data.entries;
      expect(out).toMatchObject({
        account_id: bca,
        amount_minor: '-5000000',
        category_id: null,
        is_fee: false,
      });
      expect(inn).toMatchObject({ account_id: cash, amount_minor: '5000000', category_id: null });
      expect(fee).toMatchObject({
        account_id: bca,
        amount_minor: '-650000',
        category_id: adminFee,
        is_fee: true,
      });
      const after = await balances();
      expect(BigInt(after[bca]!) - BigInt(before[bca]!)).toBe(-5650000n);
      expect(BigInt(after[cash]!) - BigInt(before[cash]!)).toBe(5000000n);
      // fee shows up under its category filter
      const byCat = await A('GET', `/transactions?category_id=${adminFee}`);
      expect(byCat.data.map((x: { id: string }) => x.id)).toEqual([r.data.id]);
    });

    it('cross-currency keeps both amounts; to_amount_minor required iff currencies differ', async () => {
      const r = await A(
        'POST',
        '/transfers',
        tr({ to_account_id: usd, amount_minor: '16000000', to_amount_minor: '1000' }),
      );
      expect(r.status).toBe(201);
      expect(
        r.data.entries.map((e: { amount_minor: string; currency: string }) => [
          e.amount_minor,
          e.currency,
        ]),
      ).toEqual([
        ['-16000000', 'IDR'],
        ['1000', 'USD'],
      ]);
      const missing = await A('POST', '/transfers', tr({ to_account_id: usd }));
      expect(missing.status).toBe(400);
      expect(missing.error.details.issues[0].path).toBe('to_amount_minor');
      const mismatch = await A('POST', '/transfers', tr({ to_amount_minor: '999' }));
      expect(mismatch.status).toBe(400);
      // same value is accepted when currencies match
      expect((await A('POST', '/transfers', tr({ to_amount_minor: '10000000' }))).status).toBe(201);
    });

    it('rejects same account, non-positive amounts, half-specified fee, unknown fields', async () => {
      const bad: Record<string, unknown>[] = [
        tr({ to_account_id: bca }),
        tr({ amount_minor: '0' }),
        tr({ amount_minor: '-5' }),
        tr({ fee_minor: '5' }),
        tr({ fee_category_id: adminFee }),
        tr({ fee_minor: '0', fee_category_id: adminFee }),
        tr({ extra: true }),
      ];
      for (const b of bad) {
        const r = await A('POST', '/transfers', b);
        expect(r.status, JSON.stringify(b)).toBe(400);
        expect(r.error.code).toBe('validation_error');
      }
    });
  });

  describe('edit, archive, delete', () => {
    it('PATCH header fields and tags', async () => {
      const tag1 = (await A('POST', '/tags', { name: 'e1' })).data.id;
      const tag2 = (await A('POST', '/tags', { name: 'e2' })).data.id;
      const t = (await A('POST', '/transactions', expense({ tag_ids: [tag1, tag1] }))).data;
      expect(t.tag_ids).toEqual([tag1]);
      const p = await A('PATCH', `/transactions/${t.id}`, {
        payee: 'Kafe',
        note: null,
        occurred_at: iso('2026-03-05'),
        tag_ids: [tag2],
      });
      expect(p.status).toBe(200);
      expect(p.data).toMatchObject({ payee: 'Kafe', note: null, tag_ids: [tag2] });
      expect(new Date(p.data.occurred_at).toISOString()).toBe(
        new Date(iso('2026-03-05')).toISOString(),
      );
      expect(p.data.entries[0].amount_minor).toBe('-2500000');
      expect((await A('PATCH', `/transactions/${t.id}`, {})).status).toBe(400);
      expect((await A('PATCH', `/transactions/${t.id}`, { kind: 'income' })).status).toBe(400);
      expect((await A('PATCH', `/transactions/${t.id}`, { from_account_id: bca })).status).toBe(
        400,
      );
    });

    it('PATCH amount / account / category replaces the entries and moves balances', async () => {
      const acc2 = await L.account('Replace target', 'Bank');
      const t = (
        await A('POST', '/transactions', expense({ account_id: acc2, amount_minor: '1000' }))
      ).data;
      expect((await balances())[acc2]).toBe('-1000');
      const p = await A('PATCH', `/transactions/${t.id}`, {
        amount_minor: '4000',
        category_id: coffee,
      });
      expect(p.data.entries).toHaveLength(1);
      expect(p.data.entries[0]).toMatchObject({
        amount_minor: '-4000',
        category_id: coffee,
        account_id: acc2,
      });
      expect((await balances())[acc2]).toBe('-4000');
      const moved = await A('PATCH', `/transactions/${t.id}`, { account_id: cash });
      expect(moved.data.entries[0].account_id).toBe(cash);
      expect((await balances())[acc2]).toBe('0');
      expect((await A('PATCH', `/transactions/${t.id}`, { category_id: salary })).error.code).toBe(
        'category_kind_mismatch',
      );
      expect((await A('PATCH', `/transactions/${t.id}`, { category_id: null })).status).toBe(400);
      expect((await A('PATCH', `/transactions/${t.id}`, { amount_minor: '0' })).status).toBe(400);
    });

    it('PATCH a transfer: amount, fee add/remove, to_amount; cross-currency rules', async () => {
      const a = await L.account('T-from', 'Bank');
      const b = await L.account('T-to', 'Bank');
      const t = (
        await A('POST', '/transfers', {
          occurred_at: iso('2026-05-01'),
          from_account_id: a,
          to_account_id: b,
          amount_minor: '1000',
        })
      ).data;
      let p = await A('PATCH', `/transactions/${t.id}`, {
        amount_minor: '2000',
        fee_minor: '30',
        fee_category_id: adminFee,
      });
      expect(p.status).toBe(200);
      expect(p.data.entries.map((e: { amount_minor: string }) => e.amount_minor)).toEqual([
        '-2000',
        '2000',
        '-30',
      ]);
      p = await A('PATCH', `/transactions/${t.id}`, { fee_minor: null });
      expect(p.data.entries.map((e: { amount_minor: string }) => e.amount_minor)).toEqual([
        '-2000',
        '2000',
      ]);
      expect((await balances())[a]).toBe('-2000');
      // switching the destination to a USD account requires to_amount_minor
      expect((await A('PATCH', `/transactions/${t.id}`, { to_account_id: usd })).status).toBe(400);
      p = await A('PATCH', `/transactions/${t.id}`, { to_account_id: usd, to_amount_minor: '12' });
      expect(
        p.data.entries.map(
          (e: { amount_minor: string; currency: string }) => `${e.amount_minor}${e.currency}`,
        ),
      ).toEqual(['-2000IDR', '12USD']);
      // changing only the amount keeps the destination amount
      p = await A('PATCH', `/transactions/${t.id}`, { amount_minor: '3000' });
      expect(p.data.entries.map((e: { amount_minor: string }) => e.amount_minor)).toEqual([
        '-3000',
        '12',
      ]);
      expect((await A('PATCH', `/transactions/${t.id}`, { account_id: a })).status).toBe(400);
    });

    it('draft -> posted is validated; drafts are not', async () => {
      const t = await A('POST', '/transactions', expense({ status: 'draft' }));
      expect(t.data.status).toBe('draft');
      const p = await A('PATCH', `/transactions/${t.data.id}`, { status: 'posted' });
      expect(p.status).toBe(200);
      expect(p.data.status).toBe('posted');
    });

    it('archived transactions drop out of balances; unarchive restores them', async () => {
      const acc = await L.account('Arch acc', 'Bank', { opening_balance_minor: '1000' });
      const t = (
        await A('POST', '/transactions', expense({ account_id: acc, amount_minor: '400' }))
      ).data;
      expect((await balances())[acc]).toBe('600');
      const a = await A('POST', `/transactions/${t.id}/archive`);
      expect(a.status).toBe(200);
      expect(a.data.archived_at).not.toBeNull();
      expect((await balances())[acc]).toBe('1000');
      expect((await A('GET', `/transactions?account_id=${acc}`)).data).toEqual([]);
      expect(
        (await A('GET', `/transactions?account_id=${acc}&include_archived=true`)).data,
      ).toHaveLength(1);
      expect((await A('GET', `/transactions/${t.id}`)).status).toBe(200);
      const u = await A('POST', `/transactions/${t.id}/unarchive`);
      expect(u.data.archived_at).toBeNull();
      expect((await balances())[acc]).toBe('600');
    });

    it('draft transactions are excluded from balances', async () => {
      const acc = await L.account('Draft acc', 'Bank');
      await A(
        'POST',
        '/transactions',
        expense({ account_id: acc, amount_minor: '400', status: 'draft' }),
      );
      expect((await balances())[acc]).toBe('0');
    });

    it('DELETE removes the transaction, entries and tag links', async () => {
      const tag = (await A('POST', '/tags', { name: 'del' })).data.id;
      const t = (
        await A('POST', '/transfers', {
          occurred_at: iso('2026-05-02'),
          from_account_id: bca,
          to_account_id: cash,
          amount_minor: '10',
          fee_minor: '1',
          fee_category_id: adminFee,
          tag_ids: [tag],
        })
      ).data;
      expect((await A('DELETE', `/transactions/${t.id}`)).data).toEqual({ id: t.id });
      expect((await A('GET', `/transactions/${t.id}`)).status).toBe(404);
      const left = await env.h
        .sql`SELECT (SELECT count(*) FROM entries WHERE transaction_id = ${t.id})::int AS e, (SELECT count(*) FROM transaction_tags WHERE transaction_id = ${t.id})::int AS t`;
      expect(left[0]).toEqual({ e: 0, t: 0 });
      expect((await A('DELETE', `/transactions/${t.id}`)).status).toBe(404);
    });

    it('DB trigger is the backstop for direct writes that skip the API checks', async () => {
      const attempt = env.h.sql.begin(async (sql) => {
        const [h] =
          await sql`INSERT INTO transactions (workspace_id, occurred_at, kind) VALUES (${env.demo}, now(), 'transfer') RETURNING id`;
        await sql`INSERT INTO entries (workspace_id, transaction_id, account_id, amount_minor, currency) VALUES (${env.demo}, ${h!.id}, ${bca}, -100, 'IDR'), (${env.demo}, ${h!.id}, ${cash}, 90, 'IDR')`;
      });
      await expect(attempt).rejects.toThrow(/sum to/);
    });
  });

  describe('list: filters and cursor pagination', () => {
    let env2: TestEnv;
    let C: Api;
    let a1: string;
    let a2: string;
    let tagX: string;
    const ids: string[] = [];
    let cats: { kopi: string; food: string };

    beforeAll(async () => {
      env2 = await createTestEnv();
      C = client(env2.app, env2.demo);
      const l = await lookups(C);
      a1 = await l.account('A1', 'Bank');
      a2 = await l.account('A2', 'Cash');
      tagX = (await C('POST', '/tags', { name: 'x' })).data.id;
      const make = async (body: Record<string, unknown>) => {
        const r = await C('POST', '/transactions', body);
        expect(r.status).toBe(201);
        ids.push(r.data.id);
        return r.data;
      };
      // 7 transactions; the last three share the same timestamp to exercise the id tiebreak
      await make({
        occurred_at: iso('2026-01-01'),
        kind: 'expense',
        account_id: a1,
        amount_minor: '100',
        category_id: l.cat('Kopi'),
        payee: 'Kopi Kenangan',
        tag_ids: [tagX],
      });
      await make({
        occurred_at: iso('2026-01-02'),
        kind: 'expense',
        account_id: a1,
        amount_minor: '200',
        category_id: l.cat('Makan & Minum'),
        payee: '100% Sate_Ayam',
        note: 'dinner',
      });
      await make({
        occurred_at: iso('2026-01-03'),
        kind: 'income',
        account_id: a2,
        amount_minor: '900',
        category_id: l.cat('Gaji'),
      });
      await make({
        occurred_at: iso('2026-01-04'),
        kind: 'expense',
        account_id: a2,
        amount_minor: '50',
        category_id: l.cat('Transportasi'),
        status: 'draft',
      });
      for (let i = 0; i < 3; i++) {
        await make({
          occurred_at: iso('2026-01-05'),
          kind: 'expense',
          account_id: a2,
          amount_minor: String(10 + i),
          category_id: l.cat('Belanja'),
        });
      }
      cats = { kopi: l.cat('Kopi'), food: l.cat('Makan & Minum') };
    });
    afterAll(() => env2?.close());

    const idsOf = (r: { data: { id: string }[] }) => r.data.map((x) => x.id);

    it('filters', async () => {
      expect(idsOf(await C('GET', `/transactions?account_id=${a1}`))).toHaveLength(2);
      expect(idsOf(await C('GET', '/transactions?kind=income'))).toEqual([ids[2]]);
      expect(idsOf(await C('GET', '/transactions?status=draft'))).toEqual([ids[3]]);
      expect(idsOf(await C('GET', `/transactions?tag_id=${tagX}`))).toEqual([ids[0]]);
      expect(idsOf(await C('GET', `/transactions?category_id=${cats.food}`))).toEqual([ids[1]]);
      expect(
        idsOf(
          await C('GET', `/transactions?category_id=${cats.food}&include_subcategories=true`),
        ).sort(),
      ).toEqual([ids[0], ids[1]].sort());
      expect(
        idsOf(await C('GET', `/transactions?category_id=${cats.kopi}&include_subcategories=true`)),
      ).toEqual([ids[0]]);
      // q: payee/note, case-insensitive, LIKE wildcards are literal
      expect(idsOf(await C('GET', '/transactions?q=KENANGAN'))).toEqual([ids[0]]);
      expect(idsOf(await C('GET', '/transactions?q=dinner'))).toEqual([ids[1]]);
      expect(idsOf(await C('GET', `/transactions?q=${encodeURIComponent('100%')}`))).toEqual([
        ids[1],
      ]);
      expect(idsOf(await C('GET', `/transactions?q=${encodeURIComponent('_')}`))).toEqual([ids[1]]);
      // date-only from/to are Asia/Jakarta days, inclusive
      expect(idsOf(await C('GET', '/transactions?from=2026-01-02&to=2026-01-03'))).toEqual([
        ids[2],
        ids[1],
      ]);
      expect(
        idsOf(
          await C(
            'GET',
            `/transactions?from=${encodeURIComponent('2026-01-03T00:00:00+07:00')}&to=${encodeURIComponent('2026-01-03T12:00:00+07:00')}`,
          ),
        ),
      ).toEqual([ids[2]]);
      expect((await C('GET', '/transactions?kind=bogus')).status).toBe(400);
      expect((await C('GET', '/transactions?limit=0')).status).toBe(400);
      expect((await C('GET', '/transactions?limit=201')).status).toBe(400);
      expect((await C('GET', '/transactions?cursor=garbage')).status).toBe(400);
      // each item carries entries and tag ids
      const first = (await C('GET', `/transactions?tag_id=${tagX}`)).data[0];
      expect(first.tag_ids).toEqual([tagX]);
      expect(first.entries).toHaveLength(1);
    });

    it('paginates with an opaque cursor: stable, no gaps or duplicates, ordered occurred_at desc, id desc', async () => {
      const seen: { id: string; occurred_at: string }[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const r: {
          data: { id: string; occurred_at: string }[];
          json: { next_cursor: string | null };
        } = await C(
          'GET',
          `/transactions?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        );
        pages++;
        expect(r.data.length).toBeLessThanOrEqual(3);
        seen.push(...r.data);
        cursor = r.json.next_cursor;
        if (cursor) expect(() => Buffer.from(cursor!, 'base64url')).not.toThrow();
      } while (cursor);
      expect(pages).toBe(3);
      expect(seen).toHaveLength(7);
      expect(new Set(seen.map((s) => s.id)).size).toBe(7);
      const sorted = [...seen].sort((x, y) => {
        const d = Date.parse(y.occurred_at) - Date.parse(x.occurred_at);
        return d || (y.id < x.id ? -1 : y.id > x.id ? 1 : 0);
      });
      expect(seen.map((s) => s.id)).toEqual(sorted.map((s) => s.id));
      // last page has next_cursor null; an exact fit has no extra cursor
      const exact = await C('GET', '/transactions?limit=7');
      expect(exact.json.next_cursor).toBeNull();
      expect(exact.data).toHaveLength(7);
      // default limit works and the envelope includes next_cursor
      expect((await C('GET', '/transactions')).json).toHaveProperty('next_cursor', null);
    });
  });
});
