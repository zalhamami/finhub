import { Hono } from 'hono';
import {
  ACCOUNT_KINDS,
  MissingPriceError,
  MissingRateError,
  compareMonths,
  prevMonth,
  toBaseMinor,
  topExpenseCategories,
} from '@finhub/core';
import { schema } from '@finhub/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { send, v, type AppEnv } from '../lib/http';
import { todayJakarta } from '../lib/time';
import { loadMonthlyFlows, loadNetWorthHistory } from '../lib/home-reports';
import { loadHoldings, loadValuation, valueNetWorth, type AccountBalance } from '../lib/valuation';

const asOfQuery = z.object({ as_of: z.iso.date().optional() });
const monthQuery = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'expected YYYY-MM')
    .optional(),
});
const historyQuery = z
  .object({
    months: z.coerce.number().int().min(1).max(60).default(6),
    granularity: z.enum(['month', 'week']).default('month'),
  })
  .refine((q) => q.granularity === 'month' || q.months <= 12, {
    message: 'weekly granularity supports at most 12 months',
    path: ['months'],
  });
const balancesQuery = asOfQuery.extend({
  group_by: z.enum(['kind', 'group', 'account']).default('kind'),
});

interface MissingRate {
  account_id: string;
  account_name: string;
  type: 'fx_rate' | 'price';
  /** fx_rate: converting `currency` -> `quote`; price: instrument_id has no price on or before as_of */
  currency?: string;
  quote?: string;
  instrument_id?: string;
  as_of: string;
}

function missingOf(a: AccountBalance, err: unknown, asOf: string): MissingRate {
  const head = { account_id: a.id, account_name: a.name, as_of: asOf };
  if (err instanceof MissingRateError) {
    return { ...head, type: 'fx_rate', currency: err.base, quote: err.quote };
  }
  if (err instanceof MissingPriceError) {
    return { ...head, type: 'price', instrument_id: err.instrumentId };
  }
  throw err;
}

export interface ReportsDeps {
  /** clock, injectable for tests */
  now?: () => Date;
}

export function reportsRoutes(deps: ReportsDeps = {}): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const today = () => todayJakarta(deps.now?.());

  /**
   * Balances as of end of day (Asia/Jakarta). Archived accounts are skipped. value_base_minor is the plain
   * ledger balance converted to base (liabilities keep their sign; holdings are NOT included - see net-worth).
   */
  r.get('/balances', v('query', balancesQuery), async (c) => {
    const q = c.req.valid('query');
    const asOf = q.as_of ?? today();
    const val = await loadValuation(c.var.db, c.var.workspaceId, asOf);
    const missing: MissingRate[] = [];

    const rows = val.accounts
      .filter((a) => !a.archived)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map((a) => {
        let value: bigint | null = null;
        try {
          value = toBaseMinor(a.balanceMinor, a.currency, val.ctx);
        } catch (err) {
          missing.push(missingOf(a, err, asOf));
        }
        return { a, value };
      });

    type Group = { key: string | null; name: string; sort: number; rows: typeof rows };
    const groups = new Map<string, Group>();
    for (const row of rows) {
      const { a } = row;
      const [id, key, name, sort]: [string, string | null, string, number] =
        q.group_by === 'kind'
          ? [a.kind, a.kind, a.kind, ACCOUNT_KINDS.indexOf(a.kind)]
          : q.group_by === 'group'
            ? [
                a.groupId ?? '-',
                a.groupId,
                a.groupName ?? 'Ungrouped',
                a.groupId ? a.groupSort : Infinity,
              ]
            : [a.id, a.id, a.name, 0];
      const g = groups.get(id) ?? { key, name, sort, rows: [] };
      g.rows.push(row);
      groups.set(id, g);
    }
    const list = [...groups.values()].sort(
      (x, y) => x.sort - y.sort || x.name.localeCompare(y.name),
    );
    const sumOf = (rs: typeof rows) => rs.reduce((s, x) => s + (x.value ?? 0n), 0n);

    return send(c, {
      as_of: asOf,
      base_currency: val.baseCurrency,
      group_by: q.group_by,
      total_base_minor: sumOf(rows),
      groups: list.map((g) => ({
        key: g.key,
        name: g.name,
        total_base_minor: sumOf(g.rows),
        accounts: g.rows.map(({ a, value }) => ({
          id: a.id,
          name: a.name,
          kind: a.kind,
          group_id: a.groupId,
          currency: a.currency,
          include_in_net_worth: a.includeInNetWorth,
          balance_minor: a.balanceMinor,
          value_base_minor: value,
        })),
      })),
      missing_rates: missing,
    });
  });

  /** Live net worth (core netWorth): holdings x latest price for investment accounts with has_holdings. */
  r.get('/net-worth', v('query', asOfQuery), async (c) => {
    const asOf = c.req.valid('query').as_of ?? today();
    const { db, workspaceId } = c.var;
    const val = await loadValuation(db, workspaceId, asOf);
    const { holdings, prices } = await loadHoldings(
      db,
      workspaceId,
      val.accounts
        .filter(
          (a) => !a.archived && a.includeInNetWorth && a.kind === 'investment' && a.hasHoldings,
        )
        .map((a) => a.id),
      asOf,
    );
    const { nw, counted, failed } = valueNetWorth(val.accounts, holdings, { ...val.ctx, prices });
    const missing = failed.map((f) => missingOf(f.account, f.err, asOf));
    return send(c, {
      as_of: asOf,
      base_currency: val.baseCurrency,
      assets_minor: nw.assetsMinor,
      liabilities_minor: nw.liabilitiesMinor,
      net_worth_minor: nw.netWorthMinor,
      by_kind: nw.byKind,
      /**
       * Per-account base value including holdings (liabilities negative); rows sum to by_kind.
       * Accounts that cannot be valued (no rate / price) are listed with value_base_minor null.
       */
      accounts: counted
        .map((a) => ({
          id: a.id,
          name: a.name,
          kind: a.kind,
          group_id: a.groupId,
          currency: a.currency,
          sort_order: a.sortOrder,
          /** ledger balance in the account's own currency (holdings NOT included) */
          balance_minor: a.balanceMinor,
          value_base_minor: nw.perAccount[a.id] ?? null,
        }))
        .sort((x, y) => x.sort_order - y.sort_order || x.name.localeCompare(y.name))
        .map(({ sort_order: _s, ...rest }) => rest),
      missing_rates: missing,
    });
  });

  /**
   * Beranda snapshot for a CALENDAR month (Asia/Jakarta; settings.month_start_day is ignored).
   * Base currency; expense includes transfer fee lines; foreign entries are converted with the latest
   * fx rate on/before the transaction date (entries with no rate are skipped and listed in
   * missing_rates). Pace: previous.expense_to_date_minor is last month's expense through the same day
   * of month (compare_day: today's day for the current month, else the month's last day).
   */
  r.get('/monthly-summary', v('query', monthQuery), async (c) => {
    const { db, workspaceId } = c.var;
    const now = today();
    const month = c.req.valid('query').month ?? now.slice(0, 7);
    const data = await loadMonthlyFlows(db, workspaceId, month);
    const cats = await db
      .select({
        id: schema.categories.id,
        parentId: schema.categories.parentId,
        name: schema.categories.name,
        icon: schema.categories.icon,
        color: schema.categories.color,
      })
      .from(schema.categories)
      .where(eq(schema.categories.workspaceId, workspaceId));
    const byId = new Map(cats.map((x) => [x.id, x]));
    const cmp = compareMonths(data.flows, month, now);
    const top = topExpenseCategories(
      data.flows,
      month,
      new Map(cats.map((x) => [x.id, x.parentId])),
      5,
    );
    const totals = (t: { incomeMinor: bigint; expenseMinor: bigint; netMinor: bigint }) => ({
      income_minor: t.incomeMinor,
      expense_minor: t.expenseMinor,
      net_minor: t.netMinor,
    });
    const rows: {
      category_id: string | null;
      name: string;
      icon: string | null;
      color: string | null;
      is_other: boolean;
      amount_minor: bigint;
      share_bps: number;
      previous_amount_minor: bigint;
    }[] = top.top.map((row) => {
      const cat = byId.get(row.categoryId);
      return {
        category_id: row.categoryId,
        name: cat?.name ?? '?',
        icon: cat?.icon ?? null,
        color: cat?.color ?? null,
        is_other: false,
        amount_minor: row.amountMinor,
        share_bps: row.shareBps,
        previous_amount_minor: row.previousAmountMinor,
      };
    });
    if (top.other) {
      rows.push({
        category_id: null,
        name: 'Lainnya',
        icon: null,
        color: null,
        is_other: true,
        amount_minor: top.other.amountMinor,
        share_bps: top.other.shareBps,
        previous_amount_minor: top.other.previousAmountMinor,
      });
    }
    return send(c, {
      month,
      base_currency: data.baseCurrency,
      current: totals(cmp.current),
      previous: {
        month: prevMonth(month),
        ...totals(cmp.previous),
        expense_to_date_minor: cmp.previousExpenseToDateMinor,
      },
      compare_day: cmp.compareDay,
      expense_vs_previous_to_date_minor: cmp.expenseVsPreviousToDateMinor,
      top_categories: rows,
      transaction_count: data.transactionCount,
      missing_rates: data.unconverted,
      unconverted_count: data.unconvertedCount,
    });
  });

  /**
   * Net worth trend. months=N points (month granularity: end of each previous month, then today) or
   * weekly points over N months (max 12). Past dates use net_worth_snapshots when one exists for the
   * exact date, else the ledger is replayed; today is always live. Each point: source + complete.
   */
  r.get('/net-worth-history', v('query', historyQuery), async (c) => {
    const q = c.req.valid('query');
    const h = await loadNetWorthHistory(
      c.var.db,
      c.var.workspaceId,
      today(),
      q.months,
      q.granularity,
    );
    return send(c, {
      base_currency: h.baseCurrency,
      granularity: q.granularity,
      points: h.points.map((p) => ({
        date: p.date,
        net_worth_minor: p.netWorthMinor,
        assets_minor: p.assetsMinor,
        liabilities_minor: p.liabilitiesMinor,
        source: p.source,
        complete: p.complete,
      })),
    });
  });

  return r;
}
