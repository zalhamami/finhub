import { runSeedCli } from '@finhub/db/seed-cli';
import { resolveMigrationsDir } from './migrations-dir';

/**
 * Seed CLI bundled next to the server (dist/seed.js):
 *   node dist/seed.js          base seed (currencies, demo workspace, settings, types, categories)
 *   node dist/seed.js --demo   + fake demo accounts / holdings / ~3 months of transactions
 * Applies migrations first (idempotent). Both are no-ops on already-seeded data.
 */
process.exit(
  await runSeedCli(process.argv.slice(2), process.env, {
    migrationsDir: resolveMigrationsDir(import.meta.url),
  }),
);
