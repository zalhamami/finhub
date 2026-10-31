import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestEnv, DATABASE_URL, type TestEnv } from './helpers';

describe.skipIf(!DATABASE_URL)('account-types & account-groups', () => {
  let env: TestEnv;
  let A: ReturnType<typeof client>; // default workspace (demo)
  let B: ReturnType<typeof client>;

  beforeAll(async () => {
    env = await createTestEnv();
    A = client(env.app);
    B = client(env.app, env.other);
  });
  afterAll(() => env?.close());

  it('lists seeded types for the default workspace only', async () => {
    const a = await A('GET', '/account-types');
    expect(a.status).toBe(200);
    expect(a.data.length).toBe(10);
    expect(a.data.every((t: { workspace_id: string }) => t.workspace_id === env.demo)).toBe(true);
    expect((await B('GET', '/account-types')).data).toEqual([]);
  });

  it('CRUD happy path', async () => {
    const c = await A('POST', '/account-types', { name: 'Deposito', kind: 'bank' });
    expect(c.status).toBe(201);
    expect(c.data).toMatchObject({ name: 'Deposito', kind: 'bank', has_holdings: false });
    const id = c.data.id;
    expect((await A('GET', `/account-types/${id}`)).data.name).toBe('Deposito');
    const p = await A('PATCH', `/account-types/${id}`, { name: 'Deposito Berjangka', icon: 'x' });
    expect(p.data).toMatchObject({ name: 'Deposito Berjangka', icon: 'x' });
    expect((await A('PATCH', `/account-types/${id}`, { kind: 'cash' })).status).toBe(200); // unused
    expect((await A('DELETE', `/account-types/${id}`)).status).toBe(200);
    expect((await A('GET', `/account-types/${id}`)).status).toBe(404);
  });

  it('validates input (400) and rejects unknown fields', async () => {
    for (const body of [
      {},
      { name: '', kind: 'bank' },
      { name: 'x', kind: 'spaceship' },
      { name: 'x', kind: 'bank', workspace_id: env.other },
    ]) {
      const r = await A('POST', '/account-types', body);
      expect(r.status).toBe(400);
      expect(r.error.code).toBe('validation_error');
      expect(r.error.details.issues.length).toBeGreaterThan(0);
    }
    expect((await A('GET', '/account-types/not-a-uuid')).status).toBe(400);
    expect((await A('PATCH', `/account-types/${env.other}`, {})).status).toBe(400);
  });

  it('409 on duplicate name; same name allowed in another workspace', async () => {
    const dup = await A('POST', '/account-types', { name: 'Bank', kind: 'bank' });
    expect(dup.status).toBe(409);
    expect(dup.error.code).toBe('unique_violation');
    expect((await B('POST', '/account-types', { name: 'Bank', kind: 'bank' })).status).toBe(201);
  });

  it('kind immutable and delete 409 while accounts reference the type', async () => {
    const t = (await A('POST', '/account-types', { name: 'InUse', kind: 'bank' })).data;
    const acc = await A('POST', '/accounts', { name: 'x', type_id: t.id });
    expect(acc.status).toBe(201);
    const p = await A('PATCH', `/account-types/${t.id}`, { kind: 'cash' });
    expect(p.status).toBe(409);
    expect(p.error.code).toBe('account_type_in_use');
    expect(
      (await A('PATCH', `/account-types/${t.id}`, { kind: 'bank', name: 'InUse2' })).status,
    ).toBe(200);
    const d = await A('DELETE', `/account-types/${t.id}`);
    expect(d.status).toBe(409);
    expect(d.error.code).toBe('account_type_in_use');
  });

  it('workspace isolation: B cannot read, patch or delete A rows', async () => {
    const t = (await A('POST', '/account-types', { name: 'Private', kind: 'cash' })).data;
    expect((await B('GET', `/account-types/${t.id}`)).status).toBe(404);
    expect((await B('PATCH', `/account-types/${t.id}`, { name: 'hax' })).status).toBe(404);
    expect((await B('DELETE', `/account-types/${t.id}`)).status).toBe(404);
    expect((await A('GET', `/account-types/${t.id}`)).data.name).toBe('Private');
  });

  it('groups: CRUD, ordering, isolation, delete ungroups accounts', async () => {
    const g2 = (await A('POST', '/account-groups', { name: 'Zeta', sort_order: 2 })).data;
    const g1 = (await A('POST', '/account-groups', { name: 'Alpha', sort_order: 1 })).data;
    expect((await A('GET', '/account-groups')).data.map((g: { name: string }) => g.name)).toEqual([
      'Alpha',
      'Zeta',
    ]);
    expect((await A('POST', '/account-groups', { name: 'Alpha' })).status).toBe(409);
    expect((await A('PATCH', `/account-groups/${g1.id}`, { name: 'Alpha2' })).data.name).toBe(
      'Alpha2',
    );
    expect((await B('GET', `/account-groups/${g1.id}`)).status).toBe(404);
    expect((await B('DELETE', `/account-groups/${g1.id}`)).status).toBe(404);
    expect((await A('POST', '/account-groups', {})).status).toBe(400);

    const type = (await A('GET', '/account-types')).data[0];
    const acc = (await A('POST', '/accounts', { name: 'g', type_id: type.id, group_id: g2.id }))
      .data;
    expect((await A('DELETE', `/account-groups/${g2.id}`)).status).toBe(200);
    expect((await A('GET', `/accounts/${acc.id}`)).data.group_id).toBeNull();
    expect((await A('DELETE', `/account-groups/${g2.id}`)).status).toBe(404);
  });
});
