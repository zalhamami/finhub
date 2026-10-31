import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { honoWebhook, type Bot } from '@finhub/bot';

const digest = (s: string) => createHash('sha256').update(s).digest();

/** Constant-time string comparison (hash both sides so the lengths always match). */
export const safeEqual = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

export interface TelegramDeps {
  bot: Bot;
  /** Path secret: the webhook URL registered with Telegram is /telegram/webhook/<secret>. */
  secret: string;
}

/** POST /webhook/:secret; a wrong secret is indistinguishable from a missing route (404). */
export function telegramRoutes({ bot, secret }: TelegramDeps): Hono {
  const r = new Hono();
  const handle = honoWebhook(bot);
  r.post('/webhook/:secret', async (c) => {
    if (!safeEqual(c.req.param('secret'), secret)) return c.notFound();
    return handle(c);
  });
  return r;
}
