/** Transaction list filters: URL search params <-> state <-> API query string. */
import { addDays, daysInMonth, isIsoDate, ymd } from './dates';

export const TX_TYPES = ['expense', 'income', 'transfer'] as const;
export type TxType = (typeof TX_TYPES)[number];

export interface TxFilters {
  /** account id (entries on this account, incl. transfer legs) */
  account?: string;
  /** category id (includes its subcategories) */
  category?: string;
  type?: TxType;
  /** Jakarta dates, inclusive */
  from?: string;
  to?: string;
  q?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const Q_MAX = 200;

/** The router JSON-parses search values ("123" arrives as a number), so accept string | number. */
const text = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined;

/** Filter state -> search params (empty values omitted). */
export function filtersToSearch(f: TxFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.account) out.account = f.account;
  if (f.category) out.category = f.category;
  if (f.type) out.type = f.type;
  if (f.from) out.from = f.from;
  if (f.to) out.to = f.to;
  const q = f.q?.trim();
  if (q) out.q = q;
  return out;
}

/** Untrusted search params -> valid filters. Garbage is dropped, never thrown on. */
export function searchToFilters(raw: Record<string, unknown>): TxFilters {
  const f: TxFilters = {};
  const account = text(raw.account);
  if (account && UUID.test(account)) f.account = account;
  const category = text(raw.category);
  if (category && UUID.test(category)) f.category = category;
  const type = text(raw.type);
  if (type && (TX_TYPES as readonly string[]).includes(type)) f.type = type as TxType;
  let from = text(raw.from);
  let to = text(raw.to);
  if (from && !isIsoDate(from)) from = undefined;
  if (to && !isIsoDate(to)) to = undefined;
  if (from && to && from > to) [from, to] = [to, from];
  if (from) f.from = from;
  if (to) f.to = to;
  const q = text(raw.q)?.trim().slice(0, Q_MAX).trim();
  if (q) f.q = q;
  return f;
}

export const hasActiveFilters = (f: TxFilters) => Object.keys(filtersToSearch(f)).length > 0;

/** Filters -> GET /transactions query string (server names). A category filter includes children. */
export function filtersToApiQuery(
  f: TxFilters,
  page: { limit: number; cursor?: string | null },
): string {
  const p = new URLSearchParams();
  if (f.account) p.set('account_id', f.account);
  if (f.category) {
    p.set('category_id', f.category);
    p.set('include_subcategories', 'true');
  }
  if (f.type) p.set('kind', f.type);
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  const q = f.q?.trim();
  if (q) p.set('q', q);
  p.set('limit', String(page.limit));
  if (page.cursor) p.set('cursor', page.cursor);
  return p.toString();
}

export type DatePresetName = 'this-month' | 'last-month' | 'last-30';
export const DATE_PRESETS: { name: DatePresetName; label: string }[] = [
  { name: 'this-month', label: 'Bulan ini' },
  { name: 'last-month', label: 'Bulan lalu' },
  { name: 'last-30', label: '30 hari' },
];

/** Quick date ranges relative to `today` (a Jakarta YYYY-MM-DD). Calendar months. */
export function datePreset(name: DatePresetName, today: string): { from: string; to: string } {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  if (name === 'this-month') return { from: ymd(y, m, 1), to: ymd(y, m, daysInMonth(y, m)) };
  if (name === 'last-month') {
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    return { from: ymd(py, pm, 1), to: ymd(py, pm, daysInMonth(py, pm)) };
  }
  return { from: addDays(today, -29), to: today };
}
