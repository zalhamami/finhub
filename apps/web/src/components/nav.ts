import {
  IconCoin,
  IconDots,
  IconHome,
  IconReceipt,
  IconSettings,
  IconBuildingBank,
  IconCategory,
} from '@tabler/icons-react';

export const SIDEBAR_ITEMS = [
  { to: '/beranda', label: 'Beranda', icon: IconHome },
  { to: '/', label: 'Kekayaan', icon: IconCoin },
  { to: '/transaksi', label: 'Transaksi', icon: IconReceipt },
  { to: '/akun', label: 'Akun', icon: IconBuildingBank },
  { to: '/kategori', label: 'Kategori', icon: IconCategory },
  { to: '/pengaturan', label: 'Pengaturan', icon: IconSettings },
] as const;

/** Mobile tabs. Kekayaan is the net worth page ("/"); Beranda lives in the sidebar only until M2. */
export const TAB_ITEMS: readonly {
  to: string;
  label: string;
  icon: typeof IconCoin;
  /** other routes that live under this tab */
  also?: readonly string[];
}[] = [
  { to: '/', label: 'Kekayaan', icon: IconCoin },
  { to: '/transaksi', label: 'Transaksi', icon: IconReceipt },
  { to: '/akun', label: 'Akun', icon: IconBuildingBank },
  // "Lainnya" is Pengaturan, which links to Kategori and Jenis akun
  { to: '/pengaturan', label: 'Lainnya', icon: IconDots, also: ['/kategori'] },
];

/** "/" matches only itself; other routes match themselves and their sub-paths. */
export const isActivePath = (to: string, pathname: string) =>
  to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`);

export const isTabActive = (tab: { to: string; also?: readonly string[] }, pathname: string) =>
  isActivePath(tab.to, pathname) || (tab.also ?? []).some((p) => isActivePath(p, pathname));
