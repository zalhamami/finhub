import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createBot } from '@finhub/bot';
import { createDb } from '@finhub/db';
import { createBoss, startWorker, stopBoss } from '@finhub/jobs';
import { runMigrations } from '@finhub/db/migrate';
import { seedIfFresh } from '@finhub/db/seed';
import { seedDemo } from '@finhub/db/seed-demo';
import { resolveMigrationsDir } from './migrations-dir';
import { createApp } from './app';

/**
 * ROLE=all    HTTP + worker (default)
 * ROLE=web    HTTP only
 * ROLE=worker no HTTP; background worker only (pg-boss)
 */
const ROLES = ['all', 'web', 'worker'] as const;
type Role = (typeof ROLES)[number];
const role = (process.env.ROLE || 'all') as Role;
if (!ROLES.includes(role)) {
  console.error(`Invalid ROLE "${process.env.ROLE}"; expected one of: ${ROLES.join(', ')}`);
  process.exit(1);
}
const wantsHttp = role === 'all' || role === 'web';
const wantsWorker = role === 'all' || role === 'worker';

const migrationsDir = resolveMigrationsDir(import.meta.url);
const publicDir = process.env.PUBLIC_DIR
  ? resolve(process.env.PUBLIC_DIR)
  : fileURLToPath(new URL('./public', import.meta.url));

const url = process.env.DATABASE_URL;
const handle = url ? createDb(url, { max: 5 }) : undefined;
const closers: (() => Promise<void> | void)[] = [];
let stopping = false;

async function shutdown(signal: string, code = 0) {
  if (stopping) return;
  stopping = true;
  console.log(`finhub: ${signal} received, shutting down`);
  const force = setTimeout(() => {
    console.error('finhub: shutdown timed out, forcing exit');
    process.exit(1);
  }, 10_000);
  force.unref();
  for (const close of closers.reverse()) {
    try {
      await close();
    } catch (err) {
      console.error('finhub: error during shutdown', err);
    }
  }
  await handle?.close();
  process.exit(code);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  if (wantsHttp && handle) {
    await runMigrations(handle.db, migrationsDir);
    console.log('finhub: migrations applied');
    // DEMO_SEED=true: fake demo data, once (no-op when the demo workspace already has accounts).
    // Otherwise a brand-new database gets the BASE seed (currencies, `demo` workspace, settings,
    // account types, categories; no accounts) so the app works out of the box. Never reseeds later.
    if (process.env.DEMO_SEED === 'true' || process.env.DEMO_SEED === '1') {
      const r = await seedDemo(handle.db);
      console.log(
        r.created
          ? `finhub: demo data seeded (${r.accounts} accounts, ${r.transactions} transactions)`
          : 'finhub: DEMO_SEED set, demo workspace already has accounts: nothing to do',
      );
    } else if (await seedIfFresh(handle.db)) {
      console.log('finhub: fresh database, base data seeded');
    }
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const telegram =
    botToken && webhookSecret ? { bot: createBot(botToken), secret: webhookSecret } : undefined;
  if (wantsHttp) console.log(`finhub: telegram webhook ${telegram ? 'enabled' : 'disabled'}`);

  // Optional shared-password gate (HTTP Basic) for an internet-exposed demo; the value is never logged.
  const accessPassword = process.env.FINHUB_ACCESS_PASSWORD ?? '';
  const accessGate = accessPassword
    ? { user: process.env.FINHUB_ACCESS_USER || 'demo', password: accessPassword }
    : undefined;
  if (wantsHttp) console.log(`finhub: access gate ${accessGate ? 'ON' : 'off'}`);

  if (wantsHttp) {
    const app = createApp({
      db: handle?.db,
      pingDb: handle ? async () => void (await handle.sql`SELECT 1`) : undefined,
      defaultWorkspaceId: process.env.DEFAULT_WORKSPACE_ID || undefined,
      defaultWorkspaceSlug: process.env.DEFAULT_WORKSPACE_SLUG || undefined,
      publicDir,
      telegram,
      accessGate,
    });
    const port = Number(process.env.PORT ?? 3000);
    const server = serve({ fetch: app.fetch, port }, (info) => {
      console.log(`finhub server (ROLE=${role}) listening on :${info.port}`);
    });
    closers.push(
      () =>
        new Promise<void>((done) => {
          server.close(() => done());
          (server as { closeIdleConnections?: () => void }).closeIdleConnections?.();
        }),
    );
  }

  if (wantsWorker) {
    if (!url) throw new Error('DATABASE_URL is required for the worker (pg-boss)');
    const boss = createBoss(url);
    await startWorker(boss);
    console.log(`finhub worker (ROLE=${role}): pg-boss started (schema pgboss)`);
    closers.push(async () => {
      await stopBoss(boss);
      console.log('finhub worker stopped');
    });
    if (role === 'worker') setInterval(() => {}, 1 << 30); // keep the event loop alive without HTTP
  }
} catch (err) {
  console.error('finhub: startup failed', err);
  await shutdown('startup failure', 1);
}
