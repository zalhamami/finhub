import { createBot } from './index';

// Long polling for local development: `pnpm --filter @finhub/bot dev` with TELEGRAM_BOT_TOKEN
// (and TELEGRAM_ALLOWED_CHAT_IDS) in the environment. Production uses the webhook route in apps/server.
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is not set');
  process.exit(1);
}
const bot = createBot(token);
process.once('SIGINT', () => void bot.stop());
process.once('SIGTERM', () => void bot.stop());
await bot.api.deleteWebhook(); // long polling and a webhook are mutually exclusive
await bot.start({ onStart: (me) => console.log(`finhub bot @${me.username} polling`) });
