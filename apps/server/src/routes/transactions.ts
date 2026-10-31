import {
  and,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
  gte,
  type SQL,
} from 'drizzle-orm';
import { Hono } from 'hono';
import { schema } from '@finhub/db';
import { z } from 'zod';
import { fieldError, notFound } from '../lib/errors';
import { boolQuery, idParam, minor, nonEmptyPatch, send, v, type AppEnv } from '../lib/http';
import { assertOwned } from '../lib/refs';
import { jakartaDayStart, jakartaEndExclusive } from '../lib/time';
import {
  assertLedgerValid,
  buildSimpleEntries,
  buildTransferEntries,
  checkTags,
  hydrate,
  insertEntries,
  setTags,
  simpleSpecOf,
  transferSpecOf,
  type EntryDraft,
  type TransferSpec,
} from '../lib/transactions';

const t = schema.transactions;
const e = schema.entries;

const when = z.iso.datetime({ offset: true }).transform((s) => new Date(s));
const common = {
  occurred_at: when,
  note: z.string().max(2000).nullable().optional(),
  tag_ids: z.array(z.guid()).max(50).optional(),
  status: z.enum(schema.transactionStatus.enumValues).optional(),
  source: z.string().trim().min(1).max(50).optional(),
};

const createSchema = z.strictObject({
  ...common,
  kind: z.enum(['expense', 'income', 'adjustment']),
  account_id: z.guid(),
  amount_minor: minor,
  category_id: z.guid().nullable().optional(),
  payee: z.string().max(200).nullable().optional(),
});

const transferSchema = z.strictObject({
  ...common,
  from_account_id: z.guid(),
  to_account_id: z.guid(),
  amount_minor: minor,
  to_amount_minor: minor.nullable().optional(),
  fee_minor: minor.nullable().optional(),
  fee_category_id: z.guid().nullable().optional(),
});

const patchSchema = nonEmptyPatch(
  z
    .strictObject({
      occurred_at: when,
      payee: z.string().max(200).nullable(),
      note: z.string().max(2000).nullable(),
      status: z.enum(schema.transactionStatus.enumValues),
      tag_ids: z.array(z.guid()).max(50),
      // entry-replacing fields: expense / income / adjustment
      account_id: z.guid(),
      amount_minor: minor,
      category_id: z.guid().nullable(),
      // entry-replacing fields: transfer
      from_account_id: z.guid(),
      to_account_id: z.guid(),
      to_amount_minor: minor.nullable(),
      fee_minor: minor.nullable(),
      fee_category_id: z.guid().nullable(),
    })
    .partial(),
);
const SIMPLE_ONLY = ['account_id', 'category_id'] as const;
const TRANSFER_ONLY = [
  'from_account_id',
  'to_account_id',
  'to_amount_minor',
  'fee_minor',
  'fee_category_id',
] as const;

const isoOrDate = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
const listQuery = z.object({
  account_id: z.guid().optional(),
  category_id: z.guid().optional(),
  include_subcategories: boolQuery,
  tag_id: z.guid().optional(),
  kind: z.enum(schema.transactionKind.enumValues).optional(),
  status: z.enum(schema.transactionStatus.enumValues).optional(),
  from: isoOrDate.optional(),
  to: isoOrDate.optional(),
  q: z.string().trim().min(1).max(200).optional(),
  include_archived: boolQuery,
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(500).optional(),
});

/* opaque cursor: base64url([occurred_at as Postgres text, id]); text keeps microseconds exact */
const encodeCursor = (ts: string, id: string) =>
  Buffer.from(JSON.stringify([ts, id])).toString('base64url');
function decodeCursor(raw: string): { ts: string; id: string } {
  try {
    const [ts, id] = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown[];
    if (typeof ts === 'string' && z.guid().safeParse(id).success && !Number.isNaN(Date.parse(ts))) {
      return { ts, id: id as string };
    }
  } catch {
    /* fall through */
  }
  throw fieldError('cursor', 'invalid cursor');
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export function transactionsRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const where = (ws: string, id: string) => and(eq(t.id, id), eq(t.workspaceId, ws));

  async function getOne(c: { var: AppEnv['Variables'] }, id: string) {
    const { db, workspaceId } = c.var;
    const [h] = await db.select().from(t).where(where(workspaceId, id));
    if (!h) throw notFound('Transaction');
    return (await hydrate(db, workspaceId, [h]))[0]!;
  }

  r.get('/', v('query', listQuery), async (c) => {
    const q = c.req.valid('query');
    const { db, workspaceId: ws } = c.var;
    const conds: (SQL | undefined)[] = [eq(t.workspaceId, ws)];

    if (q.account_id) {
      await assertOwned(db, ws, schema.accounts, q.account_id, 'account_id', 'account');
      conds.push(
        exists(
          db
            .select({ x: sql`1` })
            .from(e)
            .where(and(eq(e.transactionId, t.id), eq(e.accountId, q.account_id))),
        ),
      );
    }
    if (q.category_id) {
      await assertOwned(db, ws, schema.categories, q.category_id, 'category_id', 'category');
      let ids = [q.category_id];
      if (q.include_subcategories) {
        const cats = await db
          .select({ id: schema.categories.id, parentId: schema.categories.parentId })
          .from(schema.categories)
          .where(eq(schema.categories.workspaceId, ws));
        const kids = new Map<string, string[]>();
        for (const x of cats)
          if (x.parentId) kids.set(x.parentId, [...(kids.get(x.parentId) ?? []), x.id]);
        const stack = [q.category_id];
        ids = [];
        while (stack.length) {
          const n = stack.pop()!;
          ids.push(n);
          stack.push(...(kids.get(n) ?? []));
        }
      }
      conds.push(
        exists(
          db
            .select({ x: sql`1` })
            .from(e)
            .where(and(eq(e.transactionId, t.id), inArray(e.categoryId, ids))),
        ),
      );
    }
    if (q.tag_id) {
      await assertOwned(db, ws, schema.tags, q.tag_id, 'tag_id', 'tag');
      conds.push(
        exists(
          db
            .select({ x: sql`1` })
            .from(schema.transactionTags)
            .where(
              and(
                eq(schema.transactionTags.transactionId, t.id),
                eq(schema.transactionTags.tagId, q.tag_id),
              ),
            ),
        ),
      );
    }
    if (q.kind) conds.push(eq(t.kind, q.kind));
    if (q.status) conds.push(eq(t.status, q.status));
    // date-only bounds are Asia/Jakarta days: from = start of day, to = end of day (inclusive)
    if (q.from) {
      conds.push(
        gte(t.occurredAt, q.from.length === 10 ? jakartaDayStart(q.from) : new Date(q.from)),
      );
    }
    if (q.to) {
      conds.push(
        q.to.length === 10
          ? lt(t.occurredAt, jakartaEndExclusive(q.to))
          : lte(t.occurredAt, new Date(q.to)),
      );
    }
    if (q.q) {
      const p = `%${escapeLike(q.q)}%`;
      conds.push(or(ilike(t.payee, p), ilike(t.note, p)));
    }
    if (!q.include_archived) conds.push(isNull(t.archivedAt));
    if (q.cursor) {
      const cur = decodeCursor(q.cursor);
      conds.push(sql`(${t.occurredAt}, ${t.id}) < (${cur.ts}::timestamptz, ${cur.id}::uuid)`);
    }

    const rows = await db
      .select({ h: t, ts: sql<string>`${t.occurredAt}::text` })
      .from(t)
      .where(and(...conds))
      .orderBy(desc(t.occurredAt), desc(t.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    const next = rows.length > q.limit && last ? encodeCursor(last.ts, last.h.id) : null;
    const data = await hydrate(
      db,
      ws,
      page.map((x) => x.h),
    );
    return send(c, data, 200, { next_cursor: next });
  });

  r.get('/:id', v('param', idParam), async (c) =>
    send(c, await getOne(c, c.req.valid('param').id)),
  );

  r.post('/', v('json', createSchema), async (c) => {
    const b = c.req.valid('json');
    const { db, workspaceId: ws } = c.var;
    const status = b.status ?? 'posted';
    const drafts = await buildSimpleEntries(db, ws, {
      kind: b.kind,
      accountId: b.account_id,
      amountMinor: b.amount_minor,
      categoryId: b.category_id ?? null,
    });
    assertLedgerValid(b.kind, status, drafts);
    const tagIds = await checkTags(db, ws, b.tag_ids ?? []);
    const id = await db.transaction(async (tx) => {
      const [h] = await tx
        .insert(t)
        .values({
          workspaceId: ws,
          occurredAt: b.occurred_at,
          kind: b.kind,
          payee: b.payee ?? null,
          note: b.note ?? null,
          status,
          source: b.source ?? 'manual',
        })
        .returning({ id: t.id });
      await insertEntries(tx, ws, h!.id, drafts);
      await setTags(tx, ws, h!.id, tagIds);
      return h!.id;
    });
    return send(c, await getOne(c, id), 201);
  });

  r.patch('/:id', v('param', idParam), v('json', patchSchema), async (c) => {
    const { id } = c.req.valid('param');
    const b = c.req.valid('json');
    const { db, workspaceId: ws } = c.var;
    const [h] = await db.select().from(t).where(where(ws, id));
    if (!h) throw notFound('Transaction');
    const entries = await db.select().from(e).where(eq(e.transactionId, id));
    const isTransfer = h.kind === 'transfer';

    for (const f of isTransfer ? SIMPLE_ONLY : TRANSFER_ONLY) {
      if (f in b) throw fieldError(f, `not applicable to a ${h.kind} transaction`);
    }
    const entryFields = [...SIMPLE_ONLY, ...TRANSFER_ONLY, 'amount_minor'] as const;
    const replace = entryFields.some((f) => f in b);
    const status = b.status ?? h.status;

    let drafts: EntryDraft[] | undefined;
    if (replace && !isTransfer) {
      const cur = simpleSpecOf(h, entries);
      drafts = await buildSimpleEntries(db, ws, {
        kind: cur.kind,
        accountId: b.account_id ?? cur.accountId,
        amountMinor: b.amount_minor ?? cur.amountMinor,
        categoryId: 'category_id' in b ? (b.category_id ?? null) : cur.categoryId,
      });
    } else if (replace) {
      const { from, to, spec: cur } = transferSpecOf(entries);
      const next: TransferSpec = {
        fromAccountId: b.from_account_id ?? cur.fromAccountId,
        toAccountId: b.to_account_id ?? cur.toAccountId,
        amountMinor: b.amount_minor ?? cur.amountMinor,
        feeMinor: 'fee_minor' in b ? (b.fee_minor ?? null) : cur.feeMinor,
        feeCategoryId:
          'fee_category_id' in b
            ? (b.fee_category_id ?? null)
            : b.fee_minor === null
              ? null
              : cur.feeCategoryId,
      };
      if ('to_amount_minor' in b) next.toAmountMinor = b.to_amount_minor ?? null;
      else if (next.fromAccountId === from.accountId && next.toAccountId === to.accountId) {
        // same account pair: a cross-currency transfer keeps its destination amount
        next.toAmountMinor = cur.toAmountMinor;
        if (from.currency === to.currency) next.toAmountMinor = null;
      }
      drafts = await buildTransferEntries(db, ws, next);
    }
    if (drafts) assertLedgerValid(h.kind, status, drafts);
    else if (b.status === 'posted' && h.status !== 'posted') {
      assertLedgerValid(
        h.kind,
        'posted',
        entries.map((x) => ({
          accountId: x.accountId,
          amountMinor: x.amountMinor,
          currency: x.currency,
          categoryId: x.categoryId,
        })),
      );
    }
    const tagIds = b.tag_ids ? await checkTags(db, ws, b.tag_ids) : undefined;

    await db.transaction(async (tx) => {
      await tx
        .update(t)
        .set({
          updatedAt: new Date(),
          ...(b.occurred_at ? { occurredAt: b.occurred_at } : {}),
          ...('payee' in b ? { payee: b.payee ?? null } : {}),
          ...('note' in b ? { note: b.note ?? null } : {}),
          ...(b.status ? { status: b.status } : {}),
        })
        .where(where(ws, id));
      if (drafts) {
        await tx.delete(e).where(eq(e.transactionId, id));
        await insertEntries(tx, ws, id, drafts);
      }
      if (tagIds) await setTags(tx, ws, id, tagIds);
    });
    return send(c, await getOne(c, id));
  });

  const setArchived = (archive: boolean) => async (c: import('hono').Context<AppEnv>) => {
    const { id } = idParam.parse(c.req.param());
    const rows = await c.var.db
      .update(t)
      .set({ archivedAt: archive ? sql`coalesce(${t.archivedAt}, now())` : null })
      .where(where(c.var.workspaceId, id))
      .returning({ id: t.id });
    if (!rows.length) throw notFound('Transaction');
    return send(c, await getOne(c, id));
  };
  r.post('/:id/archive', setArchived(true));
  r.post('/:id/unarchive', setArchived(false));

  r.delete('/:id', v('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const rows = await c.var.db
      .delete(t)
      .where(where(c.var.workspaceId, id))
      .returning({ id: t.id });
    if (!rows.length) throw notFound('Transaction');
    return send(c, { id });
  });

  return r;
}

/** POST /transfers: one transaction, two legs (+ optional fee line). Edit via PATCH /transactions/:id. */
export function transfersRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.post('/', v('json', transferSchema), async (c) => {
    const b = c.req.valid('json');
    const { db, workspaceId: ws } = c.var;
    const status = b.status ?? 'posted';
    const drafts = await buildTransferEntries(db, ws, {
      fromAccountId: b.from_account_id,
      toAccountId: b.to_account_id,
      amountMinor: b.amount_minor,
      toAmountMinor: b.to_amount_minor,
      feeMinor: b.fee_minor,
      feeCategoryId: b.fee_category_id,
    });
    assertLedgerValid('transfer', status, drafts);
    const tagIds = await checkTags(db, ws, b.tag_ids ?? []);
    const id = await db.transaction(async (tx) => {
      const [h] = await tx
        .insert(t)
        .values({
          workspaceId: ws,
          occurredAt: b.occurred_at,
          kind: 'transfer',
          note: b.note ?? null,
          status,
          source: b.source ?? 'manual',
        })
        .returning({ id: t.id });
      await insertEntries(tx, ws, h!.id, drafts);
      await setTags(tx, ws, h!.id, tagIds);
      return h!.id;
    });
    const [row] = await db
      .select()
      .from(t)
      .where(and(eq(t.id, id), eq(t.workspaceId, ws)));
    return send(c, (await hydrate(db, ws, [row!]))[0], 201);
  });
  return r;
}
