import { describe, expect, it } from 'vitest';
import type { Db } from '@finhub/db';
import { createApp } from '../src/app';

describe('app', () => {
  it('GET /healthz without db', async () => {
    const res = await createApp().request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
  it('GET /health reports db ok / error', async () => {
    const ok = createApp({ pingDb: async () => {} });
    expect(await (await ok.request('/health')).json()).toEqual({ status: 'ok', db: 'ok' });
    const bad = createApp({ pingDb: async () => Promise.reject(new Error('down')) });
    expect(await (await bad.request('/healthz')).json()).toEqual({ status: 'ok', db: 'error' });
  });
  it('unknown /api/v1 route returns JSON 404 in the error shape (no db access)', async () => {
    const res = await createApp({ db: {} as Db }).request('/api/v1/anything');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('not_found');
    expect(body.error.message).toBeTruthy();
  });
  it('/api/v1 is 503 when no db is configured', async () => {
    const res = await createApp().request('/api/v1/accounts');
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'db_not_configured',
    );
  });
});
