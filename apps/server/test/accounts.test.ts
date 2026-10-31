import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@finhub/db';
import { client, createTestEnv, DATABASE_URL, type TestEnv } from './helpers';

describe.skipIf(!DATABASE_URL)('accounts', () => {
  let env: TestEnv;
  let A: ReturnType<typeof client>;
  let B: ReturnType<typeof client>;
  let bankType: string;
  let typeB: string;
  let groupB: string;

  beforeAll(async () => {
    env = await createTestEnv();
    A = client(env.app, env.demo);
    B = client(env.app, env.other);
    bankType = (await A('GET', '/account-types')).data.find(
      (t: { name: string }) => t.name === 'Bank',
    ).id;
    typeB = (await B('POST', '/account-types', { name: 'B-bank', kind: 'bank' })).data.id;
    groupB = (await B('POST', '/account-groups', { name: 'B-group' })).data.id;
  });
  afterAll(() => env?.close());

  it('creates with defaults; *_minor serialized as strings', async () => {
    const r = await A('POST', '/accounts', { name: 'BCA', type_id: bankType });
    expect(r.status).toBe(201);
    expect(r.data).toMatchObject({
      name: 'BCA',
      currency: 'IDR',
      opening_balance_minor: '0',
      include_in_net_worth: true,
      archived_at: null,
      credit_limit_minor: null,
    });
    expect(typeof r.data.opening_balance_minor).toBe('string');
  });

  it('accepts string or integer *_minor, exact beyond 2^53', async () => {
    const big = '9007199254740993123';
    const a = await A('POST', '/accounts', {
      name: 'Big',
      type_id: bankType,
      opening_balance_minor: big,
    });
    expect(a.status).toBe(201);
    expect(a.data.opening_balance_minor).toBe(big);
    expect((await A('GET', `/accounts/${a.data.id}`)).data.opening_balance_minor).toBe(big);
    const n = await A('POST', '/accounts', {
      name: 'Int',
      type_id: bankType,
      opening_balance_minor: -5000000,
      credit_limit_minor: '100',
    });
    expect(n.data.opening_balance_minor).toBe('-5000000');
    expect(n.data.credit_limit_minor).toBe('100');
  });

  it('validation 400s', async () => {
    const bad: unknown[] = [
      { name: 'x' }, // no type
      { name: 'x', type_id: bankType, opening_balance_minor: '12.5' },
      { name: 'x', type_id: bankType, opening_balance_minor: 1.5 },
      { name: 'x', type_id: bankType, opening_balance_minor: '9223372036854775808' }, // > int64
      { name: 'x', type_id: bankType, credit_limit_minor: '-1' },
      { name: 'x', type_id: bankType, statement_day: 32 },
      { name: 'x', type_id: bankType, opening_date: '2026-13-40' },
      { name: 'x', type_id: bankType, currency: 'idr' },
      { name: 'x', type_id: 'nope' },
      { name: 'x', type_id: bankType, kind: 'cash' },
    ];
    for (const body of bad) {
      const r = await A('POST', '/accounts', body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.error.code).toBe('validation_error');
    }
  });

  it('currency must exist', async () => {
    const r = await A('POST', '/accounts', { name: 'Yen', type_id: bankType, currency: 'XYZ' });
    expect(r.status).toBe(400);
    expect(r.error.code).toBe('invalid_reference');
    expect(
      (await A('POST', '/accounts', { name: 'Dollar', type_id: bankType, currency: 'USD' })).status,
    ).toBe(201);
  });

  it('workspace isolation on references (type_id, group_id)', async () => {
    const r1 = await A('POST', '/accounts', { name: 'steal', type_id: typeB });
    expect(r1.status).toBe(400);
    expect(r1.error).toMatchObject({ code: 'invalid_reference', details: { field: 'type_id' } });
    const r2 = await A('POST', '/accounts', { name: 'steal', type_id: bankType, group_id: groupB });
    expect(r2.error.details.field).toBe('group_id');
    const own = (await A('POST', '/accounts', { name: 'mine', type_id: bankType })).data;
    expect((await A('PATCH', `/accounts/${own.id}`, { type_id: typeB })).status).toBe(400);
    expect((await A('PATCH', `/accounts/${own.id}`, { group_id: groupB })).status).toBe(400);
    expect((await A('GET', `/accounts/${own.id}`)).data.type_id).toBe(bankType);
  });

  it('workspace isolation on read/write', async () => {
    const own = (await A('POST', '/accounts', { name: 'iso', type_id: bankType })).data;
    expect((await B('GET', `/accounts/${own.id}`)).status).toBe(404);
    expect((await B('PATCH', `/accounts/${own.id}`, { name: 'x' })).status).toBe(404);
    expect((await B('POST', `/accounts/${own.id}/archive`)).status).toBe(404);
    expect((await B('DELETE', `/accounts/${own.id}`)).status).toBe(404);
    expect((await B('GET', '/accounts')).data).toEqual([]);
    const re = await B('PATCH', '/accounts/reorder', [{ id: own.id, sort_order: 9 }]);
    expect(re.status).toBe(400);
    expect((await A('GET', `/accounts/${own.id}`)).data.sort_order).toBe(0);
  });

  it('unknown workspace header -> 404, malformed -> 400', async () => {
    const r = await client(env.app, '00000000-0000-4000-8000-000000000000')('GET', '/accounts');
    expect(r.status).toBe(404);
    expect(r.error.code).toBe('workspace_not_found');
    expect((await client(env.app, 'garbage')('GET', '/accounts')).status).toBe(400);
  });

  it('patch updates fields; empty patch is 400', async () => {
    const a = (await A('POST', '/accounts', { name: 'P', type_id: bankType })).data;
    const p = await A('PATCH', `/accounts/${a.id}`, {
      name: 'P2',
      include_in_net_worth: false,
      credit_limit_minor: 5000,
      group_id: null,
    });
    expect(p.data).toMatchObject({
      name: 'P2',
      include_in_net_worth: false,
      credit_limit_minor: '5000',
    });
    expect((await A('PATCH', `/accounts/${a.id}`, {})).status).toBe(400);
  });

  it('archive hides from list unless include_archived=true; unarchive restores; idempotent', async () => {
    const a = (await A('POST', '/accounts', { name: 'Arch', type_id: bankType })).data;
    const first = await A('POST', `/accounts/${a.id}/archive`);
    expect(first.data.archived_at).toBeTruthy();
    const second = await A('POST', `/accounts/${a.id}/archive`);
    expect(second.data.archived_at).toBe(first.data.archived_at);
    const ids = (r: { data: { id: string }[] }) => r.data.map((x) => x.id);
    expect(ids(await A('GET', '/accounts'))).not.toContain(a.id);
    expect(ids(await A('GET', '/accounts?include_archived=true'))).toContain(a.id);
    expect(ids(await A('GET', '/accounts?include_archived=false'))).not.toContain(a.id);
    expect((await A('GET', `/accounts/${a.id}`)).status).toBe(200);
    expect((await A('GET', '/accounts?include_archived=maybe')).status).toBe(400);
    const un = await A('POST', `/accounts/${a.id}/unarchive`);
    expect(un.data.archived_at).toBeNull();
    expect(ids(await A('GET', '/accounts'))).toContain(a.id);
  });

  it('reorder updates sort_order and list order', async () => {
    const mk = async (name: string) =>
      (await A('POST', '/accounts', { name, type_id: bankType, sort_order: 100 })).data.id;
    const [x, y, z] = [await mk('RX'), await mk('RY'), await mk('RZ')];
    const r = await A('PATCH', '/accounts/reorder', [
      { id: z, sort_order: -3 },
      { id: x, sort_order: -2 },
      { id: y, sort_order: -1 },
    ]);
    expect(r.status).toBe(200);
    expect(r.data.map((a: { id: string }) => a.id)).toEqual([z, x, y]);
    const list = (await A('GET', '/accounts')).data.map((a: { id: string }) => a.id);
    expect(list.slice(0, 3)).toEqual([z, x, y]);
  });

  it('reorder validation: empty, duplicates, unknown ids, bad shape', async () => {
    const a = (await A('POST', '/accounts', { name: 'RV', type_id: bankType })).data.id;
    expect((await A('PATCH', '/accounts/reorder', [])).status).toBe(400);
    expect(
      (
        await A('PATCH', '/accounts/reorder', [
          { id: a, sort_order: 1 },
          { id: a, sort_order: 2 },
        ])
      ).status,
    ).toBe(400);
    expect((await A('PATCH', '/accounts/reorder', [{ id: a, sort_order: 'x' }])).status).toBe(400);
    expect((await A('PATCH', '/accounts/reorder', { id: a, sort_order: 1 })).status).toBe(400);
    const missing = await A('PATCH', '/accounts/reorder', [
      { id: '00000000-0000-4000-8000-000000000000', sort_order: 1 },
    ]);
    expect(missing.status).toBe(400);
    expect(missing.error.code).toBe('invalid_reference');
  });

  it('delete: ok without entries; 409 suggesting archive with entries; currency locked', async () => {
    const a = (await A('POST', '/accounts', { name: 'Del', type_id: bankType })).data;
    const used = (
      await A('POST', '/accounts', { name: 'Used', type_id: bankType, currency: 'USD' })
    ).data;
    await env.h.db.transaction(async (tx) => {
      const [t] = await tx
        .insert(schema.transactions)
        .values({ workspaceId: env.demo, kind: 'expense', occurredAt: new Date() })
        .returning();
      await tx.insert(schema.entries).values({
        workspaceId: env.demo,
        transactionId: t!.id,
        accountId: used.id,
        amountMinor: -100n,
        currency: 'USD',
      });
    });
    const d = await A('DELETE', `/accounts/${used.id}`);
    expect(d.status).toBe(409);
    expect(d.error.code).toBe('account_has_entries');
    expect(d.error.message).toContain('archive');
    expect((await A('PATCH', `/accounts/${used.id}`, { currency: 'IDR' })).status).toBe(409);
    expect(
      (await A('PATCH', `/accounts/${used.id}`, { currency: 'USD', name: 'Used2' })).status,
    ).toBe(200);
    expect((await A('POST', `/accounts/${used.id}/archive`)).status).toBe(200);

    expect((await A('DELETE', `/accounts/${a.id}`)).status).toBe(200);
    expect((await A('GET', `/accounts/${a.id}`)).status).toBe(404);
    expect((await A('DELETE', `/accounts/${a.id}`)).status).toBe(404);
  });

  it('malformed JSON body -> 400 in error shape', async () => {
    const res = await env.app.request('/api/v1/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workspace-id': env.demo },
      body: '{nope',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBeTruthy();
  });
});
