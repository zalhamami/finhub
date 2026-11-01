import { describe, expect, it } from 'vitest';
import { createBot } from '@finhub/bot';
import { createApp } from '../src/app';

const basic = (u: string, p: string) => ({
  authorization: `Basic ${Buffer.from(`${u}:${p}`, 'utf8').toString('base64')}`,
});

describe('access gate', () => {
  it('is off by default (no gate configured, or empty password)', async () => {
    expect((await createApp().request('/healthz')).status).toBe(200);
    expect((await createApp().request('/api/v1/accounts')).status).toBe(503); // reaches the api
    const empty = createApp({ accessGate: { user: 'demo', password: '' } });
    expect((await empty.request('/api/v1/accounts')).status).toBe(503);
  });

  const app = () => createApp({ accessGate: { user: 'demo', password: 's3cret-pässword' } });

  it('401 without credentials, with the Basic challenge', async () => {
    for (const path of ['/', '/api/v1/accounts', '/assets/x.js', '/health', '/nope']) {
      const res = await app().request(path);
      expect(res.status, path).toBe(401);
      expect(res.headers.get('www-authenticate')).toBe('Basic realm="Finhub", charset="UTF-8"');
    }
  });

  it('401 with wrong user, wrong password, wrong scheme or garbage', async () => {
    const a = app();
    const bad = [
      basic('demo', 'wrong'),
      basic('other', 's3cret-pässword'),
      basic('demo', 's3cret-pässwor'),
      { authorization: 'Bearer s3cret-pässword' },
      { authorization: 'Basic !!!notbase64' },
      { authorization: `Basic ${Buffer.from('nocolon').toString('base64')}` },
    ];
    for (const headers of bad) {
      expect((await a.request('/api/v1/accounts', { headers })).status).toBe(401);
    }
  });

  it('passes with the right credentials (utf-8 password, colon in password ok)', async () => {
    const res = await app().request('/api/v1/accounts', {
      headers: basic('demo', 's3cret-pässword'),
    });
    expect(res.status).toBe(503); // past the gate; no db in this test
    const colon = createApp({ accessGate: { user: 'u', password: 'a:b:c' } });
    expect((await colon.request('/healthz', { headers: basic('u', 'a:b:c') })).status).toBe(200);
    expect((await colon.request('/api/v1/x', { headers: basic('u', 'a:b:c') })).status).not.toBe(
      401,
    );
  });

  it('/healthz is exempt; /telegram webhook is exempt (own secret)', async () => {
    const a = app();
    expect((await a.request('/healthz')).status).toBe(200);
    const tg = createApp({
      accessGate: { user: 'demo', password: 'pw' },
      telegram: {
        bot: createBot('123:fake', {
          allowedChatIds: [],
          botInfo: {
            id: 1,
            is_bot: true,
            first_name: 'F',
            username: 'f_bot',
            can_join_groups: false,
            can_read_all_group_messages: false,
            supports_inline_queries: false,
            can_connect_to_business: false,
            has_main_web_app: false,
            has_topics_enabled: false,
            allows_users_to_create_topics: false,
            can_manage_bots: false,
            supports_join_request_queries: false,
          },
        }),
        secret: 'sekret',
      },
    });
    const res = await tg.request('/telegram/webhook/wrong', { method: 'POST' });
    expect(res.status).toBe(404); // reached the route's own secret check, not 401
    expect((await tg.request('/telegram', { method: 'POST' })).status).toBe(401);
  });
});
