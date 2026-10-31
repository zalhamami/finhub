import { Hono } from 'hono';
import type { Db } from '@finhub/db';
import { ApiError, onError, onNotFound } from './lib/errors';
import { hasPublicDir, staticMiddleware } from './lib/static';
import type { AppEnv } from './lib/http';
import { workspaceMiddleware, type WorkspaceOptions } from './lib/workspace';
import { accountGroupsRoutes } from './routes/account-groups';
import { accountTypesRoutes } from './routes/account-types';
import { accountsRoutes } from './routes/accounts';
import { categoriesRoutes } from './routes/categories';
import { fxRatesRoutes } from './routes/fx-rates';
import { reportsRoutes } from './routes/reports';
import { telegramRoutes, type TelegramDeps } from './routes/telegram';
import { tagsRoutes } from './routes/tags';
import { transactionsRoutes, transfersRoutes } from './routes/transactions';

export interface AppDeps extends WorkspaceOptions {
  /** Drizzle client from @finhub/db's createDb(); tests pass a scratch-database client. */
  db?: Db;
  /** Directory of the built web app, served with SPA fallback. Skipped quietly if it does not exist. */
  publicDir?: string;
  /** Resolves if the database is reachable. Omit when no DATABASE_URL is configured. */
  pingDb?: () => Promise<void>;
  /** Telegram webhook (POST /telegram/webhook/:secret). Mounted only when provided. */
  telegram?: TelegramDeps;
}

export function createApp(deps: AppDeps = {}): Hono {
  const app = new Hono();

  const health = async (c: import('hono').Context) => {
    if (!deps.pingDb) return c.json({ status: 'ok' });
    try {
      await deps.pingDb();
      return c.json({ status: 'ok', db: 'ok' });
    } catch {
      return c.json({ status: 'ok', db: 'error' });
    }
  };
  app.get('/healthz', health);
  app.get('/health', health);

  const api = new Hono<AppEnv>();
  const { db } = deps;
  if (db) {
    // Per-resource so unknown paths 404 without touching the database.
    const mount = (path: string, routes: Hono<AppEnv>) => {
      api.use(`${path}/*`, workspaceMiddleware(db, deps));
      api.use(path, workspaceMiddleware(db, deps));
      api.route(path, routes);
    };
    mount('/account-types', accountTypesRoutes());
    mount('/account-groups', accountGroupsRoutes());
    mount('/accounts', accountsRoutes());
    mount('/categories', categoriesRoutes());
    mount('/tags', tagsRoutes());
    mount('/transactions', transactionsRoutes());
    mount('/transfers', transfersRoutes());
    mount('/fx-rates', fxRatesRoutes());
    mount('/reports', reportsRoutes());
  } else {
    api.all('*', () => {
      throw new ApiError(503, 'db_not_configured', 'DATABASE_URL is not configured');
    });
  }
  app.route('/api/v1', api);
  if (deps.telegram) app.route('/telegram', telegramRoutes(deps.telegram));
  if (deps.publicDir && hasPublicDir(deps.publicDir))
    app.use('*', staticMiddleware(deps.publicDir));

  app.onError(onError);
  app.notFound(onNotFound);
  return app;
}
