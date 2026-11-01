import { Alert, Button, Card, Group, Skeleton, Stack, Text, Title } from '@mantine/core';
import { IconAlertCircle, IconPlus, IconReceipt, IconSearchOff } from '@tabler/icons-react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { useEffect, useMemo, useRef } from 'react';
import { TransactionRow } from '../features/TransactionRow';
import { TransactionFilters } from '../features/TransactionFilters';
import { useTransactionSheet } from '../features/TransactionSheetContext';
import {
  fetchAccounts,
  fetchCategories,
  fetchFxRates,
  fetchSettings,
  fetchTransactionPage,
  type ApiAccount,
  type ApiTransaction,
} from '../lib/api';
import { indexCategories } from '../lib/categories';
import { todayJakarta } from '../lib/dates';
import { formatMinorCurrency } from '../lib/money';
import { dayLabel, groupByDay, type DayGroup, type FxContext } from '../lib/transactions';
import {
  filtersToApiQuery,
  filtersToSearch,
  hasActiveFilters,
  type TxFilters,
} from '../lib/txFilters';
import classes from './TransactionsPage.module.css';

const route = getRouteApi('/transaksi');
const PAGE_SIZE = 50;

export function TransactionsPage() {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const filters: TxFilters = search;
  const setFilters = (next: TxFilters) =>
    void navigate({ search: filtersToSearch(next) as never, replace: true });

  const { openCreate, openEdit } = useTransactionSheet();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: fetchAccounts });
  const categories = useQuery({ queryKey: ['categories'], queryFn: fetchCategories });
  const settings = useQuery({ queryKey: ['settings'], queryFn: fetchSettings, staleTime: 60_000 });
  const fxRates = useQuery({ queryKey: ['fx-rates'], queryFn: fetchFxRates, staleTime: 60_000 });
  const list = useInfiniteQuery({
    queryKey: ['transactions', filtersToSearch(filters)],
    queryFn: ({ pageParam }) =>
      fetchTransactionPage(filtersToApiQuery(filters, { limit: PAGE_SIZE, cursor: pageParam })),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  });

  const accountById = useMemo(
    () => new Map((accounts.data ?? []).map((a) => [a.id, a])),
    [accounts.data],
  );
  // Foreign-currency rows show "≈ base" from the fx-rates table; without both queries, no secondary text.
  const fx = useMemo<FxContext | undefined>(
    () =>
      settings.data && fxRates.data
        ? { rates: fxRates.data, baseCurrency: settings.data.base_currency }
        : undefined,
    [settings.data, fxRates.data],
  );
  const baseCurrency = settings.data?.base_currency ?? 'IDR';
  const categoryInfo = useMemo(() => indexCategories(categories.data ?? []), [categories.data]);
  const groups = useMemo(
    () => groupByDay(list.data?.pages.flatMap((p) => p.data) ?? []),
    [list.data],
  );

  // infinite scroll: load the next page when the sentinel scrolls into view
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

  const today = todayJakarta();
  const filtered = hasActiveFilters(filters);

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2}>Transaksi</Title>
      </Group>

      <TransactionFilters
        filters={filters}
        accounts={accounts.data ?? []}
        categories={categories.data ?? []}
        onChange={setFilters}
      />

      {list.isError ? (
        <Alert
          color="gray"
          icon={<IconAlertCircle size={20} stroke={1.75} />}
          title="Gagal memuat transaksi"
        >
          <Stack gap="sm" align="flex-start">
            <Text size="sm">
              Daftar transaksi belum bisa ditampilkan. Periksa koneksi lalu coba lagi.
            </Text>
            <Button variant="default" size="xs" onClick={() => void list.refetch()}>
              Coba lagi
            </Button>
          </Stack>
        </Alert>
      ) : list.isPending ? (
        <Stack gap="xs" aria-busy="true" aria-label="Memuat">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} height={56} />
          ))}
        </Stack>
      ) : groups.length === 0 ? (
        <Card>
          <Stack align="center" gap="xs" py="lg">
            {filtered ? (
              <IconSearchOff size={32} stroke={1.75} />
            ) : (
              <IconReceipt size={32} stroke={1.75} />
            )}
            <Text fw={600}>
              {filtered ? 'Tidak ada transaksi yang cocok' : 'Belum ada transaksi'}
            </Text>
            <Text size="sm" c="dimmed" ta="center">
              {filtered
                ? 'Coba ubah atau hapus filter.'
                : 'Catat pengeluaran, pemasukan, atau transfer pertamamu.'}
            </Text>
            {filtered ? (
              <Button variant="default" onClick={() => setFilters({})}>
                Reset filter
              </Button>
            ) : (
              <Button leftSection={<IconPlus size={18} stroke={1.75} />} onClick={openCreate}>
                Tambah transaksi
              </Button>
            )}
          </Stack>
        </Card>
      ) : (
        <Card p={0} className={classes.card}>
          {groups.map((g) => (
            <DaySection
              key={g.date}
              group={g}
              today={today}
              accounts={accountById}
              categories={categoryInfo}
              fx={fx}
              baseCurrency={baseCurrency}
              onOpen={openEdit}
            />
          ))}
          <div ref={sentinel} />
          {hasNextPage && (
            <Group justify="center" p="md">
              <Button
                variant="default"
                loading={isFetchingNextPage}
                onClick={() => void fetchNextPage()}
              >
                Muat lebih banyak
              </Button>
            </Group>
          )}
        </Card>
      )}
    </Stack>
  );
}

function DaySection({
  group,
  today,
  accounts,
  categories,
  fx,
  baseCurrency,
  onOpen,
}: {
  group: DayGroup;
  fx?: FxContext;
  baseCurrency: string;
  today: string;
  accounts: ReadonlyMap<string, ApiAccount>;
  categories: ReturnType<typeof indexCategories>;
  onOpen: (tx: ApiTransaction) => void;
}) {
  return (
    <section aria-label={dayLabel(group.date, today)}>
      <h3 className={classes.dayHeader}>
        <span>{dayLabel(group.date, today)}</span>
        <span className={classes.dayNet}>
          {/* Daily subtotal: base currency only. Foreign-currency entries are not converted or summed here. */}
          {group.nets
            .filter((n) => n.currency === baseCurrency)
            .map((n) => (
              <span
                key={n.currency}
                className={clsx(classes.net, n.minor.startsWith('-') ? classes.neg : classes.pos)}
              >
                {formatMinorCurrency(n.minor, n.currency)}
              </span>
            ))}
        </span>
      </h3>
      <ul className={classes.list}>
        {group.items.map((tx) => (
          <TransactionRow
            key={tx.id}
            tx={tx}
            accounts={accounts}
            categories={categories}
            fx={fx}
            onOpen={onOpen}
          />
        ))}
      </ul>
    </section>
  );
}
