import { cpSync, existsSync, rmSync } from 'node:fs';
import { defineConfig } from 'tsup';

// Self-contained ESM bundles (dist/index.js server, dist/seed.js seed CLI): workspace packages AND npm deps are inlined, so the runtime image
// needs no node_modules. SQL migrations from @finhub/db are copied next to it (dist/drizzle) and the
// built web app (apps/web/dist) to dist/public.
export default defineConfig({
  entry: ['src/index.ts', 'src/seed.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/.*/],
  banner: {
    // some bundled CJS deps call require() for node builtins
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  onSuccess: async () => {
    rmSync('dist/drizzle', { recursive: true, force: true });
    cpSync('../../packages/db/drizzle', 'dist/drizzle', { recursive: true });
    // The root `pnpm build` builds apps/web first; its output is served from the same origin.
    rmSync('dist/public', { recursive: true, force: true });
    if (existsSync('../web/dist')) cpSync('../web/dist', 'dist/public', { recursive: true });
    else console.warn('apps/web/dist not found: dist/public not created (build @finhub/web first)');
  },
});
