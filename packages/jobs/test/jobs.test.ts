import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGBOSS_SCHEMA, createBoss, sendJob, startWorker, stopBoss } from '../src';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) console.warn('[finhub/jobs] DATABASE_URL is not set: skipping jobs tests');

describe.skipIf(!DATABASE_URL)('pg-boss worker', () => {
  const dbName = `finhub_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  let admin: postgres.Sql;
  let url: string;

  beforeAll(async () => {
    admin = postgres(DATABASE_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE ${dbName}`);
    const u = new URL(DATABASE_URL!);
    u.pathname = `/${dbName}`;
    url = u.toString();
  });
  afterAll(async () => {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end({ timeout: 5 });
  });

  it('starts in its own schema, and the worker handles system.ping', async () => {
    let onHandled!: (d: { sentAt?: string }) => void;
    const handled = new Promise<{ sentAt?: string }>((r) => (onHandled = r));
    const boss = createBoss(url);
    await startWorker(boss, { 'system.ping': (data) => onHandled(data) });
    await sendJob(boss, 'system.ping', { sentAt: 'test' });
    try {
      expect(await handled).toEqual({ sentAt: 'test' });
      const check = postgres(url, { max: 1, onnotice: () => {} });
      const [row] =
        await check`SELECT count(*)::int AS n FROM information_schema.schemata WHERE schema_name = ${PGBOSS_SCHEMA}`;
      await check.end({ timeout: 5 });
      expect(row!.n).toBe(1);
    } finally {
      await stopBoss(boss);
    }
  });
});
