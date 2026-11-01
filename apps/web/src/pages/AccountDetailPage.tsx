import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Skeleton,
  Stack,
  Text,
  Title,
  useMantineTheme,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconArrowDownRight,
  IconArrowLeft,
  IconArrowUpRight,
  IconMinus,
  IconPencil,
  IconPlus,
  IconReceipt,
  IconWalletOff,
} from '@tabler/icons-react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, getRouteApi, useNavigate } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Amount } from '../components/Amount';
import { AccountAmount } from '../components/AccountAmount';
import { AccountEditSheet } from '../features/AccountEditSheet';
import { TransactionRow } from '../features/TransactionRow';
import { useTransactionSheet } from '../features/TransactionSheetContext';
import { accountDayHeader, changeBadge } from '../lib/accountDetail';
import { resolveNatives, resolveValues } from '../lib/accounts';
import {
  fetchAccountBalanceHistory,
  fetchAccountTypes,
  fetchAccounts,
  fetchBalances,
  fetchCategories,
  fetchFxRates,
  fetchNetWorth,
  fetchSettings,
  fetchTransactionPage,
} from '../lib/api';
import { indexCategories } from '../lib/categories';
import { todayJakarta } from '../lib/dates';
import { groupByDay, type FxContext } from '../lib/transactions';
import { BalanceChart } from '../ui/BalanceChart';
import { EntityIcon } from '../ui/EntityIcon';
import classes from './AccountDetailPage.module.css';

const route = getRouteApi('/akun/$accountId');
const PAGE_SIZE = 50;
const HISTORY_DAYS = 30;

export function AccountDetailPage() {
  const { accountId } = route.useParams();
  const navigate = useNavigate();
  const theme = useMantineTheme();
  const { openCreateForAccount, openEdit } = useTransactionSheet();
  const [editing, setEditing] = useState(false);

  const accounts = useQuery({ queryKey: ['accounts'], queryFn: fetchAccounts });
  const types = useQuery({ queryKey: ['account-types'], queryFn: fetchAccountTypes });
  const categories = useQuery({ queryKey: ['categories'], queryFn: fetchCategories });
  const settings = useQuery({ queryKey: ['settings'], queryFn: fetchSettings, staleTime: 60_000 });
  const fxRates = useQuery({ queryKey: ['fx-rates'], queryFn: fetchFxRates, staleTime: 60_000 });
  // values are best effort: a failing report must not hide the account
  const balances = useQuery({ queryKey: ['reports', 'balances'], queryFn: fetchBalances });
  const netWorth = useQuery({ queryKey: ['reports', 'net-worth'], queryFn: fetchNetWorth });

  const account = accounts.data?.find((a) => a.id === accountId);
  const found = account !== undefined;

  // under ['accounts'] so every transaction mutation (which invalidates it) refreshes the card
  const history = useQuery({
    queryKey: ['accounts', accountId, 'balance-history', HISTORY_DAYS],
    queryFn: () => fetchAccountBalanceHistory(accountId, HISTORY_DAYS),
    enabled: found,
  });
  const list = useInfiniteQuery({
    queryKey: ['transactions', 'account', accountId],
    queryFn: ({ pageParam }) => {
      const q = new URLSearchParams({ account_id: accountId, limit: String(PAGE_SIZE) });
      if (pageParam) q.set('cursor', pageParam);
      return fetchTransactionPage(q.toString());
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled: found,
  });

  const accountById = useMemo(
    () => new Map((accounts.data ?? []).map((a) => [a.id, a])),
    [accounts.data],
  );
  const categoryInfo = useMemo(() => indexCategories(categories.data ?? []), [categories.data]);
  const fx = useMemo<FxContext | undefined>(
    () =>
      settings.data && fxRates.data
        ? { rates: fxRates.data, baseCurrency: settings.data.base_currency }
        : undefined,
    [settings.data, fxRates.data],
  );
  const groups = useMemo(
    () => groupByDay(list.data?.pages.flatMap((p) => p.data) ?? []),
    [list.data],
  );

  // infinite scroll; the "Muat lagi" button below is the fallback
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: '400px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, groups.length]);

  if (accounts.isError) {
    return (
      <Alert
        color="gray"
        icon={<IconAlertCircle size={20} stroke={1.75} />}
        title="Gagal memuat data"
      >
        <Stack gap="sm" align="flex-start">
          <Text size="sm">Akun belum bisa ditampilkan. Periksa koneksi lalu coba lagi.</Text>
          <Button variant="default" size="xs" onClick={() => void accounts.refetch()}>
            Coba lagi
          </Button>
        </Stack>
      </Alert>
    );
  }
  if (!accounts.data) {
    return (
      <Stack gap="md" aria-busy="true" aria-label="Memuat">
        <Skeleton height={40} />
        <Skeleton height={300} radius="lg" />
      </Stack>
    );
  }
  if (!account) {
    return (
      <Card className={classes.notFound}>
        <Stack align="center" gap="xs">
          <IconWalletOff size={36} stroke={1.75} />
          <Title order={3}>Akun tidak ditemukan</Title>
          <Text size="sm" c="dimmed" maw={360}>
            Akun ini tidak ada atau sudah dihapus.
          </Text>
          <Button component={Link} to="/akun" variant="default" mt="xs">
            Kembali ke daftar akun
          </Button>
        </Stack>
      </Card>
    );
  }

  const type = types.data?.find((t) => t.id === account.type_id);
  const archived = account.archived_at !== null;
  const liability = type?.kind === 'liability';
  const baseCurrency = settings.data?.base_currency ?? balances.data?.base_currency ?? 'IDR';
  const native =
    history.data?.end_balance_minor ?? resolveNatives(balances.data, netWorth.data).get(account.id);
  const base = resolveValues(balances.data, netWorth.data).get(account.id);
  const badge = history.data
    ? changeBadge(
        history.data.start_balance_minor,
        history.data.end_balance_minor,
        account.currency,
      )
    : null;
  const today = todayJakarta();
  const addHere = () => openCreateForAccount(account.id);

  return (
    <Stack gap="md" className={classes.page}>
      <header className={classes.header}>
        <ActionIcon
          component={Link}
          to="/akun"
          variant="subtle"
          color="gray"
          size="lg"
          aria-label="Kembali ke daftar akun"
        >
          <IconArrowLeft size={20} stroke={1.75} />
        </ActionIcon>
        <Title order={2} className={classes.title}>
          <span className={classes.titleIcon} aria-hidden>
            <EntityIcon name={account.icon ?? type?.icon} size={18} />
          </span>
          <span className={classes.titleText}>{account.name}</span>
          {archived && (
            <Badge size="sm" variant="default">
              Arsip
            </Badge>
          )}
        </Title>
        <Button
          variant="default"
          size="compact-md"
          leftSection={<IconPencil size={16} stroke={1.75} />}
          onClick={() => setEditing(true)}
          className={classes.edit}
        >
          Ubah
        </Button>
      </header>

      <div className={classes.layout}>
        <Card className={classes.summary} aria-label="Ringkasan akun" component="section">
          <Stack gap="md">
            <Text size="xs" fw={600} c="dimmed" className={classes.caption}>
              30 HARI TERAKHIR
            </Text>
            <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
              <Text component="div" className={classes.balance} fw={700}>
                {archived ? (
                  <Amount
                    minor={native}
                    currency={account.currency}
                    tone={liability ? 'neutral' : 'plain'}
                  />
                ) : (
                  <AccountAmount
                    currency={account.currency}
                    native={native}
                    base={base}
                    baseCurrency={baseCurrency}
                    tone={liability ? 'neutral' : 'plain'}
                  />
                )}
              </Text>
              {badge && <ChangeBadge badge={badge} />}
            </Group>
            {history.data ? (
              <BalanceChart
                points={history.data.points}
                currency={account.currency}
                label={`Saldo ${account.name} selama ${HISTORY_DAYS} hari terakhir`}
              />
            ) : history.isError ? (
              <Text size="sm" c="dimmed">
                Grafik saldo belum bisa dimuat.
              </Text>
            ) : (
              <Skeleton height={182} aria-label="Memuat grafik" />
            )}
            {!archived && (
              <Button
                className={classes.addDesktop}
                leftSection={<IconPlus size={18} stroke={1.75} />}
                onClick={addHere}
                aria-label="Tambah transaksi di akun ini"
              >
                Tambah transaksi
              </Button>
            )}
          </Stack>
        </Card>

        <div className={classes.listCol}>
          {list.isError ? (
            <Alert
              color="gray"
              icon={<IconAlertCircle size={20} stroke={1.75} />}
              title="Gagal memuat transaksi"
            >
              <Button variant="default" size="xs" onClick={() => void list.refetch()}>
                Coba lagi
              </Button>
            </Alert>
          ) : list.isPending ? (
            <Stack gap="xs" aria-busy="true" aria-label="Memuat transaksi">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} height={56} />
              ))}
            </Stack>
          ) : groups.length === 0 ? (
            <Card>
              <Stack align="center" gap="xs" py="lg">
                <IconReceipt size={32} stroke={1.75} />
                <Text fw={600}>Belum ada transaksi di akun ini</Text>
                {!archived && (
                  <Button
                    leftSection={<IconPlus size={18} stroke={1.75} />}
                    onClick={addHere}
                    aria-label="Tambah transaksi di akun ini"
                  >
                    Tambah transaksi
                  </Button>
                )}
              </Stack>
            </Card>
          ) : (
            <Card p={0} className={classes.listCard}>
              {groups.map((g) => (
                <section key={g.date} aria-label={accountDayHeader(g.date, today)}>
                  <h3 className={classes.dayHeader}>{accountDayHeader(g.date, today)}</h3>
                  <ul className={classes.list}>
                    {g.items.map((tx) => (
                      <TransactionRow
                        key={tx.id}
                        tx={tx}
                        accounts={accountById}
                        categories={categoryInfo}
                        fx={fx}
                        viewAccountId={account.id}
                        showTime
                        onOpen={openEdit}
                      />
                    ))}
                  </ul>
                </section>
              ))}
              <div ref={sentinel} />
              {hasNextPage && (
                <Group justify="center" p="md">
                  <Button
                    variant="default"
                    loading={isFetchingNextPage}
                    onClick={() => void fetchNextPage()}
                  >
                    Muat lagi
                  </Button>
                </Group>
              )}
            </Card>
          )}
        </div>
      </div>

      {!archived && (
        <ActionIcon
          className={classes.fab}
          size={56}
          radius="xl"
          variant="filled"
          color={theme.primaryColor}
          data-fab
          aria-label="Tambah transaksi di akun ini"
          onClick={addHere}
        >
          <IconPlus size={26} stroke={1.75} />
        </ActionIcon>
      )}

      <AccountEditSheet
        account={account}
        opened={editing}
        onClose={() => setEditing(false)}
        onGone={() => void navigate({ to: '/akun', replace: true })}
      />
    </Stack>
  );
}

function ChangeBadge({ badge }: { badge: ReturnType<typeof changeBadge> }) {
  const Icon =
    badge.direction === 'up'
      ? IconArrowUpRight
      : badge.direction === 'down'
        ? IconArrowDownRight
        : IconMinus;
  return (
    <span
      className={clsx(
        classes.badge,
        badge.direction === 'up' && classes.up,
        badge.direction === 'down' && classes.down,
      )}
      aria-label={`Perubahan 30 hari: ${badge.label}`}
    >
      <Icon size={16} stroke={1.75} aria-hidden />
      {badge.label}
    </span>
  );
}
