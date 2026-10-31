import {
  ActionIcon,
  AppShell,
  Button,
  Group,
  Modal,
  NavLink,
  Text,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconMoon, IconPlus, IconSun } from '@tabler/icons-react';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { BottomTabs } from './BottomTabs';
import classes from './Layout.module.css';
import { SIDEBAR_ITEMS } from './nav';

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

export function Layout() {
  const [opened, { open, close }] = useDisclosure(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: true } }}
      padding="md"
    >
      <AppShell.Header className={classes.header}>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Text component={Link} to="/" className={classes.logo}>
            Finhub
          </Text>
          <Group gap="xs" wrap="nowrap">
            <Button
              visibleFrom="sm"
              leftSection={<IconPlus size={18} stroke={1.75} />}
              onClick={open}
            >
              Tambah
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
            active={to === '/' ? pathname === '/' : pathname.startsWith(to)}
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
      <ActionIcon
        variant="filled"
        color="amber"
        size="xl"
        radius="xl"
        aria-label="Tambah transaksi"
        className={classes.fab}
        onClick={open}
      >
        <IconPlus size={26} stroke={1.75} />
      </ActionIcon>

      <Modal opened={opened} onClose={close} title="Tambah transaksi">
        <Text size="sm" c="dimmed">
          Pencatatan transaksi hadir di M2.
        </Text>
      </Modal>
    </AppShell>
  );
}
