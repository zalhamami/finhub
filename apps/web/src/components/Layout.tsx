import {
  ActionIcon,
  AppShell,
  Button,
  Group,
  NavLink,
  Text,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconMoon, IconPlus, IconSun } from '@tabler/icons-react';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import { TransactionSheetProvider, useTransactionSheet } from '../features/TransactionSheetContext';
import { isTypingTarget } from '../lib/shortcuts';
import { BottomTabs } from './BottomTabs';
import classes from './Layout.module.css';
import { SIDEBAR_ITEMS, isActivePath } from './nav';

function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme('light', { getInitialValueInEffect: true });
  const dark = computed === 'dark';
  return (
    <ActionIcon
      size="lg"
      aria-label={dark ? 'Ganti ke mode terang' : 'Ganti ke mode gelap'}
      onClick={() => setColorScheme(dark ? 'light' : 'dark')}
    >
      {dark ? <IconSun size={20} stroke={1.75} /> : <IconMoon size={20} stroke={1.75} />}
    </ActionIcon>
  );
}

/** Desktop shortcut: "n" opens the add-transaction form unless you are typing or a dialog is open. */
function useNewTransactionShortcut(open: () => void, isOpen: boolean) {
  const desktop = useMediaQuery('(min-width: 48em)', false, { getInitialValueInEffect: false });
  useEffect(() => {
    if (!desktop || isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'n' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat) return;
      if (isTypingTarget(e.target) || document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      open();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [desktop, isOpen, open]);
}

function Shell() {
  const { openCreate: open, isOpen } = useTransactionSheet();
  useNewTransactionShortcut(open, isOpen);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: true } }}
      padding="md"
    >
      <AppShell.Header className={classes.header}>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Text component={Link} to="/beranda" className={classes.logo}>
            Finhub
          </Text>
          <Group gap="xs" wrap="nowrap">
            <Button
              visibleFrom="sm"
              leftSection={<IconPlus size={18} stroke={1.75} />}
              onClick={open}
            >
              Tambah transaksi
            </Button>
            <ColorSchemeToggle />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm" aria-label="Menu">
        {SIDEBAR_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            component={Link}
            to={to}
            label={label}
            leftSection={<Icon size={20} stroke={1.75} />}
            active={isActivePath(to, pathname)}
            variant="light"
            className={classes.navLink}
          />
        ))}
      </AppShell.Navbar>

      <AppShell.Main className={classes.main}>
        <div className={classes.content}>
          <Outlet />
        </div>
      </AppShell.Main>

      <BottomTabs />
    </AppShell>
  );
}

export function Layout() {
  return (
    <TransactionSheetProvider>
      <Shell />
    </TransactionSheetProvider>
  );
}
