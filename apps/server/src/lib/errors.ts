import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';

/** Error response shape for every non-2xx: { error: { code, message, details? } } */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const notFound = (what: string) => new ApiError(404, 'not_found', `${what} not found`);
export const conflict = (code: string, message: string, details?: unknown) =>
  new ApiError(409, code, message, details);
/** A body/query field references a row that does not exist in this workspace. */
export const invalidReference = (field: string, what: string) =>
  new ApiError(400, 'invalid_reference', `${field}: ${what} not found in this workspace`, {
    field,
  });

export function validationError(err: ZodError, where: string): ApiError {
  return new ApiError(400, 'validation_error', `Invalid ${where}`, {
    issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  });
}

interface PgErrorLike {
  code: string;
  constraint_name?: string;
  table_name?: string;
  column_name?: string;
}

/** drizzle wraps driver errors (cause chain); find the Postgres error if any. */
function findPgError(err: unknown): PgErrorLike | undefined {
  for (let e: unknown = err, i = 0; e && typeof e === 'object' && i < 5; i++) {
    const c = (e as { code?: unknown }).code;
    if (typeof c === 'string' && /^[0-9A-Z]{5}$/.test(c) && 'severity' in e)
      return e as unknown as PgErrorLike;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof ZodError) return validationError(err, 'request');
  if (err instanceof HTTPException) {
    return new ApiError(err.status as ContentfulStatusCode, 'bad_request', err.message);
  }
  const pg = findPgError(err);
  if (pg) {
    const details = { constraint: pg.constraint_name, table: pg.table_name };
    switch (pg.code) {
      case '23505':
        return conflict(
          'unique_violation',
          'A row with the same unique value already exists',
          details,
        );
      case '23503':
        return conflict(
          'foreign_key_violation',
          'Row is referenced by, or references, another row',
          details,
        );
      case '23514':
      case '23502':
      case '22003':
      case '22P02':
      case '22007':
      case '22008':
        return new ApiError(400, 'validation_error', 'Value rejected by the database', details);
    }
  }
  return new ApiError(500, 'internal_error', 'Internal server error');
}

export function onError(err: Error, c: Context) {
  const api = toApiError(err);
  if (api.status >= 500) console.error(err);
  return c.json(
    {
      error: {
        code: api.code,
        message: api.message,
        ...(api.details ? { details: api.details } : {}),
      },
    },
    api.status,
  );
}

export function onNotFound(c: Context) {
  return c.json(
    { error: { code: 'not_found', message: `Route ${c.req.method} ${c.req.path} not found` } },
    404,
  );
}
