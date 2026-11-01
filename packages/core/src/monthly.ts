import type { PricePoint } from './fx';

/** A base-currency income/expense movement. `amountMinor` is a magnitude in the direction of `kind`
 *  (expense: money spent, negative = refund; income: money received). Dates are Asia/Jakarta days. */
export interface Flow {
  date: string; // YYYY-MM-DD
  kind: 'income' | 'expense';
  amountMinor: bigint;
  categoryId: string | null;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function prevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
}

export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthBounds(month: string): { start: string; endExclusive: string } {
  return { start: `${month}-01`, endExclusive: `${nextMonth(month)}-01` };
}

export interface FlowTotals {
  incomeMinor: bigint;
  expenseMinor: bigint;
  netMinor: bigint;
}

export interface MonthComparison {
  current: FlowTotals;
  previous: FlowTotals;
  /** day of month used for the pace comparison (today's day for the current month, else the last day) */
  compareDay: number;
  /** previous month's expense up to `compareDay` (clamped to its length) */
  previousExpenseToDateMinor: bigint;
  /** current expense - previousExpenseToDateMinor; > 0 means spending faster than last month */
  expenseVsPreviousToDateMinor: bigint;
}

function totals(flows: readonly Flow[], month: string, maxDay = 31): FlowTotals {
  let income = 0n;
  let expense = 0n;
  for (const x of flows) {
    if (!x.date.startsWith(`${month}-`) || Number(x.date.slice(8, 10)) > maxDay) continue;
    if (x.kind === 'income') income += x.amountMinor;
    else expense += x.amountMinor;
  }
  return { incomeMinor: income, expenseMinor: expense, netMinor: income - expense };
}

/** Calendar-month totals for `month` and the month before, plus a same-day pace comparison. */
export function compareMonths(
  flows: readonly Flow[],
  month: string,
  today: string,
): MonthComparison {
  const compareDay = today.startsWith(`${month}-`)
    ? Number(today.slice(8, 10))
    : daysInMonth(month);
  const prev = prevMonth(month);
  const current = totals(flows, month);
  const previous = totals(flows, prev);
  const previousExpenseToDateMinor = totals(flows, prev, compareDay).expenseMinor;
  return {
    current,
    previous,
    compareDay,
    previousExpenseToDateMinor,
    expenseVsPreviousToDateMinor: current.expenseMinor - previousExpenseToDateMinor,
  };
}

export interface CategoryRow {
  categoryId: string;
  amountMinor: bigint;
  /** share of the month's total expense, basis points (integer, rounded half up) */
  shareBps: number;
  previousAmountMinor: bigint;
}
export interface OtherRow {
  amountMinor: bigint;
  shareBps: number;
  previousAmountMinor: bigint;
}

function rootOf(id: string, parentOf: ReadonlyMap<string, string | null>): string {
  const seen = new Set<string>();
  let cur = id;
  while (!seen.has(cur)) {
    seen.add(cur);
    const p = parentOf.get(cur);
    if (!p) return cur;
    cur = p;
  }
  return id; // cycle: keep the category itself
}

const bps = (part: bigint, whole: bigint): number =>
  whole === 0n ? 0 : Number((part * 10000n * 2n + whole) / (whole * 2n));

/**
 * Expense per top-level category (children roll up), largest first. Top `limit` rows plus an
 * "other" row (the rest, including uncategorized) when anything is left over.
 */
export function topExpenseCategories(
  flows: readonly Flow[],
  month: string,
  parentOf: ReadonlyMap<string, string | null>,
  limit = 5,
): { totalMinor: bigint; top: CategoryRow[]; other: OtherRow | null } {
  const prev = prevMonth(month);
  const cur = new Map<string | null, bigint>();
  const prv = new Map<string | null, bigint>();
  let total = 0n;
  for (const x of flows) {
    if (x.kind !== 'expense') continue;
    const bucket = x.date.startsWith(`${month}-`)
      ? cur
      : x.date.startsWith(`${prev}-`)
        ? prv
        : null;
    if (!bucket) continue;
    const key = x.categoryId ? rootOf(x.categoryId, parentOf) : null;
    bucket.set(key, (bucket.get(key) ?? 0n) + x.amountMinor);
    if (bucket === cur) total += x.amountMinor;
  }
  const ranked = [...cur.entries()]
    .filter((e): e is [string, bigint] => e[0] !== null && e[1] > 0n)
    .sort((a, b) => (a[1] === b[1] ? a[0].localeCompare(b[0]) : a[1] > b[1] ? -1 : 1));
  const top = ranked.slice(0, limit).map(([categoryId, amountMinor]) => ({
    categoryId,
    amountMinor,
    shareBps: bps(amountMinor, total),
    previousAmountMinor: prv.get(categoryId) ?? 0n,
  }));
  const shown = new Set(top.map((t) => t.categoryId));
  const otherAmount = [...cur.entries()]
    .filter(([k]) => k === null || !shown.has(k))
    .reduce((s, [, a]) => s + a, 0n);
  const otherPrev = [...prv.entries()]
    .filter(([k]) => k === null || !shown.has(k))
    .reduce((s, [, a]) => s + a, 0n);
  const other =
    otherAmount > 0n
      ? {
          amountMinor: otherAmount,
          shareBps: bps(otherAmount, total),
          previousAmountMinor: otherPrev,
        }
      : null;
  return { totalMinor: total, top, other };
}

/* ---------- net worth history ---------- */

const addDays = (date: string, n: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Sample dates for a trend, ascending. month: the last day of each of the previous `months - 1`
 * months, then `today` (so `months` points). week: every 7 days back from `today`, down to the first
 * day of the oldest of the `months` months.
 */
export function historyDates(
  today: string,
  months: number,
  granularity: 'month' | 'week',
): string[] {
  if (granularity === 'week') {
    let oldest = today.slice(0, 7);
    for (let i = 1; i < months; i++) oldest = prevMonth(oldest);
    const floor = `${oldest}-01`;
    const out: string[] = [];
    for (let d = today; d >= floor; d = addDays(d, -7)) out.unshift(d);
    return out;
  }
  const out: string[] = [];
  let m = today.slice(0, 7);
  for (let i = 1; i < months; i++) m = prevMonth(m);
  for (let i = 0; i < months - 1; i++) {
    out.push(`${m}-${pad(daysInMonth(m))}`);
    m = nextMonth(m);
  }
  out.push(today);
  return out;
}

/**
 * Price list to value holdings at `date`: prices on/before `date`; an instrument that has none yet
 * falls back to its latest known price (re-dated so it is "on or before"), i.e. current valuation.
 */
export function pricesForDate(prices: readonly PricePoint[], date: string): PricePoint[] {
  const out: PricePoint[] = [];
  const latest = new Map<string, PricePoint>();
  const hasPast = new Set<string>();
  for (const p of prices) {
    const l = latest.get(p.instrumentId);
    if (!l || p.date > l.date) latest.set(p.instrumentId, p);
    if (p.date <= date) {
      out.push(p);
      hasPast.add(p.instrumentId);
    }
  }
  for (const [id, p] of latest) if (!hasPast.has(id)) out.push({ ...p, date: '0000-01-01' });
  return out;
}
