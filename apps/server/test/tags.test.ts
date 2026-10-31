import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestEnv, DATABASE_URL, type TestEnv } from './helpers';

describe.skipIf(!DATABASE_URL)('tags', () => {
  let env: TestEnv;
  let A: ReturnType<typeof client>;
  let B: ReturnType<typeof client>;
  beforeAll(async () => {
    env = await createTestEnv();
    A = client(env.app, env.demo);
    B = client(env.app, env.other);
  });
  afterAll(() => env?.close());

  it('CRUD', async () => {
    const c = await A('POST', '/tags', { name: '  trip  ' });
    expect(c.status).toBe(201);
    expect(c.data.name).toBe('trip');
    const id = c.data.id;
    expect((await A('GET', '/tags')).data.map((t: { name: string }) => t.name)).toEqual(['trip']);
    expect((await A('GET', `/tags/${id}`)).data.id).toBe(id);
    expect((await A('PATCH', `/tags/${id}`, { name: 'holiday' })).data.name).toBe('holiday');
    expect((await A('DELETE', `/tags/${id}`)).data).toEqual({ id });
    expect((await A('GET', `/tags/${id}`)).status).toBe(404);
    expect((await A('DELETE', `/tags/${id}`)).status).toBe(404);
  });

  it('unique name per workspace -> 409; other workspace may reuse it', async () => {
    await A('POST', '/tags', { name: 'dup' });
    const r = await A('POST', '/tags', { name: 'dup' });
    expect(r.status).toBe(409);
    expect(r.error.code).toBe('unique_violation');
    expect((await B('POST', '/tags', { name: 'dup' })).status).toBe(201);
    const other = await A('POST', '/tags', { name: 'other' });
    expect((await A('PATCH', `/tags/${other.data.id}`, { name: 'dup' })).status).toBe(409);
  });

  it('strict body, validation, workspace isolation', async () => {
    expect((await A('POST', '/tags', { name: 'x', extra: 1 })).status).toBe(400);
    expect((await A('POST', '/tags', { name: '   ' })).error.code).toBe('validation_error');
    expect((await A('PATCH', '/tags/not-a-uuid', { name: 'y' })).status).toBe(400);
    const t = await B('POST', '/tags', { name: 'b-only' });
    expect((await A('GET', `/tags/${t.data.id}`)).status).toBe(404);
    expect((await A('PATCH', `/tags/${t.data.id}`, { name: 'z' })).status).toBe(404);
    expect((await A('DELETE', `/tags/${t.data.id}`)).status).toBe(404);
  });
});
