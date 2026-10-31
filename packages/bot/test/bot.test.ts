import { describe, expect, it } from 'vitest';
import type { UserFromGetMe } from 'grammy/types';
import { START_REPLY, createBot, parseAllowedChatIds } from '../src';

const botInfo: UserFromGetMe = {
  id: 1,
  is_bot: true,
  first_name: 'Finhub',
  username: 'finhub_test_bot',
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

function setup(allowed: number[]) {
  const sent: { method: string; payload: Record<string, unknown> }[] = [];
  const bot = createBot('123:fake', { allowedChatIds: allowed, botInfo });
  bot.api.config.use(async (_prev, method, payload) => {
    sent.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: true } as never;
  });
  const update = (chatId: number, text: string) => ({
    update_id: 1,
    message: {
      message_id: 1,
      date: 0,
      chat: { id: chatId, type: 'private' as const, first_name: 'T' },
      from: { id: chatId, is_bot: false, first_name: 'T' },
      text,
      entities: text.startsWith('/')
        ? [{ type: 'bot_command' as const, offset: 0, length: text.length }]
        : undefined,
    },
  });
  return { bot, sent, update };
}

describe('bot', () => {
  it('replies to /start in Indonesian for an allowlisted chat', async () => {
    const { bot, sent, update } = setup([42]);
    await bot.handleUpdate(update(42, '/start'));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      method: 'sendMessage',
      payload: { chat_id: 42, text: START_REPLY },
    });
    expect(START_REPLY).toMatch(/^Halo!/);
  });

  it('ignores chats that are not allowlisted', async () => {
    const { bot, sent, update } = setup([42]);
    await bot.handleUpdate(update(7, '/start'));
    expect(sent).toHaveLength(0);
  });

  it('an empty allowlist allows nobody', async () => {
    const { bot, sent, update } = setup([]);
    await bot.handleUpdate(update(42, '/start'));
    expect(sent).toHaveLength(0);
  });

  it('parses TELEGRAM_ALLOWED_CHAT_IDS', () => {
    expect([...parseAllowedChatIds('1, -1002 ,x, 3')]).toEqual([1, -1002, 3]);
    expect(parseAllowedChatIds(undefined).size).toBe(0);
  });
});
