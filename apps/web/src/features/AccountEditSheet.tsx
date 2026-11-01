import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  createAccountGroup,
  deleteAccount,
  fetchAccountGroups,
  fetchAccountTypes,
  fetchCurrencies,
  setAccountArchived,
  updateAccount,
  type AccountPayload,
  type ApiAccount,
} from '../lib/api';
import { friendlyError } from '../lib/errors';
import { notifyError, notifySuccess } from '../lib/notify';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ResponsiveFormSheet } from '../ui/ResponsiveFormSheet';
import { AccountForm } from './AccountForm';

/**
 * "Ubah akun" sheet (AccountForm with archive / delete) for one existing account. The page that
 * hosts it decides what happens after an archive or delete (`onGone`, e.g. navigate to /akun).
 */
export function AccountEditSheet({
  account,
  opened,
  onClose,
  onGone,
}: {
  account: ApiAccount;
  opened: boolean;
  onClose: () => void;
  onGone: () => void;
}) {
  const qc = useQueryClient();
  const types = useQuery({
    queryKey: ['account-types'],
    queryFn: fetchAccountTypes,
    enabled: opened,
  });
  const groups = useQuery({
    queryKey: ['account-groups'],
    queryFn: fetchAccountGroups,
    enabled: opened,
  });
  const currencies = useQuery({
    queryKey: ['currencies'],
    queryFn: fetchCurrencies,
    staleTime: Infinity,
    enabled: opened,
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['accounts'] }),
      qc.invalidateQueries({ queryKey: ['reports'] }),
    ]);
  const close = () => {
    setFormError(null);
    onClose();
  };
  const fail = (e: unknown, set: (m: string) => void) => {
    const msg = friendlyError(e, 'account');
    set(msg);
    notifyError(msg);
  };

  const save = useMutation({
    mutationFn: (payload: AccountPayload) => updateAccount(account.id, payload),
    onSuccess: async () => {
      await refresh();
      close();
      notifySuccess('Akun diperbarui');
    },
    onError: (e) => fail(e, setFormError),
  });
  const archive = useMutation({
    mutationFn: () => setAccountArchived(account.id, account.archived_at === null),
    onSuccess: async () => {
      const archived = account.archived_at === null;
      await refresh();
      close();
      notifySuccess(archived ? 'Akun diarsipkan' : 'Akun diaktifkan kembali');
      if (archived) onGone();
    },
    onError: (e) => fail(e, setFormError),
  });
  const remove = useMutation({
    mutationFn: () => deleteAccount(account.id),
    onSuccess: async () => {
      await refresh();
      setConfirmDelete(false);
      close();
      notifySuccess('Akun dihapus');
      onGone();
    },
    onError: (e) => fail(e, setDeleteError),
  });
  const createGroup = useMutation({
    mutationFn: createAccountGroup,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['account-groups'] }),
  });

  return (
    <>
      <ResponsiveFormSheet opened={opened} onClose={close} title="Ubah akun">
        {types.data && groups.data && (
          <AccountForm
            key={account.id}
            account={account}
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
            onToggleArchive={() => archive.mutate()}
            onDelete={() => {
              setDeleteError(null);
              setConfirmDelete(true);
            }}
          />
        )}
      </ResponsiveFormSheet>
      <ConfirmDialog
        opened={confirmDelete}
        title="Hapus akun?"
        message={`Akun "${account.name}" akan dihapus permanen. Akun yang sudah punya transaksi tidak bisa dihapus; arsipkan saja.`}
        confirmLabel="Hapus"
        loading={remove.isPending}
        error={deleteError}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
