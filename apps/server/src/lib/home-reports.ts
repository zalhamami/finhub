import { and, eq, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import {
  MissingRateError,
  historyDates,
  monthBounds,
  pricesForDate,
  toBaseMinor,
  prevMonth,
  type Flow,
  type ValuationContext,
} from '@finhub/core';
import { schema, type Db } from '@finhub/db';
import { jakartaDayStart } from './time';
import { loadFxContext, loadHoldings, loadValuation, valueNetWorth } from './valuation';

const jakartaDate = (d: Date): string =>
  new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);

export interface MonthlyData {
  flows: Flow[];
  /** posted, non-archived transactions dated in `month` (all kinds) */
  transactionCount: number;
  /** entries that could not be converted (no fx rate on/before their date) */
  unconverted: { currency: string; quote: string }[];
  unconvertedCount: number;
  baseCurrency: string;
}

/**
 * Income / expense flows for `month` and the month before, in base currency (calendar months,
 * Asia/Jakarta). Expense = entries of expense transactions plus fee lines of transfers (entries with
 * a category on a transfer). Adjustments and plain transfer legs are not flows. Foreign entries are
 * converted with the latest fx rate on/before the transaction's own date; with no rate the entry is
 * left out and reported.
 */
export async function loadMonthlyFlows(db: Db, ws: string, month: string): Promise<MonthlyData> {
  const from = jakartaDayStart(monthBounds(prevMonth(month)).start);
  const to = jakartaDayStart(monthBounds(month).endExclusive);
  const t = schema.transactions;
  const e = schema.entries;
  const live = and(
    eq(t.workspaceId, ws),
    eq(t.status, 'posted'),
    isNull(t.archivedAt),
    gte(t.occurredAt, from),
    lt(t.occurredAt, to),
  );

  const rows = await db
    .select({
      occurredAt: t.occurredAt,
      kind: t.kind,
      categoryId: e.categoryId,
      amountMinor: e.amountMinor,
      currency: e.currency,
    })
    .from(e)
    .innerJoin(t, eq(e.transactionId, t.id))
    .where(
      and(
        live,
        eq(e.workspaceId, ws),
        sql`(${t.kind} in ('income', 'expense') or (${t.kind} = 'transfer' and ${e.categoryId} is not null))`,
      ),
    );

  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(t)
    .where(and(live, gte(t.occurredAt, jakartaDayStart(monthBounds(month).start))));

  const base = await loadFxContext(db, ws, monthBounds(month).endExclusive);
  const flows: Flow[] = [];
  const missing = new Map<string, { currency: string; quote: string }>();
  let unconvertedCount = 0;
  for (const r of rows) {
    const date = jakartaDate(r.occurredAt);
    const ctx: ValuationContext = { ...base, date };
    let amount: bigint;
    try {
      amount = toBaseMinor(r.amountMinor, r.currency, ctx);
    } catch (err) {
      if (!(err instanceof MissingRateError)) throw err;
      unconvertedCount++;
      missing.set(r.currency, { currency: r.currency, quote: base.baseCurrency });
      continue;
    }
    flows.push(
      r.kind === 'income'
        ? { date, kind: 'income', amountMinor: amount, categoryId: r.categoryId }
        : { date, kind: 'expense', amountMinor: -amount, categoryId: r.categoryId },
    );
  }
  return {
    flows,
    transactionCount: n,
    unconverted: [...missing.values()],
    unconvertedCount,
    baseCurrency: base.baseCurrency,
  };
}

export interface HistoryPoint {
  date: string;
  netWorthMinor: bigint;
  assetsMinor: bigint;
  liabilitiesMinor: bigint;
  source: 'snapshot' | 'ledger';
  /** false when some account could not be valued (no rate / price) and was left out */
  complete: boolean;
}

/**
 * Net worth at each sample date. Past dates use a net_worth_snapshots row for that exact date when
 * one exists; otherwise the ledger is replayed (balances as of that day end, fx rate on/before it,
 * holdings at the latest price on/before it, or the current price if none exists yet). Holding
 * units are always the current ones (no unit history). `today` is always computed live.
 */
export async function loadNetWorthHistory(
  db: Db,
  ws: string,
  today: string,
  months: number,
  granularity: 'month' | 'week',
): Promise<{ baseCurrency: string; points: HistoryPoint[] }> {
  const dates = historyDates(today, months, granularity);
  const snaps = await db
    .select()
    .from(schema.netWorthSnapshots)
    .where(
      and(
        eq(schema.netWorthSnapshots.workspaceId, ws),
        inArray(schema.netWorthSnapshots.date, dates),
        ne(schema.netWorthSnapshots.date, today),
      ),
    );
  const snapBy = new Map(snaps.map((s) => [s.date, s]));

  const points: HistoryPoint[] = [];
  let baseCurrency = (await loadFxContext(db, ws, today)).baseCurrency;
  let latest: Awaited<ReturnType<typeof loadHoldings>> | undefined;
  for (const date of dates) {
    const s = snapBy.get(date);
    if (s) {
      points.push({
        date,
        netWorthMinor: s.netWorthBaseMinor,
        assetsMinor: s.assetsBaseMinor,
        liabilitiesMinor: s.liabilitiesBaseMinor,
        source: 'snapshot',
        complete: true,
      });
      continue;
    }
    const val = await loadValuation(db, ws, date);
    baseCurrency = val.baseCurrency;
    if (!latest) {
      // holdings + every price up to today, loaded once; per date we pick from it
      const all = await loadValuation(db, ws, today);
      latest = await loadHoldings(
        db,
        ws,
        all.accounts.filter((a) => a.kind === 'investment' && a.hasHoldings).map((a) => a.id),
        today,
      );
    }
    const ctx = { ...val.ctx, prices: pricesForDate(latest.prices, date) };
    const { nw, failed } = valueNetWorth(val.accounts, latest.holdings, ctx);
    points.push({
      date,
      netWorthMinor: nw.netWorthMinor,
      assetsMinor: nw.assetsMinor,
      liabilitiesMinor: nw.liabilitiesMinor,
      source: 'ledger',
      complete: failed.length === 0,
    });
  }
  return { baseCurrency, points };
}
