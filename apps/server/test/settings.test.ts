import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestEnv, DATABASE_URL, type TestEnv } from './helpers';

describe.skipIf(!DATABASE_URL)('settings', () => {
  let env: TestEnv;
  let A: ReturnType<typeof client>;
  let B: ReturnType<typeof client>;
  beforeAll(async () => {
    env = await createTestEnv();
    A = client(env.app, env.demo);
    B = client(env.app, env.other);
  });
  afterAll(() => env?.close());

  it('GET returns the workspace settings with amber as default accent', async () => {
    const r = await A('GET', '/settings');
    expect(r.status).toBe(200);
    expect(r.data).toEqual({
      base_currency: 'IDR',
      locale: 'id',
      month_start_day: 1,
      timezone: 'Asia/Jakarta',
      accent: 'amber',
    });
  });

  it('PATCH accepts a preset or #rrggbb (normalized to lowercase) and persists it', async () => {
    expect((await A('PATCH', '/settings', { accent: 'jade' })).data.accent).toBe('jade');
    expect((await A('GET', '/settings')).data.accent).toBe('jade');
    const custom = await A('PATCH', '/settings', { accent: '#4C5BD4' });
    expect(custom.status).toBe(200);
    expect(custom.data.accent).toBe('#4c5bd4');
    expect((await A('PATCH', '/settings', { accent: 'amber' })).data.accent).toBe('amber');
  });

  it('PATCH rejects bad input with 400 validation_error', async () => {
    for (const body of [
      { accent: 'purple' },
      { accent: '#fff' },
      { accent: '#gggggg' },
      { accent: 'jade', base_currency: 'USD' },
      {},
    ]) {
      const r = await A('PATCH', '/settings', body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.error.code).toBe('validation_error');
    }
  });

  it('is scoped per workspace; a workspace without a row reads defaults and upserts on PATCH', async () => {
    await A('PATCH', '/settings', { accent: 'indigo' });
    const before = await B('GET', '/settings');
    expect(before.data.accent).toBe('amber');
    expect((await B('PATCH', '/settings', { accent: 'jade' })).data.accent).toBe('jade');
    expect((await A('GET', '/settings')).data.accent).toBe('indigo');
    expect((await B('GET', '/settings')).data.accent).toBe('jade');
  });
});
