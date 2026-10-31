import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { createMiddleware } from 'hono/factory';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const isFile = (p: string) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** True when `dir` exists and is a directory; callers skip static serving quietly otherwise. */
export const hasPublicDir = (dir: string) => existsSync(dir) && statSync(dir).isDirectory();

/**
 * Serves files from `dir` for GET/HEAD requests outside /api, /healthz and /health, with SPA fallback to
 * index.html. A missing path that looks like a file (has an extension) is a real 404, not index.html.
 */
export function staticMiddleware(dir: string) {
  const root = resolve(dir);
  const index = join(root, 'index.html');
  return createMiddleware(async (c, next) => {
    const path = c.req.path;
    if (
      (c.req.method !== 'GET' && c.req.method !== 'HEAD') ||
      path === '/api' ||
      path.startsWith('/api/') ||
      path === '/healthz' ||
      path === '/health'
    ) {
      return next();
    }
    let rel: string;
    try {
      rel = decodeURIComponent(path);
    } catch {
      return next();
    }
    if (rel.includes('\0')) return next();
    let file = resolve(root, `.${rel}`);
    if (file !== root && !file.startsWith(root + sep)) return next(); // path traversal
    if (!isFile(file)) {
      if (extname(rel) || !isFile(index)) return next();
      file = index;
    }
    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
    const isIndex = file === index;
    const headers: Record<string, string> = {
      'content-type': type,
      'content-length': String(statSync(file).size),
      // Vite-style hashed assets are immutable; the HTML shell must always revalidate.
      'cache-control': isIndex
        ? 'no-cache'
        : rel.startsWith('/assets/')
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=3600',
    };
    if (c.req.method === 'HEAD') return c.body(null, 200, headers);
    const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
    return c.body(stream, 200, headers);
  });
}
