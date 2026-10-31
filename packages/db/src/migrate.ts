import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Db } from './client';

/** Default migrations folder (works from source; bundles pass their own copy). */
export const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

export async function runMigrations(db: Db, folder: string = migrationsFolder): Promise<void> {
  await migrate(db, { migrationsFolder: folder });
}
