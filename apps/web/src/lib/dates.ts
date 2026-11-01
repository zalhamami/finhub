/** Business timezone is Asia/Jakarta (UTC+7, no DST), so a fixed offset is exact. */
const JAKARTA_MS = 7 * 3600_000;
const pad = (n: number) => String(n).padStart(2, '0');

/** Real calendar date in YYYY-MM-DD form ("2026-02-30" is not). */
export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
}

export const isClockTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

const jakartaIso = (at: Date | string) =>
  new Date(new Date(at).getTime() + JAKARTA_MS).toISOString();

/** Instant (ISO string or Date) -> its Asia/Jakarta calendar date. */
export const jakartaDate = (at: Date | string): string => jakartaIso(at).slice(0, 10);
/** Instant -> Asia/Jakarta "HH:mm". */
export const jakartaTime = (at: Date | string): string => jakartaIso(at).slice(11, 16);
/** Instant -> Asia/Jakarta "HH:mm:ss". */
export const jakartaClock = (at: Date | string): string => jakartaIso(at).slice(11, 19);
export const todayJakarta = (now: Date = new Date()): string => jakartaDate(now);

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

export const ymd = (y: number, m1: number, d: number) => `${y}-${pad(m1)}-${pad(d)}`;
