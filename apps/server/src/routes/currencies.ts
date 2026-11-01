import { asc } from 'drizzle-orm';
import { Hono } from 'hono';
import { schema } from '@finhub/db';
import { send, type AppEnv } from '../lib/http';

const t = schema.currencies;

/** Currencies are global reference data (not workspace-scoped); read-only. */
export function currenciesRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get('/', async (c) => {
    const rows = await c.var.db
      .select({
        code: t.code,
        minor_unit: t.minorUnit,
        display_decimals: t.displayDecimals,
        symbol: t.symbol,
      })
      .from(t)
      .orderBy(asc(t.code));
    return send(c, rows);
  });
  return r;
}
