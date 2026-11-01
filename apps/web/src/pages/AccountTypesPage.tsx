import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Skeleton,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { IconAlertCircle, IconChevronLeft, IconPlus } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { AccountTypeForm } from '../features/AccountTypeForm';
import { KIND_LABEL } from '../lib/accounts';
import {
  createAccountType,
  deleteAccountType,
  fetchAccountTypes,
  updateAccountType,
  type AccountTypePayload,
  type ApiAccountType,
} from '../lib/api';
import { friendlyError } from '../lib/errors';
import { notifyError, notifySuccess } from '../lib/notify';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { EntityIcon } from '../ui/EntityIcon';
import { ResponsiveFormSheet } from '../ui/ResponsiveFormSheet';
import classes from './AccountTypesPage.module.css';

type Sheet = { mode: 'create' } | { mode: 'edit'; type: ApiAccountType } | null;

export function AccountTypesPage() {
  const qc = useQueryClient();
  const types = useQuery({ queryKey: ['account-types'], queryFn: fetchAccountTypes });
  const [sheet, setSheet] = useState<Sheet>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ApiAccountType | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['account-types'] });
  const closeSheet = () => {
    setSheet(null);
    setFormError(null);
  };

  const save = useMutation({
    mutationFn: (payload: AccountTypePayload) => {
      if (sheet?.mode === 'edit') {
        // kind is fixed after creation: send only the editable fields
        const { name, icon, has_credit_limit, has_due_day, has_holdings } = payload;
        return updateAccountType(sheet.type.id, {
          name,
          icon,
          has_credit_limit,
          has_due_day,
          has_holdings,
        });
      }
      return createAccountType(payload);
    },
    onSuccess: async () => {
      await refresh();
      closeSheet();
      notifySuccess(sheet?.mode === 'edit' ? 'Jenis akun diperbarui' : 'Jenis akun ditambahkan');
    },
    onError: (e) => {
      const msg = friendlyError(e, 'account-type');
      setFormError(msg);
      notifyError(msg);
    },
  });
  const remove = useMutation({
    mutationFn: (t: ApiAccountType) => deleteAccountType(t.id),
    onSuccess: async () => {
      await refresh();
      setConfirmDelete(null);
      closeSheet();
      notifySuccess('Jenis akun dihapus');
    },
    onError: (e) => {
      const msg = friendlyError(e, 'account-type');
      setDeleteError(msg);
      notifyError(msg);
    },
  });

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center">
        <Stack gap={2}>
          <Text component={Link} to="/pengaturan" size="sm" className={classes.back}>
            <IconChevronLeft size={16} stroke={1.75} />
            Pengaturan
          </Text>
          <Title order={2}>Jenis akun</Title>
        </Stack>
        <Button
          leftSection={<IconPlus size={18} stroke={1.75} />}
          onClick={() => setSheet({ mode: 'create' })}
        >
          Tambah jenis
        </Button>
      </Group>

      {types.isError ? (
        <Alert
          color="gray"
          icon={<IconAlertCircle size={20} stroke={1.75} />}
          title="Gagal memuat data"
        >
          <Button variant="default" size="xs" onClick={() => void types.refetch()}>
            Coba lagi
          </Button>
        </Alert>
      ) : !types.data ? (
        <Skeleton height={240} radius="lg" aria-busy="true" aria-label="Memuat" />
      ) : (
        <Card padding={0}>
          <ul className={classes.list} aria-label="Daftar jenis akun">
            {types.data.map((t) => {
              return (
                <li key={t.id} className={classes.item}>
                  <UnstyledButton
                    className={classes.row}
                    aria-label={`Ubah ${t.name}`}
                    onClick={() => setSheet({ mode: 'edit', type: t })}
                  >
                    <span className={classes.icon}>
                      <EntityIcon name={t.icon} />
                    </span>
                    <Text fw={500} truncate>
                      {t.name}
                    </Text>
                    <Badge>{KIND_LABEL[t.kind]}</Badge>
                  </UnstyledButton>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <ResponsiveFormSheet
        opened={sheet !== null}
        onClose={closeSheet}
        title={sheet?.mode === 'edit' ? 'Ubah jenis akun' : 'Tambah jenis akun'}
      >
        {sheet && (
          <AccountTypeForm
            key={sheet.mode === 'edit' ? sheet.type.id : 'new'}
            accountType={sheet.mode === 'edit' ? sheet.type : undefined}
            submitting={save.isPending}
            error={formError}
            onSubmit={(payload) => {
              setFormError(null);
              save.mutate(payload);
            }}
            onDelete={
              sheet.mode === 'edit'
                ? () => {
                    setDeleteError(null);
                    setConfirmDelete(sheet.type);
                  }
                : undefined
            }
          />
        )}
      </ResponsiveFormSheet>

      <ConfirmDialog
        opened={confirmDelete !== null}
        title="Hapus jenis akun?"
        message={`Jenis "${confirmDelete?.name ?? ''}" akan dihapus. Jenis yang masih dipakai akun tidak bisa dihapus.`}
        confirmLabel="Hapus"
        loading={remove.isPending}
        error={deleteError}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && remove.mutate(confirmDelete)}
      />
    </Stack>
  );
}
