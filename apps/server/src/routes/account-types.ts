import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { schema } from '@finhub/db';
import { z } from 'zod';
import { conflict, notFound } from '../lib/errors';
import { idParam, nonEmptyPatch, send, toApi, toDb, v, type AppEnv } from '../lib/http';

const t = schema.accountTypes;
const fields = {
  name: z.string().trim().min(1).max(100),
  icon: z.string().max(100).nullable(),
  kind: z.enum(schema.accountKind.enumValues),
  has_credit_limit: z.boolean(),
  has_due_day: z.boolean(),
  has_holdings: z.boolean(),
};
const createSchema = z.strictObject({
  name: fields.name,
  kind: fields.kind,
  icon: fields.icon.optional(),
  has_credit_limit: fields.has_credit_limit.optional(),
  has_due_day: fields.has_due_day.optional(),
  has_holdings: fields.has_holdings.optional(),
});
const patchSchema = nonEmptyPatch(createSchema.partial());

export function accountTypesRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const where = (ws: string, id: string) => and(eq(t.id, id), eq(t.workspaceId, ws));

  const inUse = async (c: { var: AppEnv['Variables'] }, id: string) => {
    const [row] = await c.var.db
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(
        and(eq(schema.accounts.typeId, id), eq(schema.accounts.workspaceId, c.var.workspaceId)),
      )
      .limit(1);
    return !!row;
  };

  r.get('/', async (c) => {
    const rows = await c.var.db
      .select()
      .from(t)
      .where(eq(t.workspaceId, c.var.workspaceId))
      .orderBy(asc(t.name));
    return send(c, rows.map(toApi));
  });

  r.get('/:id', v('param', idParam), async (c) => {
    const [row] = await c.var.db
      .select()
      .from(t)
      .where(where(c.var.workspaceId, c.req.valid('param').id));
    if (!row) throw notFound('Account type');
    return send(c, toApi(row));
  });

  r.post('/', v('json', createSchema), async (c) => {
    const [row] = await c.var.db
      .insert(t)
      .values({
        ...toDb(c.req.valid('json')),
        workspaceId: c.var.workspaceId,
      } as typeof t.$inferInsert)
      .returning();
    return send(c, toApi(row!), 201);
  });

  r.patch('/:id', v('param', idParam), v('json', patchSchema), async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const [cur] = await c.var.db.select().from(t).where(where(c.var.workspaceId, id));
    if (!cur) throw notFound('Account type');
    if (body.kind !== undefined && body.kind !== cur.kind && (await inUse(c, id))) {
      throw conflict(
        'account_type_in_use',
        'kind is immutable while accounts reference this account type',
      );
    }
    const [row] = await c.var.db
      .update(t)
      .set(toDb(body))
      .where(where(c.var.workspaceId, id))
      .returning();
    return send(c, toApi(row!));
  });

  r.delete('/:id', v('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const [cur] = await c.var.db.select({ id: t.id }).from(t).where(where(c.var.workspaceId, id));
    if (!cur) throw notFound('Account type');
    if (await inUse(c, id)) {
      throw conflict(
        'account_type_in_use',
        'Account type is used by accounts; reassign or delete them first',
      );
    }
    await c.var.db.delete(t).where(where(c.var.workspaceId, id));
    return send(c, { id });
  });

  return r;
}
