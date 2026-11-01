import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Skeleton,
  Stack,
  Switch,
  Text,
  Title,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconArrowDown,
  IconArrowUp,
  IconArrowsSort,
  IconPlus,
  IconWallet,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Amount } from '../components/Amount';
import { AccountAmount } from '../components/AccountAmount';
import { AccountForm } from '../features/AccountForm';
import {
  createAccount,
  createAccountGroup,
  fetchAccountGroups,
  fetchAccountTypes,
  fetchAccounts,
  fetchBalances,
  fetchCurrencies,
  fetchNetWorth,
  reorderAccounts,
  type AccountPayload,
} from '../lib/api';
import {
  buildAccountSections,
  moveItem,
  resolveNatives,
  resolveValues,
  type AccountRow,
  type AccountSection,
} from '../lib/accounts';
import { friendlyError } from '../lib/errors';
import { notifyError, notifySuccess } from '../lib/notify';
import { colorVar } from '../lib/palette';
import { EntityIcon } from '../ui/EntityIcon';
import { ResponsiveFormSheet } from '../ui/ResponsiveFormSheet';
import classes from './AccountsPage.module.css';

export function AccountsPage() {
  const qc = useQueryClient();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: fetchAccounts });
  const types = useQuery({ queryKey: ['account-types'], queryFn: fetchAccountTypes });
  const groups = useQuery({ queryKey: ['account-groups'], queryFn: fetchAccountGroups });
  const currencies = useQuery({
    queryKey: ['currencies'],
    queryFn: fetchCurrencies,
    staleTime: Infinity,
  });
  // Values are best effort: a failing report must not hide the account list.
  const balances = useQuery({ queryKey: ['reports', 'balances'], queryFn: fetchBalances });
  const netWorth = useQuery({ queryKey: ['reports', 'net-worth'], queryFn: fetchNetWorth });

  // Editing an account lives on its detail page (/akun/:id); this page only creates.
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [sorting, setSorting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['accounts'] }),
      qc.invalidateQueries({ queryKey: ['reports'] }),
    ]);
  const closeSheet = () => {
    setCreating(false);
    setFormError(null);
  };

  const save = useMutation({
    mutationFn: (payload: AccountPayload) => createAccount(payload),
    onSuccess: async () => {
      await refresh();
      closeSheet();
      notifySuccess('Akun ditambahkan');
    },
    onError: (e) => {
      const msg = friendlyError(e, 'account');
      setFormError(msg);
      notifyError(msg);
    },
  });
  const reorder = useMutation({
    mutationFn: reorderAccounts,
    onSuccess: refresh,
  });
  const createGroup = useMutation({
    mutationFn: createAccountGroup,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['account-groups'] }),
  });

  if (accounts.isError || types.isError || groups.isError) {
    return (
      <Alert
        color="gray"
        icon={<IconAlertCircle size={20} stroke={1.75} />}
        title="Gagal memuat data"
      >
        <Stack gap="sm" align="flex-start">
          <Text size="sm">Daftar akun belum bisa ditampilkan. Periksa koneksi lalu coba lagi.</Text>
          <Button
            variant="default"
            size="xs"
            onClick={() =>
              void Promise.all([accounts.refetch(), types.refetch(), groups.refetch()])
            }
          >
            Coba lagi
          </Button>
        </Stack>
      </Alert>
    );
  }
  if (!accounts.data || !types.data || !groups.data) {
    return (
      <Stack gap="md" aria-busy="true" aria-label="Memuat">
        <Skeleton height={32} width={160} />
        <Skeleton height={220} radius="lg" />
      </Stack>
    );
  }

  const values = resolveValues(balances.data, netWorth.data);
  const sections = buildAccountSections({
    accounts: accounts.data,
    types: types.data,
    groups: groups.data,
    values,
    natives: resolveNatives(balances.data, netWorth.data),
    showArchived,
  });
  const baseCurrency = netWorth.data?.base_currency ?? balances.data?.base_currency ?? 'IDR';
  const hasArchived = accounts.data.some((a) => a.archived_at !== null);
  const openCreate = () => setCreating(true);

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center">
        <Title order={2}>Akun</Title>
        <Group gap="xs">
          {accounts.data.length > 1 && (
            <Button
              variant={sorting ? 'light' : 'default'}
              leftSection={<IconArrowsSort size={18} stroke={1.75} />}
              aria-pressed={sorting}
              onClick={() => setSorting((s) => !s)}
            >
              {sorting ? 'Selesai' : 'Urutkan'}
            </Button>
          )}
          <Button leftSection={<IconPlus size={18} stroke={1.75} />} onClick={openCreate}>
            Tambah akun
          </Button>
        </Group>
      </Group>

      {hasArchived && (
        <Switch
          label="Tampilkan arsip"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.currentTarget.checked)}
        />
      )}

      {sections.length === 0 ? (
        <Card className={classes.empty}>
          <Stack align="center" gap="xs">
            <IconWallet size={36} stroke={1.75} />
            <Title order={3}>Belum ada akun</Title>
            <Text size="sm" c="dimmed" maw={360}>
              Tambahkan rekening, e-wallet, atau kas untuk mulai mencatat dan melihat kekayaan
              bersih Anda.
            </Text>
            <Button mt="xs" leftSection={<IconPlus size={18} stroke={1.75} />} onClick={openCreate}>
              Tambah akun pertama
            </Button>
          </Stack>
        </Card>
      ) : (
        sections.map((section) => (
          <SectionCard
            key={section.kind}
            section={section}
            baseCurrency={baseCurrency}
            sorting={sorting}
            onMove={(id, dir) => {
              const updates = moveItem(
                section.rows.map((r) => ({ id: r.account.id, sort_order: r.account.sort_order })),
                id,
                dir,
              );
              if (updates.length) reorder.mutate(updates);
            }}
          />
        ))
      )}

      <ResponsiveFormSheet opened={creating} onClose={closeSheet} title="Tambah akun">
        {creating && types.data && groups.data && (
          <AccountForm
            key="new"
            types={types.data}
            groups={groups.data}
            currencies={currencies.data ?? []}
            submitting={save.isPending}
            error={formError}
            onSubmit={(payload) => {
              setFormError(null);
              save.mutate(payload);
            }}
            onCreateGroup={(name) => createGroup.mutateAsync(name)}
          />
        )}
      </ResponsiveFormSheet>
    </Stack>
  );
}

function SectionCard({
  section,
  baseCurrency,
  sorting,
  onMove,
}: {
  section: AccountSection;
  baseCurrency: string;
  sorting: boolean;
  onMove: (id: string, dir: 'up' | 'down') => void;
}) {
  return (
    <Card padding={0} aria-label={section.label} component="section">
      <Group justify="space-between" wrap="nowrap" className={classes.sectionHead}>
        <Text fw={600}>{section.label}</Text>
        <Text fw={600} component="div">
          <Amount minor={section.total} tone={section.kind === 'liability' ? 'neutral' : 'plain'} />
        </Text>
      </Group>
      <ul className={classes.list}>
        {section.rows.map((row, i) => (
          <li key={row.account.id} className={classes.item}>
            <AccountLine row={row} baseCurrency={baseCurrency} />
            {sorting && (
              <Group gap={2} wrap="nowrap" className={classes.moves}>
                <ActionIcon
                  size="lg"
                  aria-label={`Naikkan ${row.account.name}`}
                  disabled={i === 0}
                  onClick={() => onMove(row.account.id, 'up')}
                >
                  <IconArrowUp size={18} stroke={1.75} />
                </ActionIcon>
                <ActionIcon
                  size="lg"
                  aria-label={`Turunkan ${row.account.name}`}
                  disabled={i === section.rows.length - 1}
                  onClick={() => onMove(row.account.id, 'down')}
                >
                  <IconArrowDown size={18} stroke={1.75} />
                </ActionIcon>
              </Group>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AccountLine({ row, baseCurrency }: { row: AccountRow; baseCurrency: string }) {
  const { account } = row;
  return (
    <Link
      to="/akun/$accountId"
      params={{ accountId: account.id }}
      className={classes.row}
      data-archived={row.archived || undefined}
      aria-label={`Buka ${account.name}`}
    >
      <span className={classes.icon}>
        <EntityIcon name={account.icon ?? row.typeIcon} />
      </span>
      <span className={classes.name}>
        <span
          className={classes.dot}
          style={{ '--dot': colorVar(account.color) } as React.CSSProperties}
          aria-hidden
        />
        <Text span fw={500} truncate>
          {account.name}
        </Text>
        {account.currency !== baseCurrency && (
          <Badge size="sm" variant="light" className={classes.currencyBadge}>
            {account.currency}
          </Badge>
        )}
        {row.archived && (
          <Badge size="sm" variant="default">
            Arsip
          </Badge>
        )}
      </span>
      <Text span size="sm" c="dimmed" className={classes.meta} truncate>
        {row.typeName}
        {row.groupName ? ` · ${row.groupName}` : ''}
      </Text>
      <Text
        component="span"
        className={classes.amount}
        c={row.value === null ? 'dimmed' : undefined}
      >
        <AccountAmount
          currency={account.currency}
          native={row.native}
          base={row.value}
          baseCurrency={baseCurrency}
          tone={row.kind === 'liability' ? 'neutral' : 'plain'}
        />
      </Text>
    </Link>
  );
}
