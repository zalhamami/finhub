import { Alert, Button, Group, Select, Stack, Switch, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconAlertCircle } from '@tabler/icons-react';
import { useState } from 'react';
import { KIND_LABEL, KIND_ORDER } from '../lib/accounts';
import type {
  AccountPayload,
  ApiAccount,
  ApiAccountGroup,
  ApiAccountType,
  ApiCurrency,
} from '../lib/api';
import { minorToInputText } from '../lib/amount';
import { ACCOUNT_ICONS } from '../lib/icons';
import {
  accountFormSchema,
  emptyAccountForm,
  zodFormResolver,
  type AccountFormValues,
} from '../lib/schemas';
import { AmountInput } from '../ui/AmountInput';
import { ColorNamePicker } from '../ui/ColorNamePicker';
import { IconPicker } from '../ui/IconPicker';

const NEW_GROUP = '__new__';

export interface AccountFormProps {
  /** present = edit mode */
  account?: ApiAccount;
  types: ApiAccountType[];
  groups: ApiAccountGroup[];
  currencies: ApiCurrency[];
  submitting?: boolean;
  /** friendly API failure text for the last submit */
  error?: string | null;
  onSubmit: (payload: AccountPayload) => void;
  onCreateGroup: (name: string) => Promise<ApiAccountGroup>;
  onToggleArchive?: () => void;
  onDelete?: () => void;
}

export function toFormValues(a: ApiAccount): AccountFormValues {
  return {
    name: a.name,
    type_id: a.type_id,
    group_id: a.group_id ?? '',
    currency: a.currency,
    opening_text: minorToInputText(a.opening_balance_minor),
    opening_date: a.opening_date ?? '',
    icon: a.icon ?? '',
    color: a.color ?? '',
    include_in_net_worth: a.include_in_net_worth,
    credit_limit_text: minorToInputText(a.credit_limit_minor),
    statement_day: a.statement_day?.toString() ?? '',
    due_day: a.due_day?.toString() ?? '',
  };
}

/** One form for create and edit; the sheet (Modal/Drawer) around it is the caller's business. */
export function AccountForm({
  account,
  types,
  groups,
  currencies,
  submitting,
  error,
  onSubmit,
  onCreateGroup,
  onToggleArchive,
  onDelete,
}: AccountFormProps) {
  const flagsOf = (typeId: string) => types.find((t) => t.id === typeId);
  const form = useForm<AccountFormValues>({
    mode: 'controlled',
    initialValues: account ? toFormValues(account) : emptyAccountForm(),
    validate: (values) =>
      zodFormResolver<AccountFormValues>(accountFormSchema(flagsOf(values.type_id)))(values),
  });
  const type = flagsOf(form.values.type_id);

  const [newGroupName, setNewGroupName] = useState<string | null>(null);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);

  const createGroup = async () => {
    const name = (newGroupName ?? '').trim();
    if (!name) return setGroupError('Nama grup wajib diisi');
    setCreatingGroup(true);
    setGroupError(null);
    try {
      const g = await onCreateGroup(name);
      form.setFieldValue('group_id', g.id);
      setNewGroupName(null);
    } catch {
      setGroupError('Grup belum bisa dibuat. Coba lagi.');
    } finally {
      setCreatingGroup(false);
    }
  };

  const typeData = KIND_ORDER.map((kind) => ({
    group: KIND_LABEL[kind],
    items: types.filter((t) => t.kind === kind).map((t) => ({ value: t.id, label: t.name })),
  })).filter((g) => g.items.length > 0);

  return (
    <form
      noValidate
      onSubmit={form.onSubmit((values) =>
        onSubmit(accountFormSchema(flagsOf(values.type_id)).parse(values)),
      )}
    >
      <Stack gap="md">
        <TextInput
          label="Nama akun"
          placeholder="mis. BCA Tahapan"
          withAsterisk
          data-autofocus
          {...form.getInputProps('name')}
        />

        <Select
          label="Jenis akun"
          placeholder="Pilih jenis"
          withAsterisk
          data={typeData}
          description={type ? `Kelompok: ${KIND_LABEL[type.kind]}` : undefined}
          {...form.getInputProps('type_id')}
        />

        <div>
          <Select
            label="Grup"
            placeholder="Tanpa grup"
            clearable
            data={[
              ...groups.map((g) => ({ value: g.id, label: g.name })),
              { value: NEW_GROUP, label: '+ Buat grup baru…' },
            ]}
            value={form.values.group_id || null}
            error={form.errors.group_id}
            onChange={(value) => {
              if (value === NEW_GROUP) setNewGroupName('');
              else form.setFieldValue('group_id', value ?? '');
            }}
          />
          {newGroupName !== null && (
            <Group mt="xs" align="flex-start" wrap="nowrap" gap="xs">
              <TextInput
                aria-label="Nama grup baru"
                placeholder="Nama grup baru"
                style={{ flex: 1 }}
                value={newGroupName}
                error={groupError}
                onChange={(e) => setNewGroupName(e.currentTarget.value)}
              />
              <Button variant="default" loading={creatingGroup} onClick={() => void createGroup()}>
                Buat grup
              </Button>
              <Button variant="subtle" onClick={() => setNewGroupName(null)}>
                Batal
              </Button>
            </Group>
          )}
        </div>

        <Select
          label="Mata uang"
          withAsterisk
          allowDeselect={false}
          data={currencies.map((c) => ({ value: c.code, label: `${c.code} (${c.symbol})` }))}
          description={account ? 'Tidak bisa diganti jika akun sudah punya transaksi.' : undefined}
          {...form.getInputProps('currency')}
        />

        <AmountInput
          label="Saldo awal"
          placeholder="mis. 1,5jt atau Rp1.250.000"
          description="Boleh dikosongkan (0). Tulis dengan awalan - untuk saldo negatif."
          currency={form.values.currency}
          {...form.getInputProps('opening_text')}
          value={form.values.opening_text}
        />

        <TextInput
          label="Tanggal saldo awal"
          type="date"
          styles={{ input: { fontSize: 16 } }}
          {...form.getInputProps('opening_date')}
        />

        {type?.has_credit_limit && (
          <AmountInput
            label="Limit kredit"
            placeholder="mis. 20jt"
            currency={form.values.currency}
            {...form.getInputProps('credit_limit_text')}
            value={form.values.credit_limit_text}
          />
        )}
        {type?.has_due_day && (
          <Group grow align="flex-start">
            <TextInput
              label="Tanggal tagihan"
              placeholder="1–31"
              inputMode="numeric"
              styles={{ input: { fontSize: 16 } }}
              {...form.getInputProps('statement_day')}
            />
            <TextInput
              label="Tanggal jatuh tempo"
              placeholder="1–31"
              inputMode="numeric"
              styles={{ input: { fontSize: 16 } }}
              {...form.getInputProps('due_day')}
            />
          </Group>
        )}

        <IconPicker
          value={form.values.icon}
          onChange={(k) => form.setFieldValue('icon', k)}
          icons={ACCOUNT_ICONS}
          error={form.errors.icon as string | undefined}
        />
        <ColorNamePicker
          value={form.values.color}
          onChange={(c) => form.setFieldValue('color', c)}
          error={form.errors.color as string | undefined}
        />

        <Switch
          label="Hitung dalam kekayaan bersih"
          {...form.getInputProps('include_in_net_worth', { type: 'checkbox' })}
        />

        {error && (
          <Alert color="gray" icon={<IconAlertCircle size={20} stroke={1.75} />} role="alert">
            {error}
          </Alert>
        )}

        <Group justify="space-between" mt="xs">
          <Group gap="xs">
            {account && onToggleArchive && (
              <Button variant="default" onClick={onToggleArchive}>
                {account.archived_at ? 'Aktifkan lagi' : 'Arsipkan'}
              </Button>
            )}
            {account && onDelete && (
              <Button variant="subtle" color="gray" onClick={onDelete}>
                Hapus
              </Button>
            )}
          </Group>
          <Button type="submit" loading={submitting}>
            Simpan
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
