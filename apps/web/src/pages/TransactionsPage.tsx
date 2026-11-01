import {
  Alert,
  Button,
  Card,
  Group,
  Skeleton,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { IconAlertCircle, IconPlus, IconReceipt, IconSearchOff } from '@tabler/icons-react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { useEffect, useMemo, useRef } from 'react';
import { Amount } from '../components/Amount';
import { TransactionFilters } from '../features/TransactionFilters';
import { useTransactionSheet } from '../features/TransactionSheetContext';
import {
  fetchAccounts,
  fetchCategories,
  fetchTransactionPage,
  type ApiAccount,
  type ApiTransaction,
} from '../lib/api';
import { indexCategories } from '../lib/categories';
import { todayJakarta } from '../lib/dates';
import { formatMinorCurrency } from '../lib/money';
import { colorVar } from '../lib/palette';
import { dayLabel, describeTransaction, groupByDay, type DayGroup } from '../lib/transactions';
import {
  filtersToApiQuery,
  filtersToSearch,
  hasActiveFilters,
  type TxFilters,
} from '../lib/txFilters';
import { EntityIcon } from '../ui/EntityIcon';
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
  onOpen,
}: {
  group: DayGroup;
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
          {group.nets.map((n) => (
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
          <TxRow key={tx.id} tx={tx} accounts={accounts} categories={categories} onOpen={onOpen} />
        ))}
      </ul>
    </section>
  );
}

function TxRow({
  tx,
  accounts,
  categories,
  onOpen,
}: {
  tx: ApiTransaction;
  accounts: ReadonlyMap<string, ApiAccount>;
  categories: ReturnType<typeof indexCategories>;
  onOpen: (tx: ApiTransaction) => void;
}) {
  const m = describeTransaction(tx, accounts, categories);
  const editable = tx.kind !== 'adjustment';
  const body = (
    <>
      <span
        className={classes.icon}
        style={{ '--cat': colorVar(m.category?.color, 7) } as React.CSSProperties}
        aria-hidden
      >
        <EntityIcon
          name={m.category?.icon}
          fallback={tx.kind === 'transfer' ? 'cash' : 'receipt'}
        />
      </span>
      <span className={classes.main}>
        <Text span fw={500} truncate className={classes.title}>
          {m.title}
        </Text>
        {m.detail && (
          <Text span size="sm" c="dimmed" truncate>
            {m.detail}
          </Text>
        )}
        {m.accountName && (
          <Text span size="sm" c="dimmed" truncate className={classes.accountMobile}>
            {m.accountName}
          </Text>
        )}
      </span>
      <Text span size="sm" c="dimmed" truncate className={classes.account}>
        {m.accountName}
      </Text>
      <span className={classes.amountCell}>
        <Amount
          minor={m.amount.minor}
          currency={m.amount.currency}
          tone={m.amount.tone}
          className={classes.amountText}
        />
        {m.feeMinor && (
          <Text span size="xs" c="dimmed" className={classes.fee}>
            biaya {formatMinorCurrency(m.feeMinor, m.amount.currency)}
          </Text>
        )}
      </span>
    </>
  );
  return (
    <li className={classes.item}>
      {editable ? (
        <UnstyledButton className={classes.row} onClick={() => onOpen(tx)}>
          {body}
        </UnstyledButton>
      ) : (
        <div className={classes.row}>{body}</div>
      )}
    </li>
  );
}
