import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { Hono } from 'hono';
import { schema } from '@finhub/db';
import { z } from 'zod';
import { ApiError, notFound } from '../lib/errors';
import { idParam, nonEmptyPatch, send, toApi, toDb, v, type AppEnv } from '../lib/http';

const t = schema.fxRates;
const ccy = z.string().regex(/^[A-Z]{3,10}$/, 'must be an upper-case currency code');
/** numeric(20,10): positive decimal string, up to 10 integer and 10 fractional digits. */
const rate = z
  .string()
  .regex(
    /^\d{1,10}(\.\d{1,10})?$/,
    'must be a decimal string (max 10 integer and 10 fractional digits)',
  )
  .refine((s) => /[1-9]/.test(s), 'must be > 0');

const createSchema = z
  .strictObject({
    base: ccy,
    quote: ccy,
    date: z.iso.date(),
    rate,
    source: z.string().trim().min(1).max(50).default('manual'),
  })
  .refine((b) => b.base !== b.quote, { message: 'base and quote must differ', path: ['quote'] });
const patchSchema = nonEmptyPatch(
  z.strictObject({ date: z.iso.date(), rate, source: z.string().trim().min(1).max(50) }).partial(),
);
const listQuery = z.object({
  base: ccy.optional(),
  quote: ccy.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

export function fxRatesRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const where = (ws: string, id: string) => and(eq(t.id, id), eq(t.workspaceId, ws));

  async function checkCurrencies(c: { var: AppEnv['Variables'] }, codes: string[]) {
    for (const code of codes) {
      const [cur] = await c.var.db
        .select({ code: schema.currencies.code })
        .from(schema.currencies)
        .where(eq(schema.currencies.code, code));
      if (!cur) {
        throw new ApiError(400, 'invalid_reference', `currency: ${code} does not exist`, {
          field: 'currency',
        });
      }
    }
  }

  r.get('/', v('query', listQuery), async (c) => {
    const q = c.req.valid('query');
    const rows = await c.var.db
      .select()
      .from(t)
      .where(
        and(
          eq(t.workspaceId, c.var.workspaceId),
          q.base ? eq(t.base, q.base) : undefined,
          q.quote ? eq(t.quote, q.quote) : undefined,
          q.from ? gte(t.date, q.from) : undefined,
          q.to ? lte(t.date, q.to) : undefined,
        ),
      )
      .orderBy(desc(t.date), t.base, t.quote, t.source);
    return send(c, rows.map(toApi));
  });

  r.get('/:id', v('param', idParam), async (c) => {
    const [row] = await c.var.db
      .select()
      .from(t)
      .where(where(c.var.workspaceId, c.req.valid('param').id));
    if (!row) throw notFound('FX rate');
    return send(c, toApi(row));
  });

  // unique (workspace, base, quote, date, source) violations surface as 409 unique_violation
  r.post('/', v('json', createSchema), async (c) => {
    const body = c.req.valid('json');
    await checkCurrencies(c, [body.base, body.quote]);
    const [row] = await c.var.db
      .insert(t)
      .values({ ...body, workspaceId: c.var.workspaceId })
      .returning();
    return send(c, toApi(row!), 201);
  });

  r.patch('/:id', v('param', idParam), v('json', patchSchema), async (c) => {
    const [row] = await c.var.db
      .update(t)
      .set(toDb(c.req.valid('json')))
      .where(where(c.var.workspaceId, c.req.valid('param').id))
      .returning();
    if (!row) throw notFound('FX rate');
    return send(c, toApi(row));
  });

  r.delete('/:id', v('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const rows = await c.var.db
      .delete(t)
      .where(where(c.var.workspaceId, id))
      .returning({ id: t.id });
    if (!rows.length) throw notFound('FX rate');
    return send(c, { id });
  });

  return r;
}
