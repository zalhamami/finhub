import { Hono } from 'hono';

export interface AppDeps {
  /** Resolves if the database is reachable. Omit when no DATABASE_URL is configured. */
  pingDb?: () => Promise<void>;
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

  const api = new Hono();
  api.all('*', (c) => c.json({ error: 'not_found' }, 404));
  app.route('/api/v1', api);

  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  return app;
}
