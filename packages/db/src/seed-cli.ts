import { createDb } from './client';
import { runMigrations } from './migrate';
import { seed } from './seed';
import { seedDemo } from './seed-demo';

/**
 * Seed CLI shared by `pnpm db:seed[:demo]` (tsx, bin-seed.ts) and the server bundle (`node dist/seed.js
 * --demo`). Base seed always; `--demo` additionally adds the demo accounts/transactions (only when the
 * demo workspace has no accounts yet). Returns the process exit code. Never runs on import.
 */
export async function runSeedCli(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  opts: { migrationsDir?: string } = {},
): Promise<number> {
  const url = env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    return 1;
  }
  const demo = argv.includes('--demo');
  const h = createDb(url, { max: 1 });
  try {
    if (opts.migrationsDir) await runMigrations(h.db, opts.migrationsDir);
    if (demo) {
      const r = await seedDemo(h.db);
      console.log(
        r.created
          ? `demo seed complete: ${r.accounts} accounts, ${r.transactions} transactions`
          : 'demo seed skipped: the demo workspace already has accounts',
      );
    } else {
      await seed(h.db);
      console.log('seed complete');
    }
    return 0;
  } catch (err) {
    console.error('seed failed', err);
    return 1;
  } finally {
    await h.close();
  }
}
