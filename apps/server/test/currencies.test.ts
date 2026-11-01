import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestEnv, DATABASE_URL, type TestEnv } from './helpers';

describe.skipIf(!DATABASE_URL)('currencies', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await createTestEnv();
  });
  afterAll(() => env?.close());

  it('GET lists the seeded currencies ordered by code, in snake_case', async () => {
    const r = await client(env.app, env.demo)('GET', '/currencies');
    expect(r.status).toBe(200);
    expect(r.data).toEqual([
      { code: 'IDR', minor_unit: 2, display_decimals: 0, symbol: 'Rp' },
      { code: 'SGD', minor_unit: 2, display_decimals: 2, symbol: 'S$' },
      { code: 'USD', minor_unit: 2, display_decimals: 2, symbol: '$' },
    ]);
  });

  it('is read-only', async () => {
    const r = await client(env.app, env.demo)('POST', '/currencies', { code: 'XXX' });
    expect(r.status).toBe(404);
  });
});
