import { describe, expect, it } from 'vitest';
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
  it('/api/v1 returns JSON 404', async () => {
    const res = await createApp().request('/api/v1/anything');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});
