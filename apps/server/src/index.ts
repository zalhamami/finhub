import { serve } from '@hono/node-server';
import { createDb } from '@finhub/db';
import { createApp } from './app';

const url = process.env.DATABASE_URL;
const handle = url ? createDb(url, { max: 5 }) : undefined;
const app = createApp({
  pingDb: handle ? async () => void (await handle.sql`SELECT 1`) : undefined,
});

const port = Number(process.env.PORT ?? 3000);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`finhub server listening on :${info.port}`);
});

const shutdown = () => {
  server.close();
  void handle?.close();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
