import {
  IconCoin,
  IconDots,
  IconHome,
  IconReceipt,
  IconSettings,
  IconWallet,
  IconBuildingBank,
} from '@tabler/icons-react';

export const SIDEBAR_ITEMS = [
  { to: '/beranda', label: 'Beranda', icon: IconHome },
  { to: '/', label: 'Kekayaan', icon: IconCoin },
  { to: '/transaksi', label: 'Transaksi', icon: IconReceipt },
  { to: '/akun', label: 'Akun', icon: IconBuildingBank },
  { to: '/pengaturan', label: 'Pengaturan', icon: IconSettings },
] as const;

/** Until the real home screen exists (M2), Beranda on mobile is the net worth page. */
export const TAB_ITEMS = [
  { to: '/', label: 'Beranda', icon: IconWallet },
  { to: '/transaksi', label: 'Transaksi', icon: IconReceipt },
  { to: '/akun', label: 'Akun', icon: IconBuildingBank },
  { to: '/pengaturan', label: 'Lainnya', icon: IconDots },
] as const;
