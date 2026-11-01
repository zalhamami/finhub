import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { schema } from '@finhub/db';
import { z } from 'zod';
import { ApiError, conflict, notFound } from '../lib/errors';
import {
  boolQuery,
  idParam,
  minor,
  nonEmptyPatch,
  send,
  toApi,
  toDb,
  v,
  type AppEnv,
} from '../lib/http';
import { assertOwned } from '../lib/refs';
import { balanceSeries, daysBefore, loadDailyDeltas } from '../lib/balance-history';
import { todayJakarta } from '../lib/time';

const t = schema.accounts;
const day = z.number().int().min(1).max(31);
const createSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  type_id: z.guid(),
  group_id: z.guid().nullable().optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3,10}$/, 'must be an upper-case currency code')
    .optional(),
  icon: z.string().max(100).nullable().optional(),
  color: z.string().max(50).nullable().optional(),
  opening_balance_minor: minor.optional(),
  opening_date: z.iso.date().nullable().optional(),
  credit_limit_minor: minor
    .refine((b) => b >= 0n, 'must be >= 0')
    .nullable()
    .optional(),
  statement_day: day.nullable().optional(),
  due_day: day.nullable().optional(),
  include_in_net_worth: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});
const patchSchema = nonEmptyPatch(createSchema.partial());
const listQuery = z.object({ include_archived: boolQuery });
const reorderSchema = z
  .array(z.strictObject({ id: z.guid(), sort_order: z.number().int() }))
  .min(1)
  .max(500)
  .refine((a) => new Set(a.map((x) => x.id)).size === a.length, 'duplicate ids');

const historyQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

export function accountsRoutes(deps: { now?: () => Date } = {}): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const where = (ws: string, id: string) => and(eq(t.id, id), eq(t.workspaceId, ws));

  async function checkRefs(
    c: { var: AppEnv['Variables'] },
    body: { type_id?: string; group_id?: string | null; currency?: string },
  ) {
    const { db, workspaceId } = c.var;
    if (body.type_id) {
      await assertOwned(
        db,
        workspaceId,
        schema.accountTypes,
        body.type_id,
        'type_id',
        'account type',
      );
    }
    if (body.group_id) {
      await assertOwned(
        db,
        workspaceId,
        schema.accountGroups,
        body.group_id,
        'group_id',
        'account group',
      );
    }
    if (body.currency) {
      const [cur] = await db
        .select({ code: schema.currencies.code })
        .from(schema.currencies)
        .where(eq(schema.currencies.code, body.currency));
      if (!cur)
        throw new ApiError(400, 'invalid_reference', `currency: ${body.currency} does not exist`, {
          field: 'currency',
        });
    }
  }

  const entryCount = async (c: { var: AppEnv['Variables'] }, id: string) => {
    const [row] = await c.var.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.entries)
      .where(
        and(eq(schema.entries.accountId, id), eq(schema.entries.workspaceId, c.var.workspaceId)),
      );
    return row?.n ?? 0;
  };

  r.get('/', v('query', listQuery), async (c) => {
    const { include_archived } = c.req.valid('query');
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
    return send(c, rows.map(toApi));
  });

  // Registered before /:id so "reorder" is not taken as an id.
  r.patch('/reorder', v('json', reorderSchema), async (c) => {
    const items = c.req.valid('json');
    const { db, workspaceId } = c.var;
    const ids = items.map((i) => i.id);
    const found = await db
      .select({ id: t.id })
      .from(t)
      .where(and(eq(t.workspaceId, workspaceId), inArray(t.id, ids)));
    if (found.length !== ids.length) {
      const have = new Set(found.map((f) => f.id));
      throw new ApiError(
        400,
        'invalid_reference',
        'id: some accounts not found in this workspace',
        {
          field: 'id',
          missing: ids.filter((i) => !have.has(i)),
        },
      );
    }
    const rows = await db.transaction(async (tx) => {
      for (const i of items) {
        await tx.update(t).set({ sortOrder: i.sort_order }).where(where(workspaceId, i.id));
      }
      return tx
        .select()
        .from(t)
        .where(and(eq(t.workspaceId, workspaceId), inArray(t.id, ids)))
        .orderBy(asc(t.sortOrder), asc(t.name));
    });
    return send(c, rows.map(toApi));
  });

  r.get('/:id', v('param', idParam), async (c) => {
    const [row] = await c.var.db
      .select()
      .from(t)
      .where(where(c.var.workspaceId, c.req.valid('param').id));
    if (!row) throw notFound('Account');
    return send(c, toApi(row));
  });

  // End-of-day balance (Asia/Jakarta) in the account's own currency for the last `days` days:
  // days + 1 points, from `days` ago through today. Opening balance is always included.
  r.get('/:id/balance-history', v('param', idParam), v('query', historyQuery), async (c) => {
    const { id } = c.req.valid('param');
    const { days } = c.req.valid('query');
    const [acc] = await c.var.db.select().from(t).where(where(c.var.workspaceId, id));
    if (!acc) throw notFound('Account');
    const to = todayJakarta(deps.now?.());
    const from = daysBefore(to, days);
    const deltas = await loadDailyDeltas(c.var.db, c.var.workspaceId, id, to);
    const points = balanceSeries(acc.openingBalanceMinor, deltas, from, to).map((p) => ({
      date: p.date,
      balance_minor: p.balanceMinor,
    }));
    return send(c, {
      currency: acc.currency,
      from,
      to,
      points,
      start_balance_minor: points[0]!.balance_minor,
      end_balance_minor: points.at(-1)!.balance_minor,
    });
  });

  r.post('/', v('json', createSchema), async (c) => {
    const body = c.req.valid('json');
    await checkRefs(c, body);
    const [row] = await c.var.db
      .insert(t)
      .values({ ...toDb(body), workspaceId: c.var.workspaceId } as typeof t.$inferInsert)
      .returning();
    return send(c, toApi(row!), 201);
  });

  r.patch('/:id', v('param', idParam), v('json', patchSchema), async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const [cur] = await c.var.db.select().from(t).where(where(c.var.workspaceId, id));
    if (!cur) throw notFound('Account');
    await checkRefs(c, body);
    if (
      body.currency !== undefined &&
      body.currency !== cur.currency &&
      (await entryCount(c, id)) > 0
    ) {
      throw conflict('account_has_entries', 'currency cannot change once the account has entries');
    }
    const [row] = await c.var.db
      .update(t)
      .set(toDb(body))
      .where(where(c.var.workspaceId, id))
      .returning();
    return send(c, toApi(row!));
  });

  const setArchived = (archive: boolean) => async (c: import('hono').Context<AppEnv>) => {
    const { id } = idParam.parse(c.req.param());
    const [row] = await c.var.db
      .update(t)
      .set({ archivedAt: archive ? sql`coalesce(${t.archivedAt}, now())` : null })
      .where(where(c.var.workspaceId, id))
      .returning();
    if (!row) throw notFound('Account');
    return send(c, toApi(row));
  };
  r.post('/:id/archive', setArchived(true));
  r.post('/:id/unarchive', setArchived(false));

  r.delete('/:id', v('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const [cur] = await c.var.db.select({ id: t.id }).from(t).where(where(c.var.workspaceId, id));
    if (!cur) throw notFound('Account');
    if ((await entryCount(c, id)) > 0) {
      throw conflict(
        'account_has_entries',
        `Account has transactions and cannot be deleted; archive it instead (POST /api/v1/accounts/${id}/archive)`,
      );
    }
    await c.var.db.delete(t).where(where(c.var.workspaceId, id));
    return send(c, { id });
  });

  return r;
}
