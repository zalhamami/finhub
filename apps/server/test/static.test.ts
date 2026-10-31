import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';

describe('static web serving', () => {
  let dir: string;
  let app: ReturnType<typeof createApp>;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'finhub-public-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<html>spa</html>');
    writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)');
    writeFileSync(join(dir, '..secret'), 'x');
    app = createApp({ publicDir: dir });
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('serves files with types and cache headers', async () => {
    const r = await app.request('/assets/app.js');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/javascript');
    expect(r.headers.get('cache-control')).toContain('immutable');
    expect(await r.text()).toBe('console.log(1)');
  });

  it('falls back to index.html for SPA routes (no-cache)', async () => {
    for (const p of ['/', '/transactions', '/accounts/123']) {
      const r = await app.request(p);
      expect(r.status, p).toBe(200);
      expect(await r.text()).toBe('<html>spa</html>');
      expect(r.headers.get('cache-control')).toBe('no-cache');
    }
  });

  it('never shadows /api, /healthz or /health, and missing assets 404', async () => {
    const api = await app.request('/api/v1/nope');
    expect(api.status).toBe(503); // no db configured in this app
    expect(((await api.json()) as { error: { code: string } }).error.code).toBe(
      'db_not_configured',
    );
    expect((await app.request('/healthz')).headers.get('content-type')).toContain(
      'application/json',
    );
    expect((await app.request('/health')).status).toBe(200);
    expect((await app.request('/assets/missing.js')).status).toBe(404);
    expect((await app.request('/', { method: 'POST' })).status).toBe(404);
  });

  it('blocks path traversal', async () => {
    for (const p of ['/..%2f..%2fetc%2fpasswd', '/%2e%2e/%2e%2e/etc/passwd', '/a%00b']) {
      const r = await app.request(p);
      expect(await r.text(), p).not.toContain('root:');
    }
  });

  it('is skipped quietly when the directory is missing', async () => {
    const none = createApp({ publicDir: join(dir, 'does-not-exist') });
    expect((await none.request('/')).status).toBe(404);
    expect((await none.request('/healthz')).status).toBe(200);
  });
});
