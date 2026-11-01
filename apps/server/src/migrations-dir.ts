import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrationsFolder } from '@finhub/db/migrate';

/**
 * MIGRATIONS_DIR > `./drizzle` beside the bundle (dist/drizzle) > the @finhub/db source folder (dev).
 * `bundleUrl` is the importing entry's import.meta.url (dist/index.js or dist/seed.js sit together).
 */
export function resolveMigrationsDir(bundleUrl: string): string {
  if (process.env.MIGRATIONS_DIR) return resolve(process.env.MIGRATIONS_DIR);
  const bundled = fileURLToPath(new URL('./drizzle', bundleUrl));
  return existsSync(bundled) ? bundled : migrationsFolder;
}
