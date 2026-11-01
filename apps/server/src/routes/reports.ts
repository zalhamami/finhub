import { Hono } from 'hono';
import {
  ACCOUNT_KINDS,
  MissingPriceError,
  MissingRateError,
  accountValueBase,
  netWorth,
  toBaseMinor,
  type NetWorthAccount,
} from '@finhub/core';
import { z } from 'zod';
import { send, v, type AppEnv } from '../lib/http';
import { todayJakarta } from '../lib/time';
import { loadHoldings, loadValuation, type AccountBalance } from '../lib/valuation';

const asOfQuery = z.object({ as_of: z.iso.date().optional() });
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

export function reportsRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  /**
   * Balances as of end of day (Asia/Jakarta). Archived accounts are skipped. value_base_minor is the plain
   * ledger balance converted to base (liabilities keep their sign; holdings are NOT included - see net-worth).
   */
  r.get('/balances', v('query', balancesQuery), async (c) => {
    const q = c.req.valid('query');
    const asOf = q.as_of ?? todayJakarta();
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
    const asOf = c.req.valid('query').as_of ?? todayJakarta();
    const { db, workspaceId } = c.var;
    const val = await loadValuation(db, workspaceId, asOf);
    const counted = val.accounts.filter((a) => !a.archived && a.includeInNetWorth);
    const { holdings, prices } = await loadHoldings(
      db,
      workspaceId,
      counted.filter((a) => a.kind === 'investment' && a.hasHoldings).map((a) => a.id),
      asOf,
    );
    const ctx = { ...val.ctx, prices };

    const usable: NetWorthAccount[] = [];
    const missing: MissingRate[] = [];
    for (const a of counted) {
      const na: NetWorthAccount = {
        id: a.id,
        kind: a.kind,
        currency: a.currency,
        balanceMinor: a.balanceMinor,
        includeInNetWorth: true,
        archived: false,
        holdings: a.hasHoldings ? (holdings.get(a.id) ?? []) : [],
      };
      try {
        accountValueBase(
          na.balanceMinor,
          na.currency,
          na.kind === 'investment' ? (na.holdings ?? []) : [],
          ctx,
        );
        usable.push(na);
      } catch (err) {
        missing.push(missingOf(a, err, asOf));
      }
    }
    const nw = netWorth(usable, ctx);
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

  return r;
}
