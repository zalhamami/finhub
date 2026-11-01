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
  build: {
    rollupOptions: {
      output: {
        // Stable vendor chunks (cache well across deploys); pages are lazy chunks from the router.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@mantine/dates') || /node_modules\/(\.pnpm\/)?dayjs[@/]/.test(id))
            return 'vendor-dates';
          if (id.includes('@mantine') || id.includes('@tabler')) return 'vendor-mantine';
          if (id.includes('@tanstack')) return 'vendor-tanstack';
          if (/node_modules\/(\.pnpm\/)?(react|react-dom|scheduler)[@/]/.test(id))
            return 'vendor-react';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
  },
});
