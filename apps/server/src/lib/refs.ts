import { and, eq } from 'drizzle-orm';
import { schema, type Db } from '@finhub/db';
import { invalidReference } from './errors';

type OwnedTable =
  typeof schema.accountTypes | typeof schema.accountGroups | typeof schema.categories;

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
