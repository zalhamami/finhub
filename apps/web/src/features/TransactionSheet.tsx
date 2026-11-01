import { Skeleton, Stack } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  createTransaction,
  createTransfer,
  deleteTransaction,
  fetchAccountTypes,
  fetchAccounts,
  fetchBalances,
  fetchCategories,
  updateTransaction,
} from '../lib/api';
import { defaultFeeCategory, indexCategories } from '../lib/categories';
import { friendlyError } from '../lib/errors';
import { formatMinorCurrency } from '../lib/money';
import { notifyError, notifySuccess } from '../lib/notify';
import {
  newTxForm,
  transactionToForm,
  type TxFormValues,
  type TxPayload,
} from '../lib/transactions';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ResponsiveFormSheet } from '../ui/ResponsiveFormSheet';
import { TransactionForm } from './TransactionForm';
import type { SheetState } from './TransactionSheetContext';

/** Add / edit sheet: loads the lookups, runs the mutations, invalidates the affected queries. */
export default function TransactionSheet({
  sheet,
  opened,
  onClose,
}: {
  sheet: SheetState;
  opened: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const enabled = opened;
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: fetchAccounts, enabled });
  const types = useQuery({ queryKey: ['account-types'], queryFn: fetchAccountTypes, enabled });
  const categories = useQuery({ queryKey: ['categories'], queryFn: fetchCategories, enabled });
  // balances are a nicety: a failing report must not block entering a transaction
  const balances = useQuery({ queryKey: ['reports', 'balances'], queryFn: fetchBalances, enabled });

  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['transactions'] }),
      qc.invalidateQueries({ queryKey: ['accounts'] }),
      qc.invalidateQueries({ queryKey: ['reports'] }),
    ]);

  const save = useMutation({
    mutationFn: (payload: TxPayload) => {
      if (sheet.mode === 'edit') {
        if (payload.type === 'transfer') return updateTransaction(sheet.tx.id, payload.body);
        const b = payload.body;
        // the kind of an existing transaction cannot change, so it is not sent
        return updateTransaction(sheet.tx.id, {
          account_id: b.account_id,
          amount_minor: b.amount_minor,
          category_id: b.category_id,
          occurred_at: b.occurred_at,
          note: b.note,
          payee: b.payee,
        });
      }
      return payload.type === 'transfer'
        ? createTransfer(payload.body)
        : createTransaction(payload.body);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteTransaction(id),
    onSuccess: async () => {
      await refresh();
      setConfirmDelete(false);
      onClose();
      notifySuccess('Transaksi dihapus');
    },
    onError: (e) => {
      const msg = friendlyError(e, 'transaction');
      setDeleteError(msg);
      notifyError(msg);
    },
  });

  // Own-currency balance per account, plus the base-currency value (null = no FX rate).
  const { balanceMap, baseValueMap } = useMemo(() => {
    const native = new Map<string, string>();
    const base = new Map<string, string | null>();
    for (const g of balances.data?.groups ?? [])
      for (const a of g.accounts) {
        native.set(a.id, a.balance_minor);
        base.set(a.id, a.value_base_minor);
      }
    return { balanceMap: native, baseValueMap: base };
  }, [balances.data]);

  const initial: TxFormValues | null = useMemo(() => {
    if (!accounts.data || !categories.data) return null;
    if (sheet.mode === 'edit') return transactionToForm(sheet.tx);
    const active = accounts.data.filter((a) => !a.archived_at);
    return {
      ...newTxForm(),
      account_id: active.length === 1 ? active[0]!.id : '',
      fee_category_id: defaultFeeCategory(categories.data),
    };
  }, [sheet, accounts.data, categories.data]);

  const close = () => {
    setError(null);
    setConfirmDelete(false);
    onClose();
  };

  /** "<amount in the account currency> · <category>" or "<amount> · <from> → <to>". */
  const describeSaved = (payload: TxPayload): string => {
    const accs = accounts.data ?? [];
    const name = (id: string) => accs.find((a) => a.id === id)?.name ?? '';
    const currency = (id: string) => accs.find((a) => a.id === id)?.currency ?? 'IDR';
    if (payload.type === 'transfer') {
      const b = payload.body;
      const amount = formatMinorCurrency(b.amount_minor, currency(b.from_account_id));
      return `${amount} · ${name(b.from_account_id)} → ${name(b.to_account_id)}`;
    }
    const b = payload.body;
    const amount = formatMinorCurrency(b.amount_minor, currency(b.account_id));
    const category = categories.data
      ? (indexCategories(categories.data).get(b.category_id)?.name ?? '')
      : '';
    return `${amount} · ${category}`;
  };

  const submit = async (payload: TxPayload, addAnother: boolean) => {
    setError(null);
    try {
      await save.mutateAsync(payload);
      await refresh();
      if (sheet.mode === 'edit') notifySuccess('Transaksi diperbarui');
      else notifySuccess('Transaksi tersimpan', describeSaved(payload));
      if (!addAnother) close();
      return true;
    } catch (e) {
      const msg = friendlyError(e, 'transaction');
      setError(msg);
      notifyError(msg);
      return false;
    }
  };

  const loadFailed = accounts.isError || categories.isError || types.isError;
  return (
    <>
      <ResponsiveFormSheet
        opened={opened}
        onClose={close}
        title={sheet.mode === 'edit' ? 'Ubah transaksi' : 'Tambah transaksi'}
      >
        {initial && accounts.data && categories.data ? (
          <TransactionForm
            mode={sheet.mode === 'edit' ? 'edit' : 'create'}
            initial={initial}
            accounts={accounts.data}
            accountTypes={types.data ?? []}
            categories={categories.data}
            balances={balanceMap}
            baseValues={baseValueMap}
            baseCurrency={balances.data?.base_currency ?? 'IDR'}
            submitting={save.isPending}
            error={error}
            onSubmit={submit}
            onDelete={() => setConfirmDelete(true)}
          />
        ) : loadFailed || (sheet.mode === 'edit' && !initial && accounts.data) ? (
          <p role="alert">
            {sheet.mode === 'edit' && accounts.data
              ? 'Jenis transaksi ini belum bisa diubah di sini.'
              : 'Data akun dan kategori belum bisa dimuat. Tutup lalu coba lagi.'}
          </p>
        ) : (
          <Stack gap="md" aria-busy="true" aria-label="Memuat">
            <Skeleton height={36} />
            <Skeleton height={56} />
            <Skeleton height={56} />
          </Stack>
        )}
      </ResponsiveFormSheet>
      <ConfirmDialog
        opened={confirmDelete}
        title="Hapus transaksi?"
        message="Transaksi ini akan dihapus permanen dan saldo akun dihitung ulang."
        confirmLabel="Hapus"
        loading={remove.isPending}
        error={deleteError}
        onConfirm={() => {
          setDeleteError(null);
          if (sheet.mode === 'edit') remove.mutate(sheet.tx.id);
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  );
}
