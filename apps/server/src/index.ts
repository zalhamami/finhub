import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createDb } from '@finhub/db';
import { migrationsFolder, runMigrations } from '@finhub/db/migrate';
import { createApp } from './app';

/**
 * ROLE=all    HTTP + worker (default)
 * ROLE=web    HTTP only
 * ROLE=worker no HTTP; background worker only (stub until pg-boss lands)
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

/** Next to the bundle (dist/drizzle) when bundled; the @finhub/db source folder in dev. */
const bundled = fileURLToPath(new URL('./drizzle', import.meta.url));
const migrationsDir = process.env.MIGRATIONS_DIR
  ? resolve(process.env.MIGRATIONS_DIR)
  : existsSync(bundled)
    ? bundled
    : migrationsFolder;
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
  }

  if (wantsHttp) {
    const app = createApp({
      db: handle?.db,
      pingDb: handle ? async () => void (await handle.sql`SELECT 1`) : undefined,
      defaultWorkspaceId: process.env.DEFAULT_WORKSPACE_ID || undefined,
      defaultWorkspaceSlug: process.env.DEFAULT_WORKSPACE_SLUG || undefined,
      publicDir,
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
    // TODO(session 4): replace with pg-boss jobs. For now just hold the role open until SIGTERM.
    console.log(`finhub worker (ROLE=${role}) started; waiting for SIGTERM`);
    closers.push(() => console.log('finhub worker stopped'));
    if (role === 'worker') setInterval(() => {}, 1 << 30); // keep the event loop alive without HTTP
  }
} catch (err) {
  console.error('finhub: startup failed', err);
  await shutdown('startup failure', 1);
}
