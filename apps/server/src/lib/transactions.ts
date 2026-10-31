import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { isFeeLine, validateTransaction, type EntryLine } from '@finhub/core';
import { schema, type Db } from '@finhub/db';
import { ApiError, conflict, fieldError, invalidReference } from './errors';

/** drizzle db or an open transaction handle */
export type Conn = Pick<Db, 'select' | 'insert' | 'update' | 'delete'>;

type HeaderRow = typeof schema.transactions.$inferSelect;
type EntryRow = typeof schema.entries.$inferSelect;
type Kind = HeaderRow['kind'];
type Status = HeaderRow['status'];

export interface EntryDraft {
  accountId: string;
  amountMinor: bigint;
  currency: string;
  categoryId: string | null;
}

export interface SimpleSpec {
  kind: 'expense' | 'income' | 'adjustment';
  accountId: string;
  /** magnitude (> 0) for expense/income; signed, non-zero for adjustment */
  amountMinor: bigint;
  categoryId: string | null;
}

export interface TransferSpec {
  fromAccountId: string;
  toAccountId: string;
  amountMinor: bigint;
  /** required iff the two accounts' currencies differ */
  toAmountMinor?: bigint | null;
  feeMinor?: bigint | null;
  feeCategoryId?: string | null;
}

/* ---------- reference checks (all workspace-scoped) ---------- */

async function loadAccounts(db: Conn, ws: string, refs: Record<string, string>) {
  const ids = [...new Set(Object.values(refs))];
  const rows = await db
    .select({
      id: schema.accounts.id,
      currency: schema.accounts.currency,
      archivedAt: schema.accounts.archivedAt,
    })
    .from(schema.accounts)
    .where(and(eq(schema.accounts.workspaceId, ws), inArray(schema.accounts.id, ids)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: Record<string, { id: string; currency: string }> = {};
  for (const [field, id] of Object.entries(refs)) {
    const a = byId.get(id);
    if (!a) throw invalidReference(field, 'account');
    if (a.archivedAt) throw conflict('account_archived', `${field}: account is archived`);
    out[field] = a;
  }
  return out;
}

async function loadCategory(
  db: Conn,
  ws: string,
  id: string,
  field: string,
  kind: 'expense' | 'income',
) {
  const [cat] = await db
    .select()
    .from(schema.categories)
    .where(and(eq(schema.categories.id, id), eq(schema.categories.workspaceId, ws)));
  if (!cat) throw invalidReference(field, 'category');
  if (cat.kind !== kind) {
    throw new ApiError(
      400,
      'category_kind_mismatch',
      `${field}: category is ${cat.kind}, expected ${kind}`,
      { field },
    );
  }
  if (cat.archivedAt) throw conflict('category_archived', `${field}: category is archived`);
}

/** Every tag id must belong to this workspace. */
export async function checkTags(db: Conn, ws: string, ids: readonly string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length) {
    const rows = await db
      .select({ id: schema.tags.id })
      .from(schema.tags)
      .where(and(eq(schema.tags.workspaceId, ws), inArray(schema.tags.id, unique)));
    if (rows.length !== unique.length) {
      const have = new Set(rows.map((r) => r.id));
      throw invalidReference('tag_ids', `tag ${unique.find((i) => !have.has(i))}`);
    }
  }
  return unique;
}

/* ---------- entry construction ---------- */

export async function buildSimpleEntries(
  db: Conn,
  ws: string,
  spec: SimpleSpec,
): Promise<EntryDraft[]> {
  const { kind, amountMinor } = spec;
  if (kind === 'adjustment') {
    if (amountMinor === 0n) throw fieldError('amount_minor', 'must not be 0');
    if (spec.categoryId) throw fieldError('category_id', 'not allowed on an adjustment');
  } else {
    if (amountMinor <= 0n) throw fieldError('amount_minor', 'must be > 0');
    if (!spec.categoryId) throw fieldError('category_id', `required for ${kind}`);
  }
  const { account_id } = await loadAccounts(db, ws, { account_id: spec.accountId });
  if (spec.categoryId && kind !== 'adjustment') {
    await loadCategory(db, ws, spec.categoryId, 'category_id', kind);
  }
  const signed = kind === 'expense' ? -amountMinor : amountMinor;
  return [
    {
      accountId: account_id!.id,
      amountMinor: signed,
      currency: account_id!.currency,
      categoryId: kind === 'adjustment' ? null : spec.categoryId,
    },
  ];
}

/**
 * Transfer = two legs (no category) netting to zero in one currency, or keeping both amounts
 * across currencies, plus an optional fee line (-fee on the source account, with an expense category).
 */
export async function buildTransferEntries(
  db: Conn,
  ws: string,
  spec: TransferSpec,
): Promise<EntryDraft[]> {
  if (spec.fromAccountId === spec.toAccountId) {
    throw fieldError('to_account_id', 'must differ from from_account_id');
  }
  if (spec.amountMinor <= 0n) throw fieldError('amount_minor', 'must be > 0');
  const fee = spec.feeMinor ?? null;
  const feeCat = spec.feeCategoryId ?? null;
  if (fee !== null && fee <= 0n) throw fieldError('fee_minor', 'must be > 0');
  if (fee !== null && !feeCat)
    throw fieldError('fee_category_id', 'required when fee_minor is set');
  if (fee === null && feeCat) throw fieldError('fee_minor', 'required when fee_category_id is set');

  const { from_account_id: from, to_account_id: to } = await loadAccounts(db, ws, {
    from_account_id: spec.fromAccountId,
    to_account_id: spec.toAccountId,
  });
  let toAmount = spec.amountMinor;
  if (from!.currency !== to!.currency) {
    if (spec.toAmountMinor == null) {
      throw fieldError(
        'to_amount_minor',
        `required: accounts use different currencies (${from!.currency} -> ${to!.currency})`,
      );
    }
    if (spec.toAmountMinor <= 0n) throw fieldError('to_amount_minor', 'must be > 0');
    toAmount = spec.toAmountMinor;
  } else if (spec.toAmountMinor != null && spec.toAmountMinor !== spec.amountMinor) {
    throw fieldError(
      'to_amount_minor',
      'must equal amount_minor when both accounts share a currency',
    );
  }
  if (feeCat) await loadCategory(db, ws, feeCat, 'fee_category_id', 'expense');

  const drafts: EntryDraft[] = [
    {
      accountId: from!.id,
      amountMinor: -spec.amountMinor,
      currency: from!.currency,
      categoryId: null,
    },
    { accountId: to!.id, amountMinor: toAmount, currency: to!.currency, categoryId: null },
  ];
  if (fee !== null) {
    drafts.push({
      accountId: from!.id,
      amountMinor: -fee,
      currency: from!.currency,
      categoryId: feeCat,
    });
  }
  return drafts;
}

/** Core validation (the DB constraint trigger is the backstop). */
export function assertLedgerValid(kind: Kind, status: Status, drafts: readonly EntryDraft[]) {
  const lines: EntryLine[] = drafts.map((d) => ({ ...d }));
  const issues = validateTransaction({ kind, status }, lines);
  if (issues.length) {
    throw new ApiError(400, 'ledger_invalid', issues[0]!.message, { issues });
  }
}

export async function insertEntries(
  db: Conn,
  ws: string,
  transactionId: string,
  drafts: readonly EntryDraft[],
) {
  await db
    .insert(schema.entries)
    .values(drafts.map((d) => ({ ...d, workspaceId: ws, transactionId })));
}

export async function setTags(db: Conn, ws: string, transactionId: string, tagIds: string[]) {
  await db
    .delete(schema.transactionTags)
    .where(eq(schema.transactionTags.transactionId, transactionId));
  if (tagIds.length) {
    await db
      .insert(schema.transactionTags)
      .values(tagIds.map((tagId) => ({ workspaceId: ws, transactionId, tagId })));
  }
}

/* ---------- derive an editable spec from stored entries ---------- */

export function simpleSpecOf(h: HeaderRow, entries: EntryRow[]): SimpleSpec {
  const e = entries[0];
  if (!e) throw conflict('transaction_has_no_entries', 'Transaction has no entries to edit');
  const kind = h.kind as SimpleSpec['kind'];
  return {
    kind,
    accountId: e.accountId,
    amountMinor:
      kind === 'adjustment' ? e.amountMinor : e.amountMinor < 0n ? -e.amountMinor : e.amountMinor,
    categoryId: e.categoryId,
  };
}

export function transferSpecOf(entries: EntryRow[]) {
  const legs = entries.filter((e) => !isFeeLine({ categoryId: e.categoryId }));
  const from = legs.find((e) => e.amountMinor < 0n) ?? legs[0];
  const to = legs.find((e) => e !== from);
  const fee = entries.find((e) => isFeeLine({ categoryId: e.categoryId }));
  if (!from || !to) throw conflict('transaction_has_no_entries', 'Transfer is missing its legs');
  return {
    from,
    to,
    spec: {
      fromAccountId: from.accountId,
      toAccountId: to.accountId,
      amountMinor: from.amountMinor < 0n ? -from.amountMinor : from.amountMinor,
      toAmountMinor: to.amountMinor,
      feeMinor: fee ? -fee.amountMinor : null,
      feeCategoryId: fee?.categoryId ?? null,
    } satisfies TransferSpec,
  };
}

/* ---------- serialization ---------- */

export function serializeEntry(e: EntryRow) {
  return {
    id: e.id,
    account_id: e.accountId,
    category_id: e.categoryId,
    amount_minor: e.amountMinor,
    currency: e.currency,
    fx_rate: e.fxRate,
  };
}

export function serializeTransaction(h: HeaderRow, entries: EntryRow[], tagIds: string[]) {
  return {
    id: h.id,
    occurred_at: h.occurredAt,
    kind: h.kind,
    payee: h.payee,
    note: h.note,
    status: h.status,
    source: h.source,
    archived_at: h.archivedAt,
    created_at: h.createdAt,
    updated_at: h.updatedAt,
    entries: entries.map((e) => ({
      ...serializeEntry(e),
      is_fee: h.kind === 'transfer' && isFeeLine({ categoryId: e.categoryId }),
    })),
    tag_ids: tagIds,
  };
}

/** Attach entries + tag ids to header rows (two queries total), preserving header order. */
export async function hydrate(db: Conn, ws: string, headers: HeaderRow[]) {
  if (!headers.length) return [];
  const ids = headers.map((h) => h.id);
  const [entryRows, tagRows] = await Promise.all([
    db
      .select()
      .from(schema.entries)
      .where(and(eq(schema.entries.workspaceId, ws), inArray(schema.entries.transactionId, ids)))
      // legs first (negative before positive), fee lines last
      .orderBy(
        sql`${schema.entries.categoryId} IS NOT NULL`,
        asc(schema.entries.amountMinor),
        asc(schema.entries.id),
      ),
    db
      .select({
        transactionId: schema.transactionTags.transactionId,
        tagId: schema.transactionTags.tagId,
      })
      .from(schema.transactionTags)
      .where(
        and(
          eq(schema.transactionTags.workspaceId, ws),
          inArray(schema.transactionTags.transactionId, ids),
        ),
      )
      .orderBy(asc(schema.transactionTags.tagId)),
  ]);
  const es = new Map<string, EntryRow[]>();
  for (const e of entryRows) es.set(e.transactionId, [...(es.get(e.transactionId) ?? []), e]);
  const ts = new Map<string, string[]>();
  for (const t of tagRows) ts.set(t.transactionId, [...(ts.get(t.transactionId) ?? []), t.tagId]);
  return headers.map((h) => serializeTransaction(h, es.get(h.id) ?? [], ts.get(h.id) ?? []));
}
