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
  UnstyledButton,
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
import { useState } from 'react';
import { Amount } from '../components/Amount';
import { AccountForm } from '../features/AccountForm';
import {
  createAccount,
  createAccountGroup,
  deleteAccount,
  fetchAccountGroups,
  fetchAccountTypes,
  fetchAccounts,
  fetchBalances,
  fetchCurrencies,
  fetchNetWorth,
  reorderAccounts,
  setAccountArchived,
  updateAccount,
  type AccountPayload,
  type ApiAccount,
} from '../lib/api';
import {
  buildAccountSections,
  moveItem,
  resolveValues,
  type AccountRow,
  type AccountSection,
} from '../lib/accounts';
import { friendlyError } from '../lib/errors';
import { colorVar } from '../lib/palette';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { EntityIcon } from '../ui/EntityIcon';
import { ResponsiveFormSheet } from '../ui/ResponsiveFormSheet';
import classes from './AccountsPage.module.css';

type Sheet = { mode: 'create' } | { mode: 'edit'; account: ApiAccount } | null;

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

  const [sheet, setSheet] = useState<Sheet>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [sorting, setSorting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ApiAccount | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['accounts'] }),
      qc.invalidateQueries({ queryKey: ['reports'] }),
    ]);
  const closeSheet = () => {
    setSheet(null);
    setFormError(null);
  };

  const save = useMutation({
    mutationFn: (payload: AccountPayload) =>
      sheet?.mode === 'edit' ? updateAccount(sheet.account.id, payload) : createAccount(payload),
    onSuccess: async () => {
      await refresh();
      closeSheet();
    },
    onError: (e) => setFormError(friendlyError(e, 'account')),
  });
  const archive = useMutation({
    mutationFn: (a: ApiAccount) => setAccountArchived(a.id, a.archived_at === null),
    onSuccess: async () => {
      await refresh();
      closeSheet();
    },
    onError: (e) => setFormError(friendlyError(e, 'account')),
  });
  const remove = useMutation({
    mutationFn: (a: ApiAccount) => deleteAccount(a.id),
    onSuccess: async () => {
      await refresh();
      setConfirmDelete(null);
      closeSheet();
    },
    onError: (e) => setDeleteError(friendlyError(e, 'account')),
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
    showArchived,
  });
  const baseCurrency = netWorth.data?.base_currency ?? balances.data?.base_currency ?? 'IDR';
  const hasArchived = accounts.data.some((a) => a.archived_at !== null);
  const openCreate = () => setSheet({ mode: 'create' });

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
            onEdit={(account) => setSheet({ mode: 'edit', account })}
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

      <ResponsiveFormSheet
        opened={sheet !== null}
        onClose={closeSheet}
        title={sheet?.mode === 'edit' ? 'Ubah akun' : 'Tambah akun'}
      >
        {sheet && types.data && groups.data && (
          <AccountForm
            key={sheet.mode === 'edit' ? sheet.account.id : 'new'}
            account={sheet.mode === 'edit' ? sheet.account : undefined}
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
            onToggleArchive={
              sheet.mode === 'edit' ? () => archive.mutate(sheet.account) : undefined
            }
            onDelete={
              sheet.mode === 'edit'
                ? () => {
                    setDeleteError(null);
                    setConfirmDelete(sheet.account);
                  }
                : undefined
            }
          />
        )}
      </ResponsiveFormSheet>

      <ConfirmDialog
        opened={confirmDelete !== null}
        title="Hapus akun?"
        message={`Akun "${confirmDelete?.name ?? ''}" akan dihapus permanen. Akun yang sudah punya transaksi tidak bisa dihapus; arsipkan saja.`}
        confirmLabel="Hapus"
        loading={remove.isPending}
        error={deleteError}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && remove.mutate(confirmDelete)}
      />
    </Stack>
  );
}

function SectionCard({
  section,
  baseCurrency,
  sorting,
  onEdit,
  onMove,
}: {
  section: AccountSection;
  baseCurrency: string;
  sorting: boolean;
  onEdit: (a: ApiAccount) => void;
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
            <AccountLine row={row} baseCurrency={baseCurrency} onEdit={onEdit} />
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

function AccountLine({
  row,
  baseCurrency,
  onEdit,
}: {
  row: AccountRow;
  baseCurrency: string;
  onEdit: (a: ApiAccount) => void;
}) {
  const { account } = row;
  return (
    <UnstyledButton
      className={classes.row}
      data-archived={row.archived || undefined}
      aria-label={`Ubah ${account.name}`}
      onClick={() => onEdit(account)}
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
          <Badge size="sm" variant="light">
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
        <Amount minor={row.value} tone={row.kind === 'liability' ? 'neutral' : 'plain'} />
      </Text>
    </UnstyledButton>
  );
}
