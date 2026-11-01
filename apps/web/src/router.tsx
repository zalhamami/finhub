import {
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
  type RouterHistory,
} from '@tanstack/react-router';
import { Layout } from './components/Layout';
import { searchToFilters, type TxFilters } from './lib/txFilters';

const rootRoute = createRootRoute({ component: Layout });

// Pages are lazy chunks; only the shell (Layout) is in the entry bundle.

const routeTree = rootRoute.addChildren([
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    // old "/" bookmarks (it used to be the net worth page) land on Beranda
    beforeLoad: () => {
      throw redirect({ to: '/beranda', replace: true });
    },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/beranda',
    component: lazyRouteComponent(() => import('./pages/BerandaPage'), 'BerandaPage'),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/kekayaan',
    component: lazyRouteComponent(() => import('./pages/NetWorthPage'), 'NetWorthPage'),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/transaksi',
    // URL <-> filters: bad values are dropped, never an error page
    validateSearch: (raw: Record<string, unknown>): TxFilters => searchToFilters(raw),
    component: lazyRouteComponent(() => import('./pages/TransactionsPage'), 'TransactionsPage'),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/akun',
    component: lazyRouteComponent(() => import('./pages/AccountsPage'), 'AccountsPage'),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/kategori',
    component: lazyRouteComponent(() => import('./pages/CategoriesPage'), 'CategoriesPage'),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/pengaturan',
    component: lazyRouteComponent(() => import('./pages/SettingsPage'), 'SettingsPage'),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/pengaturan/jenis-akun',
    component: lazyRouteComponent(() => import('./pages/AccountTypesPage'), 'AccountTypesPage'),
  }),
]);

export const createAppRouter = (history?: RouterHistory) =>
  createRouter({ routeTree, history, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}

export { RouterProvider };
