import {
  IconBolt,
  IconBriefcase,
  IconBuildingBank,
  IconBuildingStore,
  IconBus,
  IconCar,
  IconCash,
  IconChartLine,
  IconChartPie,
  IconCoin,
  IconCoffee,
  IconCreditCard,
  IconCurrencyBitcoin,
  IconCurrencyDollar,
  IconDeviceMobile,
  IconDeviceTv,
  IconDiamond,
  IconGift,
  IconHeartbeat,
  IconHome,
  IconPig,
  IconPlane,
  IconReceipt,
  IconSchool,
  IconShoppingBag,
  IconShoppingCart,
  IconToolsKitchen2,
  IconTrendingUp,
  IconWallet,
  IconCategory,
  type Icon,
} from '@tabler/icons-react';

/** Curated finance icons for accounts and account types (~24). Stored by key. */
export const ACCOUNT_ICONS = {
  wallet: IconWallet,
  cash: IconCash,
  coin: IconCoin,
  'building-bank': IconBuildingBank,
  'credit-card': IconCreditCard,
  'device-mobile': IconDeviceMobile,
  pig: IconPig,
  'chart-line': IconChartLine,
  'chart-pie': IconChartPie,
  'trending-up': IconTrendingUp,
  diamond: IconDiamond,
  'currency-dollar': IconCurrencyDollar,
  'currency-bitcoin': IconCurrencyBitcoin,
  home: IconHome,
  car: IconCar,
  briefcase: IconBriefcase,
  'building-store': IconBuildingStore,
  receipt: IconReceipt,
  bolt: IconBolt,
  gift: IconGift,
  school: IconSchool,
  heartbeat: IconHeartbeat,
  plane: IconPlane,
  'shopping-bag': IconShoppingBag,
} as const satisfies Record<string, Icon>;

/** Curated icons for spending / income categories (~24). */
export const CATEGORY_ICONS = {
  'tools-kitchen': IconToolsKitchen2,
  coffee: IconCoffee,
  bus: IconBus,
  car: IconCar,
  'shopping-cart': IconShoppingCart,
  'shopping-bag': IconShoppingBag,
  home: IconHome,
  bolt: IconBolt,
  receipt: IconReceipt,
  heartbeat: IconHeartbeat,
  school: IconSchool,
  plane: IconPlane,
  gift: IconGift,
  'device-tv': IconDeviceTv,
  'device-mobile': IconDeviceMobile,
  briefcase: IconBriefcase,
  cash: IconCash,
  coin: IconCoin,
  wallet: IconWallet,
  'trending-up': IconTrendingUp,
  'building-bank': IconBuildingBank,
  'building-store': IconBuildingStore,
  pig: IconPig,
  category: IconCategory,
} as const satisfies Record<string, Icon>;

const ALL: Record<string, Icon> = { ...CATEGORY_ICONS, ...ACCOUNT_ICONS };

/** Icon component for a stored key; unknown/null -> the fallback. */
export function iconFor(key: string | null | undefined, fallback: Icon = IconWallet): Icon {
  return (key && ALL[key]) || fallback;
}

export const ICON_LABEL = (key: string) => key.replace(/-/g, ' ');
