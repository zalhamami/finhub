import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Dev: the API runs on :3000 (`pnpm dev` at the repo root starts both).
// Build: apps/web/dist; the root `pnpm build` copies it to apps/server/dist/public.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/healthz': 'http://localhost:3000',
    },
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
  },
});
