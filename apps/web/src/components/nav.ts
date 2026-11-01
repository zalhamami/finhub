import {
  IconCoin,
  IconDots,
  IconHome,
  IconReceipt,
  IconSettings,
  IconBuildingBank,
} from '@tabler/icons-react';

export const SIDEBAR_ITEMS = [
  { to: '/beranda', label: 'Beranda', icon: IconHome },
  { to: '/', label: 'Kekayaan', icon: IconCoin },
  { to: '/transaksi', label: 'Transaksi', icon: IconReceipt },
  { to: '/akun', label: 'Akun', icon: IconBuildingBank },
  { to: '/pengaturan', label: 'Pengaturan', icon: IconSettings },
] as const;

/** Mobile tabs. Kekayaan is the net worth page ("/"); Beranda lives in the sidebar only until M2. */
export const TAB_ITEMS = [
  { to: '/', label: 'Kekayaan', icon: IconCoin },
  { to: '/transaksi', label: 'Transaksi', icon: IconReceipt },
  { to: '/akun', label: 'Akun', icon: IconBuildingBank },
  { to: '/pengaturan', label: 'Lainnya', icon: IconDots },
] as const;

/** "/" matches only itself; other routes match themselves and their sub-paths. */
export const isActivePath = (to: string, pathname: string) =>
  to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`);
