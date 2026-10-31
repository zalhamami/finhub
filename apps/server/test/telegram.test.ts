import { describe, expect, it } from 'vitest';
import { createBot } from '@finhub/bot';
import { createApp } from '../src/app';

const post = (app: ReturnType<typeof createApp>, path: string) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ update_id: 1 }),
  });

describe('telegram webhook route', () => {
  it('is absent when not configured', async () => {
    const app = createApp();
    expect((await post(app, '/telegram/webhook/anything')).status).toBe(404);
  });

  it('404s on a wrong secret and accepts the right one', async () => {
    const bot = createBot('123:fake', {
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
    });
    const app = createApp({ telegram: { bot, secret: 's3cret' } });
    expect((await post(app, '/telegram/webhook/wrong')).status).toBe(404);
    expect((await post(app, '/telegram/webhook/s3cret-longer')).status).toBe(404);
    // right secret: an update with no chat is ignored by the allowlist, handler answers 200
    expect((await post(app, '/telegram/webhook/s3cret')).status).toBe(200);
  });
});
