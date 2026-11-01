import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { validateTransaction, type EntryLine, type TransactionKind } from '@finhub/core';
import type { Db } from './client';
import { DEMO_SLUG, seed } from './seed';
import * as s from './schema';

/**
 * DEMO seed: obviously fake accounts, holdings and ~3 months of varied transactions in the `demo`
 * workspace, for trying the app out. Names are made up ("PT Contoh Sejahtera", "Bank Demo", ...).
 *
 * - Runs the BASE seed first (currencies, workspace, settings, account types, categories).
 * - Only acts when the demo workspace has NO accounts yet, so reruns (and a restart with
 *   DEMO_SEED=true) are no-ops. A pg advisory lock serializes concurrent starters.
 * - Deterministic: a seeded PRNG (mulberry32) drives all choices. Dates are RELATIVE TO TODAY
 *   (Asia/Jakarta): the window is the last `days` (default 90) days up to and including `today`, so the
 *   demo always looks current. The same `today` + `seed` always yields the same data (tests pin both).
 * - Every transaction passes core `validateTransaction` before insert (the same invariants as the
 *   API), and everything is written in one DB transaction so the deferred ledger trigger checks it at commit.
 */

export interface DemoOptions {
  /** YYYY-MM-DD in Asia/Jakarta; default: today */
  today?: string;
  /** PRNG seed; default 20260101 */
  seed?: number;
  /** length of the window ending at `today`; default 90 */
  days?: number;
}

export interface DemoResult {
  created: boolean;
  accounts: number;
  transactions: number;
}

const LOCK_KEY = 727_274;

/* ---------- small deterministic helpers ---------- */

function mulberry32(seedValue: number): () => number {
  let a = seedValue >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const jakartaToday = (now = new Date()): string =>
  new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dayOfMonth = (date: string) => Number(date.slice(8, 10));
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday

/** IDR whole rupiah -> minor units (x100). */
const idr = (rupiah: number): bigint => BigInt(Math.round(rupiah)) * 100n;

/** hundredths (integer) -> "16150.25" */
const fixed = (n: bigint, decimals: number): string => {
  const scale = 10n ** BigInt(decimals);
  return `${n / scale}.${(n % scale).toString().padStart(decimals, '0')}`;
};

type Key =
  'dompet' | 'utama' | 'tabungan' | 'ewallet' | 'usd' | 'kartu' | 'paylater' | 'portofolio';
type TypeName = 'Cash' | 'Bank' | 'E-wallet' | 'Credit card' | 'Paylater' | 'Reksa dana';

interface AccountDef {
  key: Key;
  name: string;
  type: TypeName;
  group: string | null;
  currency: 'IDR' | 'USD';
  opening: bigint;
  icon: string;
  color: string;
  creditLimit?: bigint;
  statementDay?: number;
  dueDay?: number;
}

const ACCOUNTS: AccountDef[] = [
  {
    key: 'dompet',
    name: 'Dompet',
    type: 'Cash',
    group: 'Harian',
    currency: 'IDR',
    opening: idr(800_000),
    icon: 'cash',
    color: 'teal',
  },
  {
    key: 'utama',
    name: 'Bank Demo Utama',
    type: 'Bank',
    group: 'Harian',
    currency: 'IDR',
    opening: idr(25_000_000),
    icon: 'building-bank',
    color: 'blue',
  },
  {
    key: 'tabungan',
    name: 'Bank Demo Tabungan',
    type: 'Bank',
    group: 'Tabungan',
    currency: 'IDR',
    opening: idr(40_000_000),
    icon: 'building-bank',
    color: 'indigo',
  },
  {
    key: 'ewallet',
    name: 'E-Wallet Demo',
    type: 'E-wallet',
    group: 'Harian',
    currency: 'IDR',
    opening: idr(300_000),
    icon: 'wallet',
    color: 'grape',
  },
  {
    key: 'usd',
    name: 'Bank Demo USD',
    type: 'Bank',
    group: 'Tabungan',
    currency: 'USD',
    opening: 200_000n,
    icon: 'building-bank',
    color: 'cyan',
  },
  {
    key: 'kartu',
    name: 'Kartu Kredit Demo',
    type: 'Credit card',
    group: 'Harian',
    currency: 'IDR',
    opening: 0n,
    icon: 'credit-card',
    color: 'orange',
    creditLimit: idr(20_000_000),
    statementDay: 20,
    dueDay: 8,
  },
  {
    key: 'paylater',
    name: 'Paylater Demo',
    type: 'Paylater',
    group: 'Harian',
    currency: 'IDR',
    opening: 0n,
    icon: 'credit-card',
    color: 'pink',
    creditLimit: idr(5_000_000),
    statementDay: 25,
    dueDay: 15,
  },
  {
    key: 'portofolio',
    name: 'Portofolio Demo',
    type: 'Reksa dana',
    group: 'Investasi',
    currency: 'IDR',
    opening: 0n,
    icon: 'chart-line',
    color: 'green',
  },
];

const GROUPS = ['Harian', 'Tabungan', 'Investasi'];

/** Demo-only categories (parent name -> children); `kind` of the parent decides the child's. */
const EXTRA_CATEGORIES: { parent: string; kind: 'expense' | 'income'; children: string[] }[] = [
  { parent: 'Transportasi', kind: 'expense', children: ['Transportasi online'] },
  { parent: 'Belanja', kind: 'expense', children: ['Belanja bulanan'] },
  { parent: 'Tagihan', kind: 'expense', children: ['Listrik', 'Internet', 'Pulsa'] },
  { parent: 'Hiburan', kind: 'expense', children: ['Langganan'] },
  { parent: 'Pendapatan lain', kind: 'income', children: ['Freelance'] },
];

interface Draft {
  date: string;
  time: string;
  kind: TransactionKind;
  payee: string | null;
  note: string | null;
  entries: { account: Key; amount: bigint; category: string | null }[];
}

/* ---------- entry point ---------- */

export async function seedDemo(db: Db, opts: DemoOptions = {}): Promise<DemoResult> {
  // Already seeded? Then do nothing at all (not even the base seed: it would resurrect deleted
  // categories / account types on every restart with DEMO_SEED=true).
  const [seeded] = await db
    .select({ id: s.accounts.id })
    .from(s.accounts)
    .innerJoin(s.workspaces, eq(s.accounts.workspaceId, s.workspaces.id))
    .where(eq(s.workspaces.slug, DEMO_SLUG))
    .limit(1);
  if (seeded) return { created: false, accounts: 0, transactions: 0 };
  await seed(db);
  const today = opts.today ?? jakartaToday();
  const days = opts.days ?? 90;

  return db.transaction(async (tx): Promise<DemoResult> => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_KEY})`);
    const [ws] = await tx.select().from(s.workspaces).where(eq(s.workspaces.slug, DEMO_SLUG));
    if (!ws) throw new Error('demo workspace missing');
    const workspaceId = ws.id;

    const [existing] = await tx
      .select({ id: s.accounts.id })
      .from(s.accounts)
      .where(eq(s.accounts.workspaceId, workspaceId))
      .limit(1);
    if (existing) return { created: false, accounts: 0, transactions: 0 };

    const start = addDays(today, -(days - 1));

    /* --- categories --- */
    const cats = await tx
      .select()
      .from(s.categories)
      .where(eq(s.categories.workspaceId, workspaceId));
    const catId = new Map<string, string>(); // by name (names are unique enough in the base tree)
    for (const c of cats) catId.set(c.name, c.id);
    const ensureCategory = async (
      name: string,
      kind: 'expense' | 'income',
      parentId: string | null,
    ) => {
      const have = cats.find((c) => c.name === name && (c.parentId ?? null) === parentId);
      if (have) return have.id;
      const [row] = await tx
        .insert(s.categories)
        .values({ workspaceId, name, kind, parentId, sortOrder: 50 })
        .returning({ id: s.categories.id });
      cats.push({ id: row!.id, name, kind, parentId } as unknown as (typeof cats)[number]);
      catId.set(name, row!.id);
      return row!.id;
    };
    for (const e of EXTRA_CATEGORIES) {
      const parent = await ensureCategory(e.parent, e.kind, null);
      for (const child of e.children) await ensureCategory(child, e.kind, parent);
    }
    const cat = (name: string): string => {
      const id = catId.get(name);
      if (!id) throw new Error(`demo seed: category "${name}" missing`);
      return id;
    };

    /* --- groups, accounts --- */
    const groupId = new Map<string, string>();
    for (const [i, name] of GROUPS.entries()) {
      const [g] = await tx
        .insert(s.accountGroups)
        .values({ workspaceId, name, sortOrder: i })
        .onConflictDoNothing()
        .returning({ id: s.accountGroups.id });
      const id =
        g?.id ??
        (
          await tx
            .select({ id: s.accountGroups.id })
            .from(s.accountGroups)
            .where(
              and(eq(s.accountGroups.workspaceId, workspaceId), eq(s.accountGroups.name, name)),
            )
        )[0]!.id;
      groupId.set(name, id);
    }
    const types = await tx
      .select()
      .from(s.accountTypes)
      .where(eq(s.accountTypes.workspaceId, workspaceId));
    const typeId = (name: string) => {
      const t = types.find((x) => x.name === name);
      if (!t) throw new Error(`demo seed: account type "${name}" missing`);
      return t.id;
    };

    const acct = new Map<Key, { id: string; currency: string }>();
    for (const [i, a] of ACCOUNTS.entries()) {
      const [row] = await tx
        .insert(s.accounts)
        .values({
          workspaceId,
          name: a.name,
          typeId: typeId(a.type),
          groupId: a.group ? groupId.get(a.group)! : null,
          currency: a.currency,
          icon: a.icon,
          color: a.color,
          openingBalanceMinor: a.opening,
          openingDate: start,
          creditLimitMinor: a.creditLimit ?? null,
          statementDay: a.statementDay ?? null,
          dueDay: a.dueDay ?? null,
          sortOrder: i,
        })
        .returning({ id: s.accounts.id });
      acct.set(a.key, { id: row!.id, currency: a.currency });
    }

    /* --- FX rates (USD -> IDR, weekly random walk) and instrument prices --- */
    const rng = mulberry32(opts.seed ?? 20260101);
    const int = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
    const chance = (p: number) => rng() < p;
    const pick = <T>(list: readonly T[]): T => list[Math.floor(rng() * list.length)]!;

    const rateAt = new Map<string, bigint>(); // date -> IDR per USD, in hundredths
    {
      let rate = 16_150_00n;
      const rows: (typeof s.fxRates.$inferInsert)[] = [];
      for (let off = -7; off <= days; off += 7) {
        const date = off <= 0 ? addDays(start, off) : addDays(start, Math.min(off, days - 1));
        rate += (BigInt(int(-120, 130)) * 100n) / 10n; // +-12.00 .. +13.00 IDR
        rows.push({
          workspaceId,
          base: 'USD',
          quote: 'IDR',
          date,
          rate: fixed(rate, 2),
          source: 'demo',
        });
        rateAt.set(date, rate);
      }
      // always have a rate on the last day so "today" values at the newest rate
      if (!rateAt.has(today)) {
        rows.push({
          workspaceId,
          base: 'USD',
          quote: 'IDR',
          date: today,
          rate: fixed(rate, 2),
          source: 'demo',
        });
        rateAt.set(today, rate);
      }
      await tx.insert(s.fxRates).values(rows).onConflictDoNothing();
    }
    const usdRateOn = (date: string): bigint => {
      let best: [string, bigint] | undefined;
      for (const [d, r] of rateAt) if (d <= date && (!best || d > best[0])) best = [d, r];
      return best![1];
    };

    const [fund] = await tx
      .insert(s.instruments)
      .values({
        workspaceId,
        kind: 'mutual_fund',
        symbol: 'RDPU-DEMO',
        name: 'Reksa Dana Pasar Uang Contoh',
        currency: 'IDR',
        unitLabel: 'unit',
      })
      .returning({ id: s.instruments.id });
    const [gold] = await tx
      .insert(s.instruments)
      .values({
        workspaceId,
        kind: 'gold',
        symbol: 'EMAS-DEMO',
        name: 'Emas Demo',
        currency: 'IDR',
        unitLabel: 'gram',
      })
      .returning({ id: s.instruments.id });
    {
      let fundPrice = 14_500_000n; // 1.450,0000 per unit, 4 decimals
      let goldPrice = 135_000_000n; // Rp1.350.000,00 per gram (2 decimals)
      const rows: (typeof s.prices.$inferInsert)[] = [];
      for (let off = -7; off <= days; off += 7) {
        const date = off <= 0 ? addDays(start, off) : addDays(start, Math.min(off, days - 1));
        fundPrice += BigInt(int(-2_000, 6_000));
        goldPrice += BigInt(int(-4_000_000, 6_000_000)); // +-Rp40.000..60.000 a week
        rows.push(
          {
            workspaceId,
            instrumentId: fund!.id,
            date,
            price: fixed(fundPrice, 4),
            currency: 'IDR',
            source: 'demo',
          },
          {
            workspaceId,
            instrumentId: gold!.id,
            date,
            price: fixed(goldPrice, 2),
            currency: 'IDR',
            source: 'demo',
          },
        );
      }
      await tx.insert(s.prices).values(rows).onConflictDoNothing();
    }
    await tx.insert(s.holdings).values([
      {
        workspaceId,
        accountId: acct.get('portofolio')!.id,
        instrumentId: fund!.id,
        units: '20000.5000000000',
        costBasisMinor: idr(28_000_000),
      },
      {
        workspaceId,
        accountId: acct.get('portofolio')!.id,
        instrumentId: gold!.id,
        units: '12.5000000000',
        costBasisMinor: idr(16_000_000),
      },
    ]);

    /* --- transactions --- */
    const bal = new Map<Key, bigint>(ACCOUNTS.map((a) => [a.key, a.opening]));
    const limit = new Map<Key, bigint>(ACCOUNTS.map((a) => [a.key, a.creditLimit ?? 0n]));
    const drafts: Draft[] = [];
    let cursor = start;

    const push = (d: Omit<Draft, 'date'>) => {
      for (const e of d.entries) bal.set(e.account, bal.get(e.account)! + e.amount);
      drafts.push({ ...d, date: cursor });
    };
    const time = (loH: number, hiH: number) =>
      `${String(int(loH, hiH)).padStart(2, '0')}:${String(int(0, 59)).padStart(2, '0')}`;

    /** True if `a` can absorb an outflow of `amount` (cards/paylater: within limit). */
    const canPay = (a: Key, amount: bigint): boolean =>
      a === 'kartu' || a === 'paylater'
        ? -(bal.get(a)! - amount) <= limit.get(a)!
        : bal.get(a)! >= amount;

    const expense = (
      prefs: Key[],
      amount: bigint,
      category: string,
      payee: string,
      t: [number, number],
      note: string | null = null,
    ) => {
      const from = prefs.find((p) => canPay(p, amount)) ?? 'utama';
      push({
        time: time(...t),
        kind: 'expense',
        payee,
        note,
        entries: [{ account: from, amount: -amount, category: cat(category) }],
      });
    };
    const income = (
      to: Key,
      amount: bigint,
      category: string,
      payee: string,
      note: string | null = null,
    ) =>
      push({
        time: time(9, 11),
        kind: 'income',
        payee,
        note,
        entries: [{ account: to, amount, category: cat(category) }],
      });
    const transfer = (
      from: Key,
      to: Key,
      amount: bigint,
      opts: { toAmount?: bigint; fee?: bigint; note?: string } = {},
    ) => {
      const fee = opts.fee ?? 0n;
      if (from !== 'kartu' && from !== 'paylater' && bal.get(from)! < amount + fee) return;
      const entries: Draft['entries'] = [
        { account: from, amount: -amount, category: null },
        { account: to, amount: opts.toAmount ?? amount, category: null },
      ];
      if (fee > 0n) entries.push({ account: from, amount: -fee, category: cat('Biaya admin') });
      push({ time: time(8, 20), kind: 'transfer', payee: null, note: opts.note ?? null, entries });
    };

    // one-off events at fixed offsets inside the window
    const freelanceDays = new Set([
      int(10, Math.max(11, days - 20)),
      int(30, Math.max(31, days - 5)),
    ]);
    const bonusDay = int(40, Math.max(41, days - 10));
    const paylaterDays = new Map<number, bigint>([
      [int(12, 40), idr(350_000)],
      [int(45, Math.max(46, days - 3)), idr(780_000)],
    ]);
    let usdBought = false;

    for (let off = 0; off < days; off++) {
      cursor = addDays(start, off);
      const dom = dayOfMonth(cursor);
      const dow = weekday(cursor);
      const weekend = dow === 0 || dow === 6;

      // --- fixed monthly rhythm ---
      if (dom === 1 || dom === 16)
        transfer('utama', 'ewallet', idr(1_250_000), {
          fee: idr(1_500),
          note: 'Isi saldo e-wallet',
        });
      if (dom === 3 || dom === 18)
        transfer('utama', 'dompet', idr(dom === 3 ? 1_000_000 : 500_000), {
          fee: idr(6_500),
          note: 'Tarik tunai',
        });
      if (dom === 5)
        expense(
          ['utama'],
          idr(int(300, 450) * 1_000),
          'Listrik',
          'PLN Demo',
          [8, 10],
          'Token listrik',
        );
      if (dom === 8) {
        const owed = -bal.get('kartu')!;
        if (owed > 0n) transfer('utama', 'kartu', owed, { note: 'Bayar kartu kredit' });
      }
      if (dom === 10)
        expense(
          ['utama'],
          idr(385_000),
          'Internet',
          'Internet Rumah Demo',
          [8, 10],
          'Tagihan bulanan',
        );
      if (dom === 12)
        expense(
          ['ewallet', 'dompet'],
          idr(pick([50_000, 100_000])),
          'Pulsa',
          'Operator Demo',
          [10, 20],
        );
      if (dom === 15) {
        const owed = -bal.get('paylater')!;
        if (owed > 0n) transfer('utama', 'paylater', owed, { note: 'Bayar paylater' });
        expense(['usd'], 999n, 'Langganan', 'Layanan Streaming Contoh', [6, 9], 'US$9,99 / bulan');
      }
      if (dom === 25)
        income('utama', idr(12_500_000), 'Gaji', 'PT Contoh Sejahtera', 'Gaji bulanan');
      if (dom === 26) transfer('utama', 'tabungan', idr(3_000_000), { note: 'Tabungan bulanan' });
      if (!usdBought && off >= 15 && dom >= 20) {
        usdBought = true;
        const out = idr(8_100_000);
        // rate = IDR per USD in hundredths, so USD minor = IDR minor * 100 / rate
        const received = (out * 100n) / usdRateOn(cursor);
        transfer('utama', 'usd', out, { toAmount: received, note: 'Beli USD', fee: idr(25_000) });
      }

      // --- one-offs ---
      if (freelanceDays.has(off))
        income(
          'utama',
          idr(int(15, 35) * 100_000),
          'Freelance',
          'Klien Contoh',
          'Proyek freelance',
        );
      if (off === bonusDay)
        income('utama', idr(2_500_000), 'Bonus/THR', 'PT Contoh Sejahtera', 'Bonus kinerja');
      const pl = paylaterDays.get(off);
      if (pl) expense(['paylater'], pl, 'Belanja', 'Toko Online Contoh', [19, 22]);

      // --- everyday spending ---
      if (!weekend && chance(0.6))
        expense(['ewallet', 'dompet'], idr(int(25, 48) * 1_000), 'Kopi', 'Kopi Contoh', [7, 10]);
      if (chance(0.4))
        expense(
          ['ewallet', 'utama'],
          idr(int(14, 62) * 1_000),
          'Transportasi online',
          pick(['Gojek Demo', 'Grab Demo']),
          [7, 21],
        );
      if (chance(weekend ? 0.55 : 0.3))
        expense(
          pick<Key[]>([['kartu'], ['ewallet', 'dompet'], ['dompet', 'ewallet']]),
          idr(int(35, 150) * 1_000),
          'Makan & Minum',
          pick(['Warung Demo', 'Resto Contoh', 'Bakso Contoh', 'Kedai Demo']),
          [12, 21],
        );
      if (dow === 6)
        expense(
          ['kartu', 'utama'],
          idr(int(300, 650) * 1_000),
          'Belanja bulanan',
          'Supermarket Contoh',
          [9, 14],
        );
      else if (dow === 3 && chance(0.25))
        expense(
          ['dompet', 'ewallet'],
          idr(int(80, 200) * 1_000),
          'Belanja',
          'Minimarket Contoh',
          [17, 20],
        );
    }

    /* --- validate with the same core invariants as the API, then write --- */
    const txRows: (typeof s.transactions.$inferInsert)[] = [];
    const entryRows: (typeof s.entries.$inferInsert)[] = [];
    for (const d of drafts) {
      const id = randomUUID();
      const lines: EntryLine[] = d.entries.map((e) => ({
        accountId: e.account,
        amountMinor: e.amount,
        currency: acct.get(e.account)!.currency,
        categoryId: e.category,
      }));
      const issues = validateTransaction({ kind: d.kind, status: 'posted' }, lines);
      if (issues.length) throw new Error(`demo seed: invalid ${d.kind}: ${issues[0]!.message}`);
      txRows.push({
        id,
        workspaceId,
        occurredAt: new Date(`${d.date}T${d.time}:00+07:00`),
        kind: d.kind,
        payee: d.payee,
        note: d.note,
        status: 'posted',
        source: 'demo',
      });
      for (const e of d.entries)
        entryRows.push({
          workspaceId,
          transactionId: id,
          accountId: acct.get(e.account)!.id,
          categoryId: e.category,
          amountMinor: e.amount,
          currency: acct.get(e.account)!.currency,
        });
    }
    const CHUNK = 400;
    for (let i = 0; i < txRows.length; i += CHUNK)
      await tx.insert(s.transactions).values(txRows.slice(i, i + CHUNK));
    for (let i = 0; i < entryRows.length; i += CHUNK)
      await tx.insert(s.entries).values(entryRows.slice(i, i + CHUNK));

    return { created: true, accounts: ACCOUNTS.length, transactions: txRows.length };
  });
}
