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
} from '@mantine/core';
import {
  IconAlertCircle,
  IconBuildingBank,
  IconCategory,
  IconChevronLeft,
  IconChevronRight,
  IconCoin,
  IconPlus,
  IconReceipt,
  IconWallet,
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { useMemo, useState } from 'react';
import { Amount } from '../components/Amount';
import { TransactionRow } from '../features/TransactionRow';
import { useTransactionSheet } from '../features/TransactionSheetContext';
import {
  fetchAccounts,
  fetchCategories,
  fetchFxRates,
  fetchMonthlySummary,
  fetchNetWorth,
  fetchNetWorthHistory,
  fetchSettings,
  fetchTransactionPage,
  type MonthlyCategory,
  type MonthlySummary,
} from '../lib/api';
import { indexCategories } from '../lib/categories';
import { todayJakarta } from '../lib/dates';
import { dayjs } from '../lib/dayjs';
import { canGoNext, categoryLink, changePct, monthLabel, paceHint, shiftMonth } from '../lib/home';
import { colorVar } from '../lib/palette';
import type { FxContext } from '../lib/transactions';
import { EntityIcon } from '../ui/EntityIcon';
import { Sparkline } from '../ui/Sparkline';
import classes from './BerandaPage.module.css';

const RECENT = 6;

const greeting = (): string => {
  const h = Number(new Date(Date.now() + 7 * 3600_000).toISOString().slice(11, 13));
  return h < 11
    ? 'Selamat pagi'
    : h < 15
      ? 'Selamat siang'
      : h < 18
        ? 'Selamat sore'
        : 'Selamat malam';
};

function CardError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <Alert color="gray" icon={<IconAlertCircle size={20} stroke={1.75} />} title="Gagal memuat">
      <Stack gap="sm" align="flex-start">
        <Text size="sm">{what} belum bisa ditampilkan.</Text>
        <Button variant="default" size="xs" onClick={onRetry}>
          Coba lagi
        </Button>
      </Stack>
    </Alert>
  );
}

export function BerandaPage() {
  const today = todayJakarta();
  const [month, setMonth] = useState(today.slice(0, 7));
  const { openCreate } = useTransactionSheet();

  const summary = useQuery({
    queryKey: ['reports', 'monthly-summary', month],
    queryFn: () => fetchMonthlySummary(month),
  });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: fetchAccounts });
  const recent = useQuery({
    queryKey: ['transactions', 'recent'],
    queryFn: () => fetchTransactionPage(`limit=${RECENT}`),
  });

  // A brand-new workspace (no accounts, no transactions): one welcome card instead of empty cards.
  const fresh =
    accounts.data?.length === 0 && recent.data !== undefined && recent.data.data.length === 0;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end" wrap="nowrap">
        <Stack gap={2}>
          <Text size="sm" c="dimmed" fw={500}>
            {greeting()}
          </Text>
          <Title order={2}>{monthLabel(month)}</Title>
        </Stack>
        <Group gap="xs" wrap="nowrap">
          <ActionIcon
            variant="default"
            size="lg"
            aria-label="Bulan sebelumnya"
            onClick={() => setMonth(shiftMonth(month, -1))}
          >
            <IconChevronLeft size={20} stroke={1.75} />
          </ActionIcon>
          <ActionIcon
            variant="default"
            size="lg"
            aria-label="Bulan berikutnya"
            disabled={!canGoNext(month, today)}
            onClick={() => setMonth(shiftMonth(month, 1))}
          >
            <IconChevronRight size={20} stroke={1.75} />
          </ActionIcon>
        </Group>
      </Group>

      {fresh ? (
        <Card>
          <Stack align="center" gap="xs" py="lg">
            <IconWallet size={32} stroke={1.75} />
            <Text fw={600}>Selamat datang di Finhub</Text>
            <Text size="sm" c="dimmed" ta="center">
              Mulai dengan menambahkan akun, lalu catat transaksi pertamamu.
            </Text>
            <Group justify="center">
              <Button component={Link} to="/akun" variant="default">
                Tambah akun
              </Button>
              <Button leftSection={<IconPlus size={18} stroke={1.75} />} onClick={openCreate}>
                Tambah transaksi
              </Button>
            </Group>
          </Stack>
        </Card>
      ) : (
        <div className={classes.grid}>
          <div className={classes.spending}>
            <SpendingCard month={month} today={today} query={summary} />
          </div>
          <div className={classes.categories}>
            <CategoriesCard month={month} query={summary} />
          </div>
          <div className={classes.networth}>
            <NetWorthCard />
          </div>
          <div className={classes.recent}>
            <RecentCard />
          </div>
        </div>
      )}

      <div className={classes.quick} role="navigation" aria-label="Pintasan">
        <Button
          variant="default"
          leftSection={<IconPlus size={18} stroke={1.75} />}
          onClick={openCreate}
        >
          Tambah transaksi
        </Button>
        <Button
          component={Link}
          to="/akun"
          variant="default"
          leftSection={<IconBuildingBank size={18} stroke={1.75} />}
        >
          Akun
        </Button>
        <Button
          component={Link}
          to="/kategori"
          variant="default"
          leftSection={<IconCategory size={18} stroke={1.75} />}
        >
          Kategori
        </Button>
        <Button
          component={Link}
          to="/kekayaan"
          variant="default"
          leftSection={<IconCoin size={18} stroke={1.75} />}
        >
          Kekayaan
        </Button>
      </div>
    </Stack>
  );
}

type SummaryQuery = ReturnType<typeof useQuery<MonthlySummary>>;

function SpendingCard({
  month,
  today,
  query,
}: {
  month: string;
  today: string;
  query: SummaryQuery;
}) {
  const s = query.data;
  const isCurrent = month === today.slice(0, 7);
  return (
    <Card>
      <Stack gap="md">
        <Text fw={600}>Pengeluaran</Text>
        {query.isError ? (
          <CardError what="Ringkasan bulan ini" onRetry={() => void query.refetch()} />
        ) : !s ? (
          <Stack gap="xs" aria-busy="true" aria-label="Memuat">
            <Skeleton height={40} width="60%" />
            <Skeleton height={14} width="80%" />
            <Skeleton height={48} />
          </Stack>
        ) : (
          <SpendingBody s={s} isCurrent={isCurrent} />
        )}
      </Stack>
    </Card>
  );
}

function SpendingBody({ s, isCurrent }: { s: MonthlySummary; isCurrent: boolean }) {
  const cur = BigInt(s.current.expense_minor);
  const prev = BigInt(s.previous.expense_minor);
  const pct = changePct(cur, prev);
  const pace = paceHint(s.expense_vs_previous_to_date_minor, isCurrent);
  const empty = s.transaction_count === 0 && cur === 0n && BigInt(s.current.income_minor) === 0n;
  return (
    <>
      <Stack gap={4}>
        <Title order={1} component="div">
          <Amount minor={s.current.expense_minor} currency={s.base_currency} hero tone="neutral" />
        </Title>
        <Group gap="xs">
          <Text size="sm" c="dimmed">
            Bulan lalu{' '}
            <Amount minor={s.previous.expense_minor} currency={s.base_currency} tone="dimmed" />
          </Text>
          {pct !== null && (
            <Badge variant="light" color="gray" aria-label="Perubahan dari bulan lalu">
              {pct > 0 ? '+' : ''}
              {pct}%
            </Badge>
          )}
        </Group>
        {!empty && prev > 0n && (
          <Text size="sm" className={clsx(pace.tone === 'over' && classes.over)}>
            {pace.text}
          </Text>
        )}
      </Stack>
      {empty && (
        <Text size="sm" c="dimmed">
          Belum ada transaksi bulan ini.
        </Text>
      )}
      <div className={classes.totals}>
        <div>
          <Text size="xs" c="dimmed">
            Pemasukan
          </Text>
          <Amount minor={s.current.income_minor} currency={s.base_currency} tone="income" />
        </div>
        <div>
          <Text size="xs" c="dimmed">
            Selisih
          </Text>
          <Amount minor={s.current.net_minor} currency={s.base_currency} />
        </div>
      </div>
      {s.unconverted_count > 0 && (
        <Text size="xs" c="dimmed">
          {s.unconverted_count} transaksi mata uang asing belum dihitung (kurs belum ada).
        </Text>
      )}
    </>
  );
}

function CategoriesCard({ month, query }: { month: string; query: SummaryQuery }) {
  const s = query.data;
  return (
    <Card>
      <Stack gap="md">
        <Text fw={600}>Kategori teratas</Text>
        {query.isError ? (
          <CardError what="Kategori" onRetry={() => void query.refetch()} />
        ) : !s ? (
          <Stack gap="sm" aria-busy="true" aria-label="Memuat">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={40} />
            ))}
          </Stack>
        ) : s.top_categories.length === 0 ? (
          <Text size="sm" c="dimmed">
            Belum ada pengeluaran bulan ini.
          </Text>
        ) : (
          <ul className={classes.cats}>
            {s.top_categories.map((c) => (
              <li key={c.category_id ?? 'other'}>
                <CategoryBar c={c} month={month} currency={s.base_currency} />
              </li>
            ))}
          </ul>
        )}
      </Stack>
    </Card>
  );
}

const pctText = (bps: number) =>
  `${(bps / 100).toLocaleString('id-ID', { maximumFractionDigits: 0 })}%`;

function CategoryBar({
  c,
  month,
  currency,
}: {
  c: MonthlyCategory;
  month: string;
  currency: string;
}) {
  const body = (
    <>
      <span
        className={classes.catIcon}
        style={{ '--cat': colorVar(c.color, 7) } as React.CSSProperties}
        aria-hidden
      >
        <EntityIcon name={c.icon} fallback="category" size={18} />
      </span>
      <span className={classes.catMain}>
        <span className={classes.catHead}>
          <Text span fw={500} truncate>
            {c.name}
          </Text>
          <span className={classes.catAmount}>
            <Amount minor={c.amount_minor} currency={currency} tone="neutral" />
            <Text span size="xs" c="dimmed">
              {pctText(c.share_bps)}
            </Text>
          </span>
        </span>
        <span className={classes.bar} aria-hidden>
          <span
            className={classes.fill}
            style={
              {
                '--w': `${Math.max(c.share_bps / 100, 1)}%`,
                '--cat': colorVar(c.color, 6),
              } as React.CSSProperties
            }
          />
        </span>
      </span>
    </>
  );
  if (c.is_other || !c.category_id) return <div className={classes.cat}>{body}</div>;
  return (
    <Link
      to="/transaksi"
      search={categoryLink(c.category_id, month)}
      className={clsx(classes.cat, classes.catLink)}
      aria-label={`${c.name}: lihat transaksi`}
    >
      {body}
    </Link>
  );
}

function NetWorthCard() {
  const nw = useQuery({ queryKey: ['reports', 'net-worth'], queryFn: fetchNetWorth });
  const history = useQuery({
    queryKey: ['reports', 'net-worth-history', 6],
    queryFn: () => fetchNetWorthHistory(6),
  });
  const points = history.data?.points ?? [];
  const first = points[0];
  const last = points.at(-1);
  return (
    <Card>
      <Stack gap="md">
        <Group justify="space-between">
          <Text fw={600}>Kekayaan bersih</Text>
          <Text component={Link} to="/kekayaan" size="sm" c="dimmed" className={classes.more}>
            Rincian
          </Text>
        </Group>
        {nw.isError ? (
          <CardError what="Kekayaan bersih" onRetry={() => void nw.refetch()} />
        ) : !nw.data ? (
          <Stack gap="xs" aria-busy="true" aria-label="Memuat">
            <Skeleton height={36} width="55%" />
            <Skeleton height={96} />
          </Stack>
        ) : (
          <>
            <Title order={2} component="div">
              <Amount minor={nw.data.net_worth_minor} currency={nw.data.base_currency} hero />
            </Title>
            {history.isPending ? (
              <Skeleton height={96} aria-label="Memuat tren" />
            ) : history.isError || points.length < 2 ? (
              <Text size="sm" c="dimmed">
                Tren belum tersedia.
              </Text>
            ) : (
              <div>
                <Sparkline
                  values={points.map((p) => p.net_worth_minor)}
                  label="Tren kekayaan bersih 6 bulan terakhir"
                />
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">
                    {dayjs(first!.date).format('MMM YYYY')}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {dayjs(last!.date).format('MMM YYYY')}
                  </Text>
                </Group>
              </div>
            )}
          </>
        )}
      </Stack>
    </Card>
  );
}

function RecentCard() {
  const { openEdit, openCreate } = useTransactionSheet();
  const recent = useQuery({
    queryKey: ['transactions', 'recent'],
    queryFn: () => fetchTransactionPage(`limit=${RECENT}`),
  });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: fetchAccounts });
  const categories = useQuery({ queryKey: ['categories'], queryFn: fetchCategories });
  const settings = useQuery({ queryKey: ['settings'], queryFn: fetchSettings, staleTime: 60_000 });
  const fxRates = useQuery({ queryKey: ['fx-rates'], queryFn: fetchFxRates, staleTime: 60_000 });

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
  const items = recent.data?.data ?? [];

  return (
    <Card p={0} className={classes.recentCard}>
      <Group justify="space-between" px="lg" pt="md" pb="xs">
        <Text fw={600}>Transaksi terbaru</Text>
        <Text component={Link} to="/transaksi" size="sm" c="dimmed" className={classes.more}>
          Lihat semua
        </Text>
      </Group>
      {recent.isError ? (
        <Stack p="lg" pt="xs">
          <CardError what="Transaksi terbaru" onRetry={() => void recent.refetch()} />
        </Stack>
      ) : recent.isPending ? (
        <Stack gap="xs" p="lg" pt="xs" aria-busy="true" aria-label="Memuat">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={48} />
          ))}
        </Stack>
      ) : items.length === 0 ? (
        <Stack align="center" gap="xs" p="lg" pt="xs">
          <IconReceipt size={28} stroke={1.75} />
          <Text size="sm" c="dimmed">
            Belum ada transaksi.
          </Text>
          <Button variant="default" size="xs" onClick={openCreate}>
            Tambah transaksi
          </Button>
        </Stack>
      ) : (
        <ul className={classes.list}>
          {items.map((tx) => (
            <TransactionRow
              key={tx.id}
              tx={tx}
              accounts={accountById}
              categories={categoryInfo}
              fx={fx}
              onOpen={openEdit}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}
