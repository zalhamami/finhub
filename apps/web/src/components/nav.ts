import {
  IconCoin,
  IconDots,
  IconHome,
  IconPlus,
  IconReceipt,
  IconSettings,
  IconBuildingBank,
  IconCategory,
} from '@tabler/icons-react';

export const SIDEBAR_ITEMS = [
  { to: '/beranda', label: 'Beranda', icon: IconHome },
  { to: '/kekayaan', label: 'Kekayaan', icon: IconCoin },
  { to: '/transaksi', label: 'Transaksi', icon: IconReceipt },
  { to: '/akun', label: 'Akun', icon: IconBuildingBank },
  { to: '/kategori', label: 'Kategori', icon: IconCategory },
  { to: '/pengaturan', label: 'Pengaturan', icon: IconSettings },
] as const;

export type TabItem =
  | {
      to: string;
      label: string;
      icon: typeof IconCoin;
      /** other routes that live under this tab */
      also?: readonly string[];
    }
  /** center button that opens the add-transaction sheet instead of navigating */
  | { action: 'add'; label: string; ariaLabel: string; icon: typeof IconCoin };

/**
 * Mobile tabs (max 5). Kekayaan is reached from the Beranda net worth card and from Lainnya
 * (Pengaturan lists Kekayaan, Kategori and Jenis akun); Akun keeps its own tab because it is the
 * daily-use screen (balances, editing accounts) while net worth is a read-only overview.
 */
export const TAB_ITEMS: readonly TabItem[] = [
  { to: '/beranda', label: 'Beranda', icon: IconHome },
  { to: '/transaksi', label: 'Transaksi', icon: IconReceipt },
  { action: 'add', label: 'Tambah', ariaLabel: 'Tambah transaksi', icon: IconPlus },
  { to: '/akun', label: 'Akun', icon: IconBuildingBank },
  { to: '/pengaturan', label: 'Lainnya', icon: IconDots, also: ['/kekayaan', '/kategori'] },
];

/** A route matches itself and its sub-paths. */
export const isActivePath = (to: string, pathname: string) =>
  pathname === to || pathname.startsWith(`${to}/`);

export const isTabActive = (tab: { to: string; also?: readonly string[] }, pathname: string) =>
  isActivePath(tab.to, pathname) || (tab.also ?? []).some((p) => isActivePath(p, pathname));
