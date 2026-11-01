import {
  Alert,
  Button,
  Group,
  Select,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconAlertCircle, IconTrash } from '@tabler/icons-react';
import { useMemo, useRef, useState } from 'react';
import { bySortOrder } from '../lib/accounts';
import type { ApiAccount, ApiAccountType, ApiCategory } from '../lib/api';
import { categorySelectData, indexCategories } from '../lib/categories';
import { foreignValue, formatMinorCurrency } from '../lib/money';
import { zodFormResolver } from '../lib/schemas';
import {
  NOTE_MAX,
  TX_TYPE_LABEL,
  newTxForm,
  txFormSchema,
  type TxFormValues,
  type TxPayload,
  type TxType,
} from '../lib/transactions';
import { AmountInput } from '../ui/AmountInput';
import { DateField, TimeInput } from '../ui/dates';
import { EntityIcon } from '../ui/EntityIcon';
import classes from './TransactionForm.module.css';

export interface TransactionFormProps {
  mode: 'create' | 'edit';
  /** starting values (edit: the transaction; create: type/date/fee-category defaults) */
  initial: TxFormValues;
  accounts: ApiAccount[];
  accountTypes: ApiAccountType[];
  categories: ApiCategory[];
  /** account id -> balance (minor units, account currency); missing = not shown */
  balances: ReadonlyMap<string, string>;
  /** account id -> base-currency value (null = no FX rate); shown as "≈ …" for foreign accounts */
  baseValues?: ReadonlyMap<string, string | null>;
  baseCurrency?: string;
  submitting?: boolean;
  /** friendly API failure text for the last submit */
  error?: string | null;
  /** resolves true when saved (the sheet closes or, for "tambah lagi", the form is reset) */
  onSubmit: (payload: TxPayload, addAnother: boolean) => Promise<boolean>;
  onDelete?: () => void;
  /** clock source for the default time (tests inject a fixed one) */
  now?: () => Date;
}

const TYPE_DATA = (['expense', 'income', 'transfer'] as const).map((value) => ({
  value,
  label: TX_TYPE_LABEL[value],
}));

export function TransactionForm({
  mode,
  initial,
  accounts,
  accountTypes,
  categories,
  balances,
  baseValues,
  baseCurrency = 'IDR',
  submitting,
  error,
  onSubmit,
  onDelete,
  now = () => new Date(),
}: TransactionFormProps) {
  const form = useForm<TxFormValues>({ initialValues: initial });
  const amountRef = useRef<HTMLInputElement>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const v = form.values;

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const catById = useMemo(() => indexCategories(categories), [categories]);
  const typeIcon = useMemo(() => new Map(accountTypes.map((t) => [t.id, t.icon])), [accountTypes]);
  const schema = useMemo(
    () =>
      txFormSchema({
        accounts: accountById,
        categories: new Map([...catById].map(([id, c]) => [id, c.kind])),
      }),
    [accountById, catById],
  );

  const accountData = (selected: string[]) =>
    accounts
      .filter((a) => !a.archived_at || selected.includes(a.id))
      .sort(bySortOrder)
      .map((a) => ({ value: a.id, label: a.name }));
  const selectedIds = [initial.account_id, initial.to_account_id];
  const accountOptions = accountData(selectedIds);
  const renderAccount = ({ option }: { option: { value: string; label: string } }) => {
    const a = accountById.get(option.value);
    const bal = balances.get(option.value);
    return (
      <Group gap="sm" wrap="nowrap" justify="space-between" w="100%">
        <Group gap="sm" wrap="nowrap" miw={0}>
          <EntityIcon
            name={a?.icon ?? (a ? typeIcon.get(a.type_id) : null)}
            fallback="wallet"
            size={18}
          />
          <Text size="sm" truncate>
            {option.label}
          </Text>
        </Group>
        {bal !== undefined && a && (
          <Stack gap={0} align="flex-end">
            <Text size="xs" c="dimmed" className={classes.balance}>
              {formatMinorCurrency(bal, a.currency)}
            </Text>
            {(() => {
              const fv = foreignValue(bal, a.currency, baseValues?.get(a.id), baseCurrency);
              return fv ? (
                <Text size="xs" c="dimmed" className={classes.balance}>
                  {fv.secondary}
                </Text>
              ) : null;
            })()}
          </Stack>
        )}
      </Group>
    );
  };
  const accountLeft = (id: string) => {
    const a = accountById.get(id);
    return a ? (
      <EntityIcon name={a.icon ?? typeIcon.get(a.type_id)} fallback="wallet" size={18} />
    ) : null;
  };

  const categoryKind = v.type === 'income' ? 'income' : 'expense';
  const categoryData = categorySelectData(categories, categoryKind, {
    keep: v.category_id || undefined,
  });
  const feeCategoryData = categorySelectData(categories, 'expense', {
    keep: v.fee_category_id || undefined,
  });

  const from = accountById.get(v.account_id);
  const to = accountById.get(v.to_account_id);
  const crossCurrency =
    v.type === 'transfer' && !!from && !!to && from.id !== to.id && from.currency !== to.currency;

  const setType = (type: TxType) => {
    form.setFieldValue('type', type);
    // an expense category is invalid on an income (and vice versa)
    if (type !== 'transfer' && catById.get(v.category_id)?.kind !== type) {
      form.setFieldValue('category_id', '');
    }
    setFieldErrors({});
  };

  const submit = async (addAnother: boolean) => {
    const parsed = schema.safeParse(form.values);
    if (!parsed.success) {
      setFieldErrors(zodFormResolver<TxFormValues>(schema)(form.values));
      return;
    }
    setFieldErrors({});
    const ok = await onSubmit(parsed.data, addAnother);
    if (ok && addAnother) {
      // keep type, accounts, date and fee category; time resets to now; clear the entry-specific bits
      form.setValues({
        ...form.values,
        amount_text: '',
        to_amount_text: '',
        fee_text: '',
        category_id: '',
        note: '',
        payee: '',
        time: newTxForm(now()).time,
      });
      amountRef.current?.focus();
    }
  };

  const err = (k: keyof TxFormValues) => fieldErrors[k];
  const field = <K extends keyof TxFormValues>(k: K) => ({
    value: form.values[k] as string,
    onChange: (e: { currentTarget: { value: string } }) => {
      form.setFieldValue(k, e.currentTarget.value as never);
    },
    error: err(k),
  });

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit(false);
      }}
    >
      <Stack gap="md">
        <SegmentedControl
          fullWidth
          data={TYPE_DATA}
          value={v.type}
          onChange={(t) => setType(t as TxType)}
          disabled={mode === 'edit'}
          aria-label="Jenis transaksi"
        />

        <AmountInput
          ref={amountRef}
          data-autofocus
          size="lg"
          label={v.type === 'transfer' ? 'Nominal dikirim' : 'Nominal'}
          placeholder="50rb, 1,5jt, Rp1.250.000"
          currency={from?.currency}
          {...field('amount_text')}
        />

        <Select
          label={v.type === 'transfer' ? 'Dari akun' : 'Akun'}
          placeholder="Pilih akun"
          searchable
          data={accountOptions}
          value={v.account_id || null}
          onChange={(id) => form.setFieldValue('account_id', id ?? '')}
          error={err('account_id')}
          leftSection={accountLeft(v.account_id)}
          renderOption={renderAccount}
          nothingFoundMessage="Akun tidak ditemukan"
        />

        {v.type === 'transfer' ? (
          <>
            <Select
              label="Ke akun"
              placeholder="Pilih akun tujuan"
              searchable
              data={accountOptions}
              value={v.to_account_id || null}
              onChange={(id) => form.setFieldValue('to_account_id', id ?? '')}
              error={err('to_account_id')}
              leftSection={accountLeft(v.to_account_id)}
              renderOption={renderAccount}
              nothingFoundMessage="Akun tidak ditemukan"
            />
            {crossCurrency && (
              <AmountInput
                label={`Jumlah diterima (${to!.currency})`}
                description={`Beda mata uang: ${from!.currency} → ${to!.currency}`}
                placeholder="mis. 61,50"
                currency={to!.currency}
                {...field('to_amount_text')}
              />
            )}
            <AmountInput
              label="Biaya admin (opsional)"
              placeholder="mis. 6500"
              currency={from?.currency}
              {...field('fee_text')}
            />
            {v.fee_text.trim() !== '' && (
              <Select
                label="Kategori biaya"
                placeholder="Pilih kategori"
                searchable
                data={feeCategoryData}
                value={v.fee_category_id || null}
                onChange={(id) => form.setFieldValue('fee_category_id', id ?? '')}
                error={err('fee_category_id')}
                nothingFoundMessage="Kategori tidak ditemukan"
              />
            )}
          </>
        ) : (
          <Select
            label="Kategori"
            placeholder="Pilih kategori"
            searchable
            data={categoryData}
            value={v.category_id || null}
            onChange={(id) => form.setFieldValue('category_id', id ?? '')}
            error={err('category_id')}
            nothingFoundMessage="Kategori tidak ditemukan"
          />
        )}

        <SimpleGrid cols={2} spacing="sm" verticalSpacing={0}>
          <DateField
            label="Tanggal"
            value={v.date || null}
            onChange={(d) => form.setFieldValue('date', d ?? '')}
            error={err('date')}
          />
          <TimeInput label="Jam" {...field('time')} />
        </SimpleGrid>

        {v.type !== 'transfer' && (
          <TextInput label="Penerima / toko (opsional)" maxLength={200} {...field('payee')} />
        )}
        <TextInput label="Catatan (opsional)" maxLength={NOTE_MAX + 50} {...field('note')} />

        {error && (
          <Alert color="gray" icon={<IconAlertCircle size={20} stroke={1.75} />} role="alert">
            {error}
          </Alert>
        )}

        <Group justify="space-between" wrap="nowrap">
          {mode === 'edit' && onDelete ? (
            <Button
              variant="subtle"
              color="dark"
              leftSection={<IconTrash size={18} stroke={1.75} />}
              onClick={onDelete}
            >
              Hapus
            </Button>
          ) : (
            <span />
          )}
          <Group gap="sm" wrap="nowrap">
            {mode === 'create' && (
              <Button
                variant="default"
                visibleFrom="sm"
                loading={submitting}
                onClick={() => void submit(true)}
              >
                Simpan &amp; tambah lagi
              </Button>
            )}
            <Button type="submit" loading={submitting}>
              Simpan
            </Button>
          </Group>
        </Group>
      </Stack>
    </form>
  );
}
