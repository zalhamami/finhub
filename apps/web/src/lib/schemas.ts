/**
 * Form boundary: Zod schemas for the account / category / account-type forms. The inputs are the
 * raw form strings; the outputs are the exact API payloads (mirrors apps/server routes), so
 * everything past `schema.parse` works with typed, already-validated data.
 */
import { z } from 'zod';
import type { AccountKind, AccountPayload, AccountTypePayload, CategoryPayload } from './api';
import { parseAmountText } from './amount';
import { COLOR_NAMES } from './palette';

const NAME = z.string().trim().min(1, 'Nama wajib diisi').max(100, 'Maksimal 100 karakter');
const optionalText = z.string().transform((s) => (s.trim() === '' ? null : s.trim()));
const optionalColor = z
  .string()
  .refine((c) => c === '' || (COLOR_NAMES as readonly string[]).includes(c), 'Warna tidak dikenal')
  .transform((c) => (c === '' ? null : c));
const AMOUNT_HINT = 'Nominal tidak dikenali. Contoh: 250rb, 1,5jt, Rp1.250.000';

/** Amount text -> bigint minor units, or null when empty. Negative allowed unless `nonNegative`. */
const amount = (nonNegative: boolean) =>
  z.string().transform((text, ctx) => {
    const r = parseAmountText(text);
    if (r.status === 'invalid') {
      ctx.addIssue({ code: 'custom', message: AMOUNT_HINT });
      return z.NEVER;
    }
    if (r.status === 'empty') return null;
    if (nonNegative && r.minor < 0n) {
      ctx.addIssue({ code: 'custom', message: 'Tidak boleh negatif' });
      return z.NEVER;
    }
    return r.minor;
  });

const dayOfMonth = z.string().transform((text, ctx) => {
  const t = text.trim();
  if (t === '') return null;
  const n = Number(t);
  if (!/^\d{1,2}$/.test(t) || n < 1 || n > 31) {
    ctx.addIssue({ code: 'custom', message: 'Isi tanggal 1–31' });
    return z.NEVER;
  }
  return n;
});

const isoDate = z
  .string()
  .refine((s) => s === '' || /^\d{4}-\d{2}-\d{2}$/.test(s), 'Tanggal tidak valid')
  .transform((s) => (s === '' ? null : s));

/* ---------- account ---------- */

export interface AccountFormValues {
  name: string;
  type_id: string;
  group_id: string;
  currency: string;
  /** raw amount text, parsed by parseAmountText */
  opening_text: string;
  opening_date: string;
  icon: string;
  color: string;
  include_in_net_worth: boolean;
  credit_limit_text: string;
  statement_day: string;
  due_day: string;
}

/** What the selected account type switches on (credit limit / due day fields). */
export interface TypeFlags {
  has_credit_limit: boolean;
  has_due_day: boolean;
}

export const emptyAccountForm = (): AccountFormValues => ({
  name: '',
  type_id: '',
  group_id: '',
  currency: 'IDR',
  opening_text: '',
  opening_date: '',
  icon: '',
  color: '',
  include_in_net_worth: true,
  credit_limit_text: '',
  statement_day: '',
  due_day: '',
});

/** Credit fields are validated and sent only when the type has them; otherwise they go out as null. */
export function accountFormSchema(flags: TypeFlags | undefined) {
  return z
    .object({
      name: NAME,
      type_id: z.string().min(1, 'Pilih jenis akun'),
      group_id: optionalText,
      currency: z.string().min(1, 'Pilih mata uang'),
      opening_text: amount(false),
      opening_date: isoDate,
      icon: optionalText,
      color: optionalColor,
      include_in_net_worth: z.boolean(),
      credit_limit_text: flags?.has_credit_limit ? amount(true) : z.string().transform(() => null),
      statement_day: flags?.has_due_day ? dayOfMonth : z.string().transform(() => null),
      due_day: flags?.has_due_day ? dayOfMonth : z.string().transform(() => null),
    })
    .transform((v): AccountPayload => ({
      name: v.name,
      type_id: v.type_id,
      group_id: v.group_id,
      currency: v.currency,
      icon: v.icon,
      color: v.color,
      opening_balance_minor: (v.opening_text ?? 0n).toString(),
      opening_date: v.opening_date,
      credit_limit_minor: v.credit_limit_text === null ? null : v.credit_limit_text.toString(),
      statement_day: v.statement_day,
      due_day: v.due_day,
      include_in_net_worth: v.include_in_net_worth,
    }));
}

/* ---------- category ---------- */

export interface CategoryFormValues {
  name: string;
  parent_id: string;
  icon: string;
  color: string;
}

export const emptyCategoryForm = (): CategoryFormValues => ({
  name: '',
  parent_id: '',
  icon: '',
  color: '',
});

export const categoryFormSchema = z
  .object({ name: NAME, parent_id: optionalText, icon: optionalText, color: optionalColor })
  .transform((v): Omit<CategoryPayload, 'kind'> => v);

/* ---------- account type ---------- */

export interface AccountTypeFormValues {
  name: string;
  kind: AccountKind | '';
  icon: string;
  has_credit_limit: boolean;
  has_due_day: boolean;
  has_holdings: boolean;
}

export const emptyAccountTypeForm = (): AccountTypeFormValues => ({
  name: '',
  kind: '',
  icon: '',
  has_credit_limit: false,
  has_due_day: false,
  has_holdings: false,
});

export const accountTypeFormSchema = z
  .object({
    name: NAME,
    kind: z.enum(['cash', 'bank', 'ewallet', 'investment', 'liability'], {
      error: 'Pilih jenis (kelompok)',
    }),
    icon: optionalText,
    has_credit_limit: z.boolean(),
    has_due_day: z.boolean(),
    has_holdings: z.boolean(),
  })
  .transform((v): AccountTypePayload => ({
    ...v,
    // credit limit / due day only make sense for liabilities, holdings only for investments
    has_credit_limit: v.kind === 'liability' && v.has_credit_limit,
    has_due_day: v.kind === 'liability' && v.has_due_day,
    has_holdings: v.kind === 'investment' && v.has_holdings,
  }));

/* ---------- @mantine/form glue ---------- */

/** Zod schema -> @mantine/form `validate` function: first message per field path. */
export function zodFormResolver<V>(schema: z.ZodType): (values: V) => Record<string, string> {
  return (values) => {
    const r = schema.safeParse(values);
    if (r.success) return {};
    const errors: Record<string, string> = {};
    for (const issue of r.error.issues) {
      const key = issue.path.join('.');
      if (!(key in errors)) errors[key] = issue.message;
    }
    return errors;
  };
}
