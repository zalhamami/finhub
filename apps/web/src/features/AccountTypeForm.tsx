import { Alert, Button, Group, Select, Stack, Switch, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconAlertCircle } from '@tabler/icons-react';
import { KIND_LABEL, KIND_ORDER } from '../lib/accounts';
import type { AccountKind, AccountTypePayload, ApiAccountType } from '../lib/api';
import { ACCOUNT_ICONS } from '../lib/icons';
import {
  accountTypeFormSchema,
  emptyAccountTypeForm,
  zodFormResolver,
  type AccountTypeFormValues,
} from '../lib/schemas';
import { IconPicker } from '../ui/IconPicker';

export interface AccountTypeFormProps {
  accountType?: ApiAccountType;
  submitting?: boolean;
  error?: string | null;
  onSubmit: (payload: AccountTypePayload) => void;
  onDelete?: () => void;
}

const toValues = (t: ApiAccountType): AccountTypeFormValues => ({
  name: t.name,
  kind: t.kind,
  icon: t.icon ?? '',
  has_credit_limit: t.has_credit_limit,
  has_due_day: t.has_due_day,
  has_holdings: t.has_holdings,
});

/** Kind is chosen once, on creation, and read-only afterwards. */
export function AccountTypeForm({
  accountType,
  submitting,
  error,
  onSubmit,
  onDelete,
}: AccountTypeFormProps) {
  const form = useForm<AccountTypeFormValues>({
    mode: 'controlled',
    initialValues: accountType ? toValues(accountType) : emptyAccountTypeForm(),
    validate: zodFormResolver<AccountTypeFormValues>(accountTypeFormSchema),
  });
  const kind = form.values.kind;

  return (
    <form
      noValidate
      onSubmit={form.onSubmit((values) => onSubmit(accountTypeFormSchema.parse(values)))}
    >
      <Stack gap="md">
        <TextInput
          label="Nama jenis akun"
          placeholder="mis. Deposito"
          withAsterisk
          data-autofocus
          {...form.getInputProps('name')}
        />
        <Select
          label="Kelompok"
          placeholder="Pilih kelompok"
          withAsterisk
          disabled={!!accountType}
          description={accountType ? 'Kelompok tidak bisa diubah setelah dibuat.' : undefined}
          data={KIND_ORDER.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
          value={kind || null}
          error={form.errors.kind}
          onChange={(v) => form.setFieldValue('kind', (v ?? '') as AccountKind | '')}
        />
        <IconPicker
          value={form.values.icon}
          onChange={(k) => form.setFieldValue('icon', k)}
          icons={ACCOUNT_ICONS}
        />
        {kind === 'liability' && (
          <>
            <Switch
              label="Punya limit kredit"
              {...form.getInputProps('has_credit_limit', { type: 'checkbox' })}
            />
            <Switch
              label="Punya tanggal tagihan dan jatuh tempo"
              {...form.getInputProps('has_due_day', { type: 'checkbox' })}
            />
          </>
        )}
        {kind === 'investment' && (
          <Switch
            label="Punya kepemilikan (unit dan harga)"
            {...form.getInputProps('has_holdings', { type: 'checkbox' })}
          />
        )}

        {error && (
          <Alert color="gray" icon={<IconAlertCircle size={20} stroke={1.75} />} role="alert">
            {error}
          </Alert>
        )}

        <Group justify="space-between" mt="xs">
          {accountType && onDelete ? (
            <Button variant="subtle" color="gray" onClick={onDelete}>
              Hapus
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" loading={submitting}>
            Simpan
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
