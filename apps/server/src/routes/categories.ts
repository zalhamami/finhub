import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { schema } from '@finhub/db';
import { z } from 'zod';
import { ApiError, conflict, notFound } from '../lib/errors';
import { boolQuery, idParam, nonEmptyPatch, send, toApi, toDb, v, type AppEnv } from '../lib/http';

const t = schema.categories;
type Row = typeof t.$inferSelect;

const createSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(schema.categoryKind.enumValues),
  parent_id: z.guid().nullable().optional(),
  icon: z.string().max(100).nullable().optional(),
  color: z.string().max(50).nullable().optional(),
  sort_order: z.number().int().optional(),
});
/** `kind` is immutable after creation (children must share their parent's kind). */
const patchSchema = nonEmptyPatch(createSchema.omit({ kind: true }).partial());
const listQuery = z.object({ flat: boolQuery, include_archived: boolQuery });

const bySort = (a: Row, b: Row) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

export interface CategoryNode extends Record<string, unknown> {
  children: CategoryNode[];
}

/** Rows -> nested tree, siblings sorted by sort_order then name. Rows whose parent is absent from `rows` are dropped. */
export function buildTree(rows: Row[]): CategoryNode[] {
  const nodes = new Map<string, CategoryNode>();
  for (const row of [...rows].sort(bySort)) nodes.set(row.id, { ...toApi(row), children: [] });
  const roots: CategoryNode[] = [];
  for (const row of [...rows].sort(bySort)) {
    const node = nodes.get(row.id)!;
    if (!row.parentId) roots.push(node);
    else nodes.get(row.parentId)?.children.push(node);
  }
  return roots;
}

export function categoriesRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const where = (ws: string, id: string) => and(eq(t.id, id), eq(t.workspaceId, ws));
  const loadAll = (c: { var: AppEnv['Variables'] }) =>
    c.var.db.select().from(t).where(eq(t.workspaceId, c.var.workspaceId));

  /** parent must exist in this workspace and share `kind`; returns the parent row. */
  async function checkParent(c: { var: AppEnv['Variables'] }, parentId: string, kind: Row['kind']) {
    const [p] = await c.var.db.select().from(t).where(where(c.var.workspaceId, parentId));
    if (!p)
      throw new ApiError(
        400,
        'invalid_reference',
        'parent_id: category not found in this workspace',
        { field: 'parent_id' },
      );
    if (p.kind !== kind) {
      throw new ApiError(
        400,
        'category_kind_mismatch',
        `parent is ${p.kind}, child must be ${p.kind} too`,
        { field: 'parent_id' },
      );
    }
    if (p.archivedAt)
      throw conflict('parent_archived', 'Cannot attach a category to an archived parent');
    return p;
  }

  const descendants = (all: Row[], id: string): string[] => {
    const kids = new Map<string, string[]>();
    for (const x of all)
      if (x.parentId) kids.set(x.parentId, [...(kids.get(x.parentId) ?? []), x.id]);
    const out: string[] = [];
    const stack = [...(kids.get(id) ?? [])];
    while (stack.length) {
      const n = stack.pop()!;
      out.push(n);
      stack.push(...(kids.get(n) ?? []));
    }
    return out;
  };

  r.get('/', v('query', listQuery), async (c) => {
    const { flat, include_archived } = c.req.valid('query');
    const rows = await c.var.db
      .select()
      .from(t)
      .where(
        and(
          eq(t.workspaceId, c.var.workspaceId),
          include_archived ? undefined : isNull(t.archivedAt),
        ),
      )
      .orderBy(asc(t.sortOrder), asc(t.name));
    return send(c, flat ? rows.map(toApi) : buildTree(rows));
  });

  r.get('/:id', v('param', idParam), async (c) => {
    const [row] = await c.var.db
      .select()
      .from(t)
      .where(where(c.var.workspaceId, c.req.valid('param').id));
    if (!row) throw notFound('Category');
    return send(c, toApi(row));
  });

  r.post('/', v('json', createSchema), async (c) => {
    const body = c.req.valid('json');
    if (body.parent_id) await checkParent(c, body.parent_id, body.kind);
    const [row] = await c.var.db
      .insert(t)
      .values({ ...toDb(body), workspaceId: c.var.workspaceId } as typeof t.$inferInsert)
      .returning();
    return send(c, toApi(row!), 201);
  });

  r.patch('/:id', v('param', idParam), v('json', patchSchema), async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const all = await loadAll(c);
    const cur = all.find((x) => x.id === id);
    if (!cur) throw notFound('Category');

    if (body.parent_id) {
      if (body.parent_id === id || descendants(all, id).includes(body.parent_id)) {
        throw new ApiError(400, 'category_cycle', 'A category cannot be its own ancestor', {
          field: 'parent_id',
        });
      }
      if (body.parent_id !== cur.parentId) await checkParent(c, body.parent_id, cur.kind);
    }
    const [row] = await c.var.db
      .update(t)
      .set(toDb(body))
      .where(where(c.var.workspaceId, id))
      .returning();
    return send(c, toApi(row!));
  });

  /** Archiving cascades to descendants so the tree never shows active children under an archived parent. */
  r.post('/:id/archive', v('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const all = await loadAll(c);
    if (!all.some((x) => x.id === id)) throw notFound('Category');
    const ids = [id, ...descendants(all, id)];
    await c.var.db
      .update(t)
      .set({ archivedAt: sql`coalesce(${t.archivedAt}, now())` })
      .where(and(eq(t.workspaceId, c.var.workspaceId), inArray(t.id, ids)));
    const [row] = await c.var.db.select().from(t).where(where(c.var.workspaceId, id));
    return send(c, toApi(row!));
  });

  /** Restores only this node (not descendants); its parent must not be archived. */
  r.post('/:id/unarchive', v('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const all = await loadAll(c);
    const cur = all.find((x) => x.id === id);
    if (!cur) throw notFound('Category');
    if (cur.parentId && all.find((x) => x.id === cur.parentId)?.archivedAt) {
      throw conflict('parent_archived', 'Unarchive the parent category first');
    }
    const [row] = await c.var.db
      .update(t)
      .set({ archivedAt: null })
      .where(where(c.var.workspaceId, id))
      .returning();
    return send(c, toApi(row!));
  });

  r.delete('/:id', v('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const { db, workspaceId } = c.var;
    const [cur] = await db.select({ id: t.id }).from(t).where(where(workspaceId, id));
    if (!cur) throw notFound('Category');
    const [child] = await db
      .select({ id: t.id })
      .from(t)
      .where(and(eq(t.workspaceId, workspaceId), eq(t.parentId, id)))
      .limit(1);
    if (child)
      throw conflict(
        'category_has_children',
        'Category has sub-categories; delete or move them first',
      );
    const [used] = await db
      .select({ id: schema.entries.id })
      .from(schema.entries)
      .where(and(eq(schema.entries.workspaceId, workspaceId), eq(schema.entries.categoryId, id)))
      .limit(1);
    if (used) {
      throw conflict(
        'category_in_use',
        `Category is referenced by transactions; archive it instead (POST /api/v1/categories/${id}/archive)`,
      );
    }
    await db.delete(t).where(where(workspaceId, id));
    return send(c, { id });
  });

  return r;
}
