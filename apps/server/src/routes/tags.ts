import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { schema } from '@finhub/db';
import { z } from 'zod';
import { notFound } from '../lib/errors';
import { idParam, nonEmptyPatch, send, toApi, v, type AppEnv } from '../lib/http';

const t = schema.tags;
const createSchema = z.strictObject({ name: z.string().trim().min(1).max(50) });
const patchSchema = nonEmptyPatch(createSchema.partial());

export function tagsRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const where = (ws: string, id: string) => and(eq(t.id, id), eq(t.workspaceId, ws));

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
    if (!row) throw notFound('Tag');
    return send(c, toApi(row));
  });

  // unique (workspace_id, name) violations surface as 409 unique_violation
  r.post('/', v('json', createSchema), async (c) => {
    const [row] = await c.var.db
      .insert(t)
      .values({ ...c.req.valid('json'), workspaceId: c.var.workspaceId })
      .returning();
    return send(c, toApi(row!), 201);
  });

  r.patch('/:id', v('param', idParam), v('json', patchSchema), async (c) => {
    const [row] = await c.var.db
      .update(t)
      .set(c.req.valid('json'))
      .where(where(c.var.workspaceId, c.req.valid('param').id))
      .returning();
    if (!row) throw notFound('Tag');
    return send(c, toApi(row));
  });

  /** Removes the tag from every transaction (join rows cascade). */
  r.delete('/:id', v('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const rows = await c.var.db
      .delete(t)
      .where(where(c.var.workspaceId, id))
      .returning({ id: t.id });
    if (!rows.length) throw notFound('Tag');
    return send(c, { id });
  });

  return r;
}
