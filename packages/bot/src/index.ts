import { Bot, webhookCallback, type Context, type MiddlewareFn } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';

export { Bot };

export const START_REPLY = 'Halo! Finhub siap. Pencatatan cepat lewat Telegram datang di M5.';

/** Parse TELEGRAM_ALLOWED_CHAT_IDS ("123, -100456"): comma/space separated integers; junk is dropped. */
export function parseAllowedChatIds(raw: string | undefined): Set<number> {
  const ids = (raw ?? '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isSafeInteger(n));
  return new Set(ids);
}

/** Drops every update whose chat is not allowlisted (silently). An empty allowlist therefore allows nobody. */
export function allowlist(allowed: ReadonlySet<number>): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const id = ctx.chat?.id;
    if (id === undefined || !allowed.has(id)) return;
    await next();
  };
}

export interface BotOptions {
  /** Allowed chat ids; defaults to TELEGRAM_ALLOWED_CHAT_IDS. */
  allowedChatIds?: Iterable<number>;
  /** Pre-fetched bot info (skips the getMe call on init); mainly for tests. */
  botInfo?: UserFromGetMe;
}

/** The handler logic, kept separate so it can be tested without Telegram. */
export async function handleStart(ctx: Context): Promise<void> {
  await ctx.reply(START_REPLY);
}

export function createBot(token: string, opts: BotOptions = {}): Bot {
  const allowed = opts.allowedChatIds
    ? new Set(opts.allowedChatIds)
    : parseAllowedChatIds(process.env.TELEGRAM_ALLOWED_CHAT_IDS);
  const bot = new Bot(token, opts.botInfo ? { botInfo: opts.botInfo } : undefined);
  bot.use(allowlist(allowed));
  bot.command('start', handleStart);
  bot.catch((err) => console.error('finhub bot: handler error', err.message));
  return bot;
}

/** grammY's webhook handler for Hono: `(c) => Response`. */
export const honoWebhook = (bot: Bot) => webhookCallback(bot, 'hono');
