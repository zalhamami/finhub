import { and, desc, eq, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import type {
  CurrencyUnit,
  FxRate,
  HoldingInput,
  PricePoint,
  ValuationContext,
} from '@finhub/core';
import { schema, type Db } from '@finhub/db';
import { jakartaEndExclusive } from './time';

export interface AccountBalance {
  id: string;
  name: string;
  kind: (typeof schema.accountKind.enumValues)[number];
  groupId: string | null;
  groupName: string | null;
  groupSort: number;
  sortOrder: number;
  currency: string;
  includeInNetWorth: boolean;
  archived: boolean;
  hasHoldings: boolean;
  /** opening balance + sum(entries of posted, non-archived transactions up to end of as_of, Asia/Jakarta) */
  balanceMinor: bigint;
}

export interface Valuation {
  asOf: string;
  baseCurrency: string;
  /** prices are empty here; see loadHoldings */
  ctx: ValuationContext;
  accounts: AccountBalance[];
}

/** Balances are summed in SQL (bigint); conversion happens in @finhub/core. */
export async function loadValuation(db: Db, ws: string, asOf: string): Promise<Valuation> {
  const [settings] = await db
    .select({ base: schema.settings.baseCurrency })
    .from(schema.settings)
    .where(eq(schema.settings.workspaceId, ws));
  const baseCurrency = settings?.base ?? 'IDR';

  const currencies: CurrencyUnit[] = (
    await db
      .select({ code: schema.currencies.code, minorUnit: schema.currencies.minorUnit })
      .from(schema.currencies)
  ).map((c) => ({ code: c.code, minorUnit: c.minorUnit }));

  const fxRates: FxRate[] = await db
    .select({
      base: schema.fxRates.base,
      quote: schema.fxRates.quote,
      date: schema.fxRates.date,
      rate: schema.fxRates.rate,
    })
    .from(schema.fxRates)
    .where(and(eq(schema.fxRates.workspaceId, ws), lte(schema.fxRates.date, asOf)))
    // ties on the same date resolve to the most recently written rate (core keeps the first seen)
    .orderBy(desc(schema.fxRates.date), desc(schema.fxRates.updatedAt));

  const rows = await db
    .select({
      a: schema.accounts,
      kind: schema.accountTypes.kind,
      hasHoldings: schema.accountTypes.hasHoldings,
      groupName: schema.accountGroups.name,
      groupSort: schema.accountGroups.sortOrder,
    })
    .from(schema.accounts)
    .innerJoin(schema.accountTypes, eq(schema.accounts.typeId, schema.accountTypes.id))
    .leftJoin(schema.accountGroups, eq(schema.accounts.groupId, schema.accountGroups.id))
    .where(eq(schema.accounts.workspaceId, ws));

  const sums = await db
    .select({
      accountId: schema.entries.accountId,
      total: sql<string>`sum(${schema.entries.amountMinor})::text`,
    })
    .from(schema.entries)
    .innerJoin(schema.transactions, eq(schema.entries.transactionId, schema.transactions.id))
    .where(
      and(
        eq(schema.entries.workspaceId, ws),
        eq(schema.transactions.workspaceId, ws),
        eq(schema.transactions.status, 'posted'),
        isNull(schema.transactions.archivedAt),
        lt(schema.transactions.occurredAt, jakartaEndExclusive(asOf)),
      ),
    )
    .groupBy(schema.entries.accountId);
  const sumBy = new Map(sums.map((s) => [s.accountId, BigInt(s.total)]));

  const accounts: AccountBalance[] = rows.map(({ a, kind, hasHoldings, groupName, groupSort }) => ({
    id: a.id,
    name: a.name,
    kind,
    groupId: a.groupId,
    groupName,
    groupSort: groupSort ?? 0,
    sortOrder: a.sortOrder,
    currency: a.currency,
    includeInNetWorth: a.includeInNetWorth,
    archived: a.archivedAt !== null,
    hasHoldings,
    balanceMinor: a.openingBalanceMinor + (sumBy.get(a.id) ?? 0n),
  }));

  return {
    asOf,
    baseCurrency,
    ctx: { baseCurrency, date: asOf, currencies, fxRates, prices: [] },
    accounts,
  };
}

/** Holdings per account plus the prices (on/before as_of) of the held instruments. */
export async function loadHoldings(db: Db, ws: string, accountIds: string[], asOf: string) {
  const holdings = new Map<string, HoldingInput[]>();
  if (!accountIds.length) return { holdings, prices: [] as PricePoint[] };
  const hs = await db
    .select()
    .from(schema.holdings)
    .where(
      and(eq(schema.holdings.workspaceId, ws), inArray(schema.holdings.accountId, accountIds)),
    );
  for (const h of hs) {
    holdings.set(h.accountId, [
      ...(holdings.get(h.accountId) ?? []),
      { instrumentId: h.instrumentId, units: h.units },
    ]);
  }
  const instrumentIds = [...new Set(hs.map((h) => h.instrumentId))];
  const prices: PricePoint[] = instrumentIds.length
    ? await db
        .select({
          instrumentId: schema.prices.instrumentId,
          date: schema.prices.date,
          price: schema.prices.price,
          currency: schema.prices.currency,
        })
        .from(schema.prices)
        .where(
          and(
            eq(schema.prices.workspaceId, ws),
            inArray(schema.prices.instrumentId, instrumentIds),
            lte(schema.prices.date, asOf),
          ),
        )
        .orderBy(desc(schema.prices.date), desc(schema.prices.updatedAt))
    : [];
  return { holdings, prices };
}
