import { createHash, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

export interface AccessGate {
  user: string;
  /** empty = gate off */
  password: string;
}

const digest = (s: string) => createHash('sha256').update(s).digest();

/** Paths that bypass the gate: the Docker healthcheck and the Telegram webhook (own path secret). */
const exempt = (path: string) => path === '/healthz' || path.startsWith('/telegram/webhook/');

/**
 * Optional shared-password gate (HTTP Basic) for an internet-exposed demo. NOT real auth.
 * Both user and password are compared via sha256 + timingSafeEqual, without short-circuiting.
 */
export function accessGate(gate: AccessGate): MiddlewareHandler {
  const wantUser = digest(gate.user);
  const wantPass = digest(gate.password);
  return async (c, next) => {
    if (exempt(c.req.path)) return next();
    const header = c.req.header('authorization') ?? '';
    const m = /^Basic\s+([A-Za-z0-9+/=_-]+)\s*$/i.exec(header);
    if (m) {
      const decoded = Buffer.from(m[1]!, 'base64').toString('utf8');
      const i = decoded.indexOf(':');
      if (i >= 0) {
        const userOk = timingSafeEqual(digest(decoded.slice(0, i)), wantUser);
        const passOk = timingSafeEqual(digest(decoded.slice(i + 1)), wantPass);
        if (userOk && passOk) return next();
      }
    }
    return c.json({ error: { code: 'unauthorized', message: 'Authentication required' } }, 401, {
      'WWW-Authenticate': 'Basic realm="Finhub", charset="UTF-8"',
    });
  };
}
