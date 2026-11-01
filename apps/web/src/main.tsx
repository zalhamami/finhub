import '@fontsource-variable/plus-jakarta-sans';
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';
import './theme/variables.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './lib/dayjs';
import { NotificationsHost } from './components/NotificationsHost';
import { RouterProvider, createAppRouter } from './router';
import { AccentSync, ThemeRoot } from './theme/AccentProvider';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
});
const router = createAppRouter();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeRoot>
      <QueryClientProvider client={queryClient}>
        <NotificationsHost />
        <AccentSync />
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeRoot>
  </StrictMode>,
);
