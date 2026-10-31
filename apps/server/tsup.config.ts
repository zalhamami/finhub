import { cpSync, rmSync } from 'node:fs';
import { defineConfig } from 'tsup';

// Self-contained ESM bundle: workspace packages AND npm deps are inlined, so the runtime image
// needs no node_modules. SQL migrations from @finhub/db are copied next to it (dist/drizzle).
export default defineConfig({
  entry: ['src/index.ts'],
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
  },
});
