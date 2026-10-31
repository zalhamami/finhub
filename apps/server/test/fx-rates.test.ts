import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestEnv, DATABASE_URL, type TestEnv } from './helpers';

describe.skipIf(!DATABASE_URL)('fx-rates', () => {
  let env: TestEnv;
  let A: ReturnType<typeof client>;
  let B: ReturnType<typeof client>;
  beforeAll(async () => {
    env = await createTestEnv();
    A = client(env.app, env.demo);
    B = client(env.app, env.other);
  });
  afterAll(() => env?.close());

  const rate = { base: 'USD', quote: 'IDR', date: '2026-01-10', rate: '16000.5' };

  it('creates with source default manual; rate stays a decimal string', async () => {
    const r = await A('POST', '/fx-rates', rate);
    expect(r.status).toBe(201);
    expect(r.data).toMatchObject({
      base: 'USD',
      quote: 'IDR',
      date: '2026-01-10',
      source: 'manual',
    });
    expect(r.data.rate).toBe('16000.5000000000');
    expect((await A('GET', `/fx-rates/${r.data.id}`)).data.id).toBe(r.data.id);
  });

  it('unique (base, quote, date, source) -> 409; a different source is fine', async () => {
    const r = await A('POST', '/fx-rates', rate);
    expect(r.status).toBe(409);
    expect(r.error.code).toBe('unique_violation');
    expect((await A('POST', '/fx-rates', { ...rate, source: 'bi' })).status).toBe(201);
    expect((await B('POST', '/fx-rates', rate)).status).toBe(201);
  });

  it('rejects bad input', async () => {
    const bad: unknown[] = [
      { ...rate, rate: '0' },
      { ...rate, rate: '0.0' },
      { ...rate, rate: '-1' },
      { ...rate, rate: 16000 },
      { ...rate, rate: '1e3' },
      { ...rate, quote: 'USD' },
      { ...rate, date: '2026-13-01' },
      { ...rate, date: '2026-01-11', extra: 1 },
      { ...rate, base: 'usd', date: '2026-01-11' },
    ];
    for (const b of bad)
      expect((await A('POST', '/fx-rates', b)).status, JSON.stringify(b)).toBe(400);
    const unk = await A('POST', '/fx-rates', { ...rate, base: 'XXX', date: '2026-01-12' });
    expect(unk.status).toBe(400);
    expect(unk.error.code).toBe('invalid_reference');
  });

  it('list filters and ordering; patch; delete; isolation', async () => {
    await A('POST', '/fx-rates', { base: 'SGD', quote: 'IDR', date: '2026-02-01', rate: '12000' });
    await A('POST', '/fx-rates', { base: 'USD', quote: 'IDR', date: '2026-03-01', rate: '16100' });
    const all = (await A('GET', '/fx-rates')).data;
    expect(all.map((x: { date: string }) => x.date)).toEqual(
      [...all.map((x: { date: string }) => x.date)].sort().reverse(),
    );
    const usd = (await A('GET', '/fx-rates?base=USD')).data;
    expect(usd.every((x: { base: string }) => x.base === 'USD')).toBe(true);
    expect((await A('GET', '/fx-rates?base=SGD&quote=IDR')).data).toHaveLength(1);
    const ranged = (await A('GET', '/fx-rates?base=USD&from=2026-02-01&to=2026-03-01')).data;
    expect(ranged.map((x: { date: string }) => x.date)).toEqual(['2026-03-01']);
    expect((await A('GET', '/fx-rates?from=bad')).status).toBe(400);

    const id = ranged[0].id;
    expect((await A('PATCH', `/fx-rates/${id}`, { rate: '16200' })).data.rate).toBe(
      '16200.0000000000',
    );
    expect((await A('PATCH', `/fx-rates/${id}`, { rate: '0' })).status).toBe(400);
    expect((await A('PATCH', `/fx-rates/${id}`, { base: 'SGD' })).status).toBe(400);
    expect((await B('GET', `/fx-rates/${id}`)).status).toBe(404);
    expect((await B('DELETE', `/fx-rates/${id}`)).status).toBe(404);
    expect((await A('DELETE', `/fx-rates/${id}`)).data).toEqual({ id });
    expect((await A('GET', `/fx-rates/${id}`)).status).toBe(404);
  });
});
