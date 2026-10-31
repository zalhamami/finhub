import {
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from '@tanstack/react-router';
import { Layout } from './components/Layout';
import { NetWorthPage } from './pages/NetWorthPage';
import { PlaceholderPage } from './pages/PlaceholderPage';

const rootRoute = createRootRoute({ component: Layout });

const page = (path: string, title: string) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path,
    component: () => <PlaceholderPage title={title} />,
  });

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: '/', component: NetWorthPage }),
  page('/beranda', 'Beranda'),
  page('/transaksi', 'Transaksi'),
  page('/akun', 'Akun'),
  page('/pengaturan', 'Pengaturan'),
]);

export const createAppRouter = (history?: RouterHistory) =>
  createRouter({ routeTree, history, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}

export { RouterProvider };
