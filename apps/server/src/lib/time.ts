/** Business timezone is Asia/Jakarta (UTC+7, no DST), so a fixed offset is exact. */
const OFFSET = '+07:00';

/** Instant at 00:00 Asia/Jakarta on `date` (YYYY-MM-DD). */
export const jakartaDayStart = (date: string): Date => new Date(`${date}T00:00:00${OFFSET}`);

/** YYYY-MM-DD one day after `date`. */
export function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Exclusive upper bound for "on or before `date`, end of day Asia/Jakarta". */
export const jakartaEndExclusive = (date: string): Date => jakartaDayStart(nextDay(date));

/** Today's date in Asia/Jakarta. */
export const todayJakarta = (now: Date = new Date()): string =>
  new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
