import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@finhub/db';
import { client, createTestEnv, DATABASE_URL, type TestEnv } from './helpers';

interface Node {
  id: string;
  name: string;
  children: Node[];
}

describe.skipIf(!DATABASE_URL)('categories', () => {
  let env: TestEnv;
  let A: ReturnType<typeof client>;
  let B: ReturnType<typeof client>;

  beforeAll(async () => {
    env = await createTestEnv();
    A = client(env.app, env.demo);
    B = client(env.app, env.other);
  });
  afterAll(() => env?.close());

  const mk = async (name: string, extra: Record<string, unknown> = {}) => {
    const r = await A('POST', '/categories', { name, kind: 'expense', ...extra });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    return r.data.id as string;
  };

  it('GET returns the nested seeded tree with children arrays, sorted', async () => {
    const r = await A('GET', '/categories');
    expect(r.status).toBe(200);
    const tree = r.data as Node[];
    expect(tree.map((n) => n.name)).toEqual([
      'Makan & Minum',
      'Transportasi',
      'Belanja',
      'Tagihan',
      'Biaya admin',
      'Gaji',
      'Bonus/THR',
    ]);
    expect(tree[0]!.children.map((n) => n.name)).toEqual(['Kopi']);
    expect(tree[0]!.children[0]!.children).toEqual([]);
    expect(tree[1]!.children).toEqual([]);
  });

  it('?flat=true returns a flat list without children', async () => {
    const r = await A('GET', '/categories?flat=true');
    expect(r.data.length).toBe(8);
    expect(r.data.every((c: object) => !('children' in c))).toBe(true);
    expect((await B('GET', '/categories?flat=true')).data).toEqual([]);
    expect((await B('GET', '/categories')).data).toEqual([]);
  });

  it('builds deep trees honoring sort_order', async () => {
    const root = await mk('T-root', { sort_order: 500 });
    const c2 = await mk('T-b', { parent_id: root, sort_order: 2 });
    const c1 = await mk('T-a', { parent_id: root, sort_order: 1 });
    const g = await mk('T-grandchild', { parent_id: c1 });
    const tree = (await A('GET', '/categories')).data as Node[];
    const node = tree.find((n) => n.id === root)!;
    expect(node.children.map((n) => n.id)).toEqual([c1, c2]);
    expect(node.children[0]!.children.map((n) => n.id)).toEqual([g]);
  });

  it('validation 400s', async () => {
    for (const body of [
      {},
      { name: 'x' },
      { name: 'x', kind: 'transfer' },
      { name: '', kind: 'income' },
    ]) {
      expect((await A('POST', '/categories', body)).status).toBe(400);
    }
    const id = await mk('V-1');
    expect((await A('PATCH', `/categories/${id}`, { kind: 'income' })).status).toBe(400); // immutable
    expect((await A('PATCH', `/categories/${id}`, {})).status).toBe(400);
  });

  it('parent must be same kind', async () => {
    const inc = (await A('POST', '/categories', { name: 'K-inc', kind: 'income' })).data.id;
    const r = await A('POST', '/categories', { name: 'K-bad', kind: 'expense', parent_id: inc });
    expect(r.status).toBe(400);
    expect(r.error.code).toBe('category_kind_mismatch');
    const exp = await mk('K-exp');
    const p = await A('PATCH', `/categories/${exp}`, { parent_id: inc });
    expect(p.status).toBe(400);
    expect(p.error.code).toBe('category_kind_mismatch');
  });

  it('parent must be in the same workspace (create and patch)', async () => {
    const bCat = (await B('POST', '/categories', { name: 'B-cat', kind: 'expense' })).data.id;
    const r = await A('POST', '/categories', { name: 'steal', kind: 'expense', parent_id: bCat });
    expect(r.status).toBe(400);
    expect(r.error).toMatchObject({ code: 'invalid_reference', details: { field: 'parent_id' } });
    const own = await mk('W-own');
    expect((await A('PATCH', `/categories/${own}`, { parent_id: bCat })).status).toBe(400);
    expect((await B('GET', `/categories/${own}`)).status).toBe(404);
    expect((await B('PATCH', `/categories/${own}`, { name: 'x' })).status).toBe(404);
    expect((await B('DELETE', `/categories/${own}`)).status).toBe(404);
    expect((await B('POST', `/categories/${own}/archive`)).status).toBe(404);
    expect((await A('GET', `/categories/${own}`)).data.name).toBe('W-own');
  });

  it('prevents cycles on PATCH (self, child, deep descendant); allows valid re-parent and un-parent', async () => {
    const a = await mk('C-a');
    const b = await mk('C-b', { parent_id: a });
    const c = await mk('C-c', { parent_id: b });
    for (const [id, parent] of [
      [a, a],
      [a, b],
      [a, c],
      [b, c],
    ] as const) {
      const r = await A('PATCH', `/categories/${id}`, { parent_id: parent });
      expect(r.status).toBe(400);
      expect(r.error.code).toBe('category_cycle');
    }
    expect((await A('PATCH', `/categories/${c}`, { parent_id: a })).data.parent_id).toBe(a);
    expect((await A('PATCH', `/categories/${c}`, { parent_id: null })).data.parent_id).toBeNull();
    expect((await A('PATCH', `/categories/${a}`, { parent_id: c })).status).toBe(200);
  });

  it('archive cascades to descendants, hides from tree unless include_archived; unarchive rules', async () => {
    const p = await mk('AR-p');
    const ch = await mk('AR-c', { parent_id: p });
    const arch = await A('POST', `/categories/${p}/archive`);
    expect(arch.data.archived_at).toBeTruthy();
    const ids = (await A('GET', '/categories?flat=true')).data.map((x: { id: string }) => x.id);
    expect(ids).not.toContain(p);
    expect(ids).not.toContain(ch);
    const all = (await A('GET', '/categories?flat=true&include_archived=true')).data.map(
      (x: { id: string }) => x.id,
    );
    expect(all).toEqual(expect.arrayContaining([p, ch]));
    const blocked = await A('POST', `/categories/${ch}/unarchive`);
    expect(blocked.status).toBe(409);
    expect(blocked.error.code).toBe('parent_archived');
    expect(
      (await A('POST', '/categories', { name: 'x', kind: 'expense', parent_id: p })).status,
    ).toBe(409);
    expect((await A('POST', `/categories/${p}/unarchive`)).data.archived_at).toBeNull();
    expect((await A('POST', `/categories/${ch}/unarchive`)).data.archived_at).toBeNull();
    const tree = (await A('GET', '/categories')).data as Node[];
    expect(tree.find((n) => n.id === p)!.children.map((n) => n.id)).toEqual([ch]);
  });

  it('delete: 409 with children, 409 when referenced by entries, ok otherwise', async () => {
    const p = await mk('D-p');
    const ch = await mk('D-c', { parent_id: p });
    const r1 = await A('DELETE', `/categories/${p}`);
    expect(r1.status).toBe(409);
    expect(r1.error.code).toBe('category_has_children');

    const acctType = (await A('GET', '/account-types')).data[0].id;
    const acct = (await A('POST', '/accounts', { name: 'cat-acct', type_id: acctType })).data.id;
    await env.h.db.transaction(async (tx) => {
      const [t] = await tx
        .insert(schema.transactions)
        .values({ workspaceId: env.demo, kind: 'expense', occurredAt: new Date() })
        .returning();
      await tx.insert(schema.entries).values({
        workspaceId: env.demo,
        transactionId: t!.id,
        accountId: acct,
        categoryId: ch,
        amountMinor: -1n,
        currency: 'IDR',
      });
    });
    const r2 = await A('DELETE', `/categories/${ch}`);
    expect(r2.status).toBe(409);
    expect(r2.error.code).toBe('category_in_use');
    expect(r2.error.message).toContain('archive');

    const free = await mk('D-free');
    expect((await A('DELETE', `/categories/${free}`)).status).toBe(200);
    expect((await A('GET', `/categories/${free}`)).status).toBe(404);
    expect((await A('DELETE', `/categories/${free}`)).status).toBe(404);
  });
});
