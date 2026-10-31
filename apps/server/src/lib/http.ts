import type { Context } from 'hono';
import { validator } from 'hono/validator';
import type { Db } from '@finhub/db';
import { z } from 'zod';
import { validationError } from './errors';

export type AppEnv = { Variables: { db: Db; workspaceId: string } };

/**
 * bigint JSON: every bigint (all *_minor money fields) is serialized as a decimal string,
 * because JSON numbers lose precision beyond 2^53. Inputs accept string or safe integer.
 */
export function send(
  c: Context,
  data: unknown,
  status: 200 | 201 = 200,
  extra: Record<string, unknown> = {},
) {
  const body = JSON.stringify({ data, ...extra }, (_k, v) =>
    typeof v === 'bigint' ? v.toString() : v,
  );
  return c.body(body, status, { 'content-type': 'application/json; charset=UTF-8' });
}

const snake = (s: string) => s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
const camel = (s: string) => s.replace(/_([a-z])/g, (_m, ch: string) => ch.toUpperCase());

function mapKeys(o: Record<string, unknown>, f: (k: string) => string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [f(k), v]));
}
/** drizzle row (camelCase) -> API object (snake_case) */
export const toApi = <T extends object>(row: T): Record<string, unknown> =>
  mapKeys(row as Record<string, unknown>, snake);
/** API body (snake_case) -> drizzle values (camelCase) */
export const toDb = (body: object): Record<string, unknown> =>
  mapKeys(body as Record<string, unknown>, camel);

/** Zod-validating middleware: `c.req.valid(target)` is typed and already parsed. */
export const v = <S extends z.ZodType>(target: 'json' | 'query' | 'param', schema: S) =>
  validator(target, (value) => {
    const r = schema.safeParse(value);
    if (!r.success) throw validationError(r.error, target === 'json' ? 'body' : target);
    return r.data as z.output<S>;
  });

/* ---------- shared zod pieces ---------- */

export const idParam = z.object({ id: z.guid() });

const INT64_MAX = 2n ** 63n - 1n;
/** minor-unit money input: decimal string or safe JSON integer -> bigint (int64 range). */
export const minor = z
  .union([z.string().regex(/^-?\d+$/, 'must be an integer string'), z.number().int()])
  .transform((x, ctx) => {
    const b = BigInt(x);
    if (b > INT64_MAX || b < -INT64_MAX - 1n) {
      ctx.addIssue({ code: 'custom', message: 'out of int64 range' });
      return z.NEVER;
    }
    return b;
  });

export const nonEmptyPatch = <S extends z.ZodType>(schema: S) =>
  schema.refine((o) => Object.keys(o as object).length > 0, 'at least one field is required');

export const boolQuery = z
  .enum(['true', 'false'])
  .optional()
  .transform((x) => x === 'true');
