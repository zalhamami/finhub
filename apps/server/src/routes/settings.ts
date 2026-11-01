import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { schema } from '@finhub/db';
import { z } from 'zod';
import { nonEmptyPatch, send, v, type AppEnv } from '../lib/http';

const s = schema.settings;

/** Keep in sync with ACCENT_PRESETS in apps/web/src/theme/tokens.ts. */
const ACCENT_PRESET_NAMES = ['amber', 'jade', 'indigo'] as const;

const accentSchema = z.union([
  z.enum(ACCENT_PRESET_NAMES),
  z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'must be a preset name or #rrggbb')
    .transform((x) => x.toLowerCase()),
]);

// Only the accent is editable for now; base currency, locale, month start and timezone are read-only.
const patchSchema = nonEmptyPatch(z.strictObject({ accent: accentSchema }));

const DEFAULTS = {
  base_currency: 'IDR',
  locale: 'id',
  month_start_day: 1,
  timezone: 'Asia/Jakarta',
  accent: 'amber',
};

const toApi = (row: typeof s.$inferSelect) => ({
  base_currency: row.baseCurrency,
  locale: row.locale,
  month_start_day: row.monthStartDay,
  timezone: row.timezone,
  accent: row.accent,
});

export function settingsRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  // A workspace without a settings row reads as the defaults (never 404/500).
  r.get('/', async (c) => {
    const [row] = await c.var.db.select().from(s).where(eq(s.workspaceId, c.var.workspaceId));
    return send(c, row ? toApi(row) : DEFAULTS);
  });

  r.patch('/', v('json', patchSchema), async (c) => {
    const { accent } = c.req.valid('json');
    const [row] = await c.var.db
      .insert(s)
      .values({ workspaceId: c.var.workspaceId, accent })
      .onConflictDoUpdate({ target: s.workspaceId, set: { accent, updatedAt: new Date() } })
      .returning();
    return send(c, toApi(row!));
  });

  return r;
}
