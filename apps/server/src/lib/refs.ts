import { and, eq, inArray } from 'drizzle-orm';
import { schema, type Db } from '@finhub/db';
import { invalidReference } from './errors';

type OwnedTable =
  | typeof schema.accountTypes
  | typeof schema.accountGroups
  | typeof schema.categories
  | typeof schema.accounts
  | typeof schema.tags;

/**
 * Cross-workspace FK guard: a referenced id must exist AND belong to this workspace.
 * (The DB FKs only guarantee existence, so every body-supplied id goes through here.)
 */
export async function assertOwned(
  db: Db,
  workspaceId: string,
  table: OwnedTable,
  id: string,
  field: string,
  what: string,
): Promise<void> {
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, id), eq(table.workspaceId, workspaceId)));
  if (!row) throw invalidReference(field, what);
}

/** Every id must exist in this workspace (single query); throws invalid_reference naming the first miss. */
export async function assertAllOwned(
  db: Db,
  workspaceId: string,
  table: OwnedTable,
  ids: readonly string[],
  field: string,
  what: string,
): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.workspaceId, workspaceId), inArray(table.id, unique)));
  if (rows.length !== unique.length) {
    const have = new Set(rows.map((r) => r.id));
    throw invalidReference(field, `${what} ${unique.find((i) => !have.has(i))}`);
  }
}
