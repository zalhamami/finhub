import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { createDb, schema, type DbHandle } from '@finhub/db';
import { runMigrations } from '@finhub/db/migrate';
import { seed } from '@finhub/db/seed';
import { createApp } from '../src/app';

export const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) console.warn('[finhub/server] DATABASE_URL is not set: skipping API tests');

export interface TestEnv {
  app: ReturnType<typeof createApp>;
  h: DbHandle;
  /** seeded demo workspace id (the default workspace) */
  demo: string;
  /** a second, empty workspace */
  other: string;
  close: () => Promise<void>;
}

/** Scratch database (migrated + seeded) with an app wired to it. */
export async function createTestEnv(): Promise<TestEnv> {
  const dbName = `finhub_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = postgres(DATABASE_URL!, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  const u = new URL(DATABASE_URL!);
  u.pathname = `/${dbName}`;
  const h = createDb(u.toString(), { max: 3 });
  await runMigrations(h.db);
  await seed(h.db);
  const workspaces = await h.db.select().from(schema.workspaces);
  const demo = workspaces.find((w) => w.slug === 'demo')!.id;
  const [o] = await h.db
    .insert(schema.workspaces)
    .values({ slug: 'other', name: 'Other' })
    .returning();
  return {
    app: createApp({ db: h.db, pingDb: async () => void (await h.sql`SELECT 1`) }),
    h,
    demo,
    other: o!.id,
    close: async () => {
      await h.close();
      await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end({ timeout: 5 });
    },
  };
}

export function client(app: TestEnv['app'], workspaceId?: string) {
  return async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api/v1${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(workspaceId ? { 'x-workspace-id': workspaceId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = (await res.json()) as any;
    return { status: res.status, json, data: json.data, error: json.error };
  };
}

export type Api = ReturnType<typeof client>;

/** Lookups against the seeded demo data (account types, categories) + small factories. */
export async function lookups(A: Api) {
  const types = (await A('GET', '/account-types')).data as { id: string; name: string }[];
  const cats = (await A('GET', '/categories?flat=true')).data as {
    id: string;
    name: string;
  }[];
  const type = (n: string) => types.find((t) => t.name === n)!.id;
  const cat = (n: string) => cats.find((c) => c.name === n)!.id;
  const account = async (name: string, typeName: string, extra: Record<string, unknown> = {}) =>
    (await A('POST', '/accounts', { name, type_id: type(typeName), ...extra })).data.id as string;
  return { type, cat, account };
}

export const iso = (d: string) => `${d}T05:00:00+07:00`;
