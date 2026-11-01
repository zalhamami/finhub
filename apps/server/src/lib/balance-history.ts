import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { schema, type Db } from '@finhub/db';
import { jakartaEndExclusive, nextDay } from './time';

/** YYYY-MM-DD `n` days before `date` (n >= 0). */
export function daysBefore(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export interface BalancePoint {
  date: string;
  balanceMinor: bigint;
}

/**
 * End-of-day balances for `from..to` (inclusive, YYYY-MM-DD). `before` is the balance before any
 * delta; `deltas` maps a Jakarta day to the sum of that day's entries (days before `from` fold in).
 */
export function balanceSeries(
  before: bigint,
  deltas: ReadonlyMap<string, bigint>,
  from: string,
  to: string,
): BalancePoint[] {
  let bal = before;
  for (const [day, d] of deltas) if (day < from) bal += d;
  const out: BalancePoint[] = [];
  for (let day = from; day <= to; day = nextDay(day)) {
    bal += deltas.get(day) ?? 0n;
    out.push({ date: day, balanceMinor: bal });
  }
  return out;
}

/** Daily entry sums (posted, non-archived) of one account up to the end of `to`, by Jakarta day. */
export async function loadDailyDeltas(
  db: Db,
  ws: string,
  accountId: string,
  to: string,
): Promise<Map<string, bigint>> {
  const day = sql<string>`((${schema.transactions.occurredAt} at time zone 'Asia/Jakarta')::date)::text`;
  const rows = await db
    .select({ day, total: sql<string>`sum(${schema.entries.amountMinor})::text` })
    .from(schema.entries)
    .innerJoin(schema.transactions, eq(schema.entries.transactionId, schema.transactions.id))
    .where(
      and(
        eq(schema.entries.workspaceId, ws),
        eq(schema.transactions.workspaceId, ws),
        eq(schema.entries.accountId, accountId),
        eq(schema.transactions.status, 'posted'),
        isNull(schema.transactions.archivedAt),
        lt(schema.transactions.occurredAt, jakartaEndExclusive(to)),
      ),
    )
    .groupBy(day);
  return new Map(rows.map((r) => [r.day, BigInt(r.total)]));
}
