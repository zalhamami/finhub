/**
 * Transaction form logic (pure): raw form strings -> exact API payload (Zod, at the form
 * boundary), API transaction -> form values (edit), and grouping a list by Jakarta day.
 */
import { convertMinor, pickRate, type FxRate } from '@finhub/core';
import { z } from 'zod';
import { dayjs } from './dayjs';
import type { ApiTransaction, CategoryKind, SimpleTxBody, TransferTxBody } from './api';
import { parseAmountText, minorToInputText } from './amount';
import { addDays, isClockTime, isIsoDate, jakartaClock, jakartaDate, jakartaTime } from './dates';
import { foreignValue, formatMinorCurrency, minorUnitOf, parseMinor } from './money';
import type { TxType } from './txFilters';

export { jakartaDate, jakartaTime } from './dates';
export type { TxType } from './txFilters';

export const TX_TYPE_LABEL: Record<TxType, string> = {
  expense: 'Pengeluaran',
  income: 'Pemasukan',
  transfer: 'Transfer',
};

export const NOTE_MAX = 500;
const AMOUNT_HINT = 'Nominal tidak dikenali. Contoh: 250rb, 1,5jt, Rp1.250.000';

export interface TxFormValues {
  type: TxType;
  /** raw amount text (sent amount for a transfer) */
  amount_text: string;
  /** the account (expense / income) or the source account (transfer) */
  account_id: string;
  category_id: string;
  to_account_id: string;
  /** received amount, only for cross-currency transfers */
  to_amount_text: string;
  fee_text: string;
  fee_category_id: string;
  /** YYYY-MM-DD, Asia/Jakarta */
  date: string;
  /** HH:mm or '' */
  time: string;
  note: string;
  payee: string;
}

export const emptyTxForm = (date: string): TxFormValues => ({
  type: 'expense',
  amount_text: '',
  account_id: '',
  category_id: '',
  to_account_id: '',
  to_amount_text: '',
  fee_text: '',
  fee_category_id: '',
  date,
  time: '',
  note: '',
  payee: '',
});

/** What validation needs to know about the world. */
export interface TxFormContext {
  accounts: ReadonlyMap<string, { currency: string }>;
  categories: ReadonlyMap<string, CategoryKind>;
  /** for the default time of an entry dated today */
  now?: Date;
}

export type TxPayload =
  { type: 'expense' | 'income'; body: SimpleTxBody } | { type: 'transfer'; body: TransferTxBody };

const nullIfBlank = (s: string) => (s.trim() === '' ? null : s.trim());

/** Zod schema: input = TxFormValues, output = TxPayload (money as decimal strings). */
export function txFormSchema(ctx: TxFormContext) {
  return z
    .object({
      type: z.enum(['expense', 'income', 'transfer']),
      amount_text: z.string(),
      account_id: z.string(),
      category_id: z.string(),
      to_account_id: z.string(),
      to_amount_text: z.string(),
      fee_text: z.string(),
      fee_category_id: z.string(),
      date: z.string(),
      time: z.string(),
      note: z.string().max(NOTE_MAX, `Maksimal ${NOTE_MAX} karakter`),
      payee: z.string().max(200, 'Maksimal 200 karakter'),
    })
    .transform((v, c): TxPayload => {
      const fail = (path: keyof TxFormValues, message: string) =>
        c.addIssue({ code: 'custom', path: [path], message });

      // amount (> 0)
      // decimals follow the account's currency (IDR 2, USD 2, ...); unknown account: 2
      const unitOf = (id: string) => {
        const c = ctx.accounts.get(id)?.currency;
        return c ? minorUnitOf(c) : 2;
      };
      let amount = 0n;
      const a = parseAmountText(v.amount_text, unitOf(v.account_id));
      if (a.status === 'empty') fail('amount_text', 'Nominal wajib diisi');
      else if (a.status === 'invalid') fail('amount_text', AMOUNT_HINT);
      else if (a.minor <= 0n) fail('amount_text', 'Nominal harus lebih dari 0');
      else amount = a.minor;

      if (!v.account_id)
        fail('account_id', v.type === 'transfer' ? 'Pilih akun asal' : 'Pilih akun');

      // date / time
      if (v.date === '') fail('date', 'Tanggal wajib diisi');
      else if (!isIsoDate(v.date)) fail('date', 'Tanggal tidak valid');
      if (v.time !== '' && !isClockTime(v.time)) fail('time', 'Jam tidak valid');
      const now = ctx.now ?? new Date();
      const clock =
        v.time !== ''
          ? `${v.time}:00`
          : v.date === jakartaDate(now)
            ? jakartaClock(now)
            : '12:00:00';
      const occurred_at = `${v.date}T${clock}+07:00`;
      const note = nullIfBlank(v.note);

      if (v.type !== 'transfer') {
        const kind: CategoryKind = v.type;
        if (!v.category_id) fail('category_id', 'Pilih kategori');
        else if (ctx.categories.get(v.category_id) !== kind)
          fail(
            'category_id',
            `Kategori ini bukan kategori ${kind === 'expense' ? 'pengeluaran' : 'pemasukan'}`,
          );
        return {
          type: v.type,
          body: {
            kind,
            account_id: v.account_id,
            amount_minor: amount.toString(),
            category_id: v.category_id,
            occurred_at,
            note,
            payee: nullIfBlank(v.payee),
          },
        };
      }

      // transfer
      if (!v.to_account_id) fail('to_account_id', 'Pilih akun tujuan');
      else if (v.to_account_id === v.account_id)
        fail('to_account_id', 'Akun tujuan harus berbeda dari akun asal');

      let toAmount: bigint | null = null;
      const crossCurrency =
        !!v.account_id &&
        !!v.to_account_id &&
        v.account_id !== v.to_account_id &&
        ctx.accounts.get(v.account_id)?.currency !== undefined &&
        ctx.accounts.get(v.to_account_id)?.currency !== undefined &&
        ctx.accounts.get(v.account_id)!.currency !== ctx.accounts.get(v.to_account_id)!.currency;
      if (crossCurrency) {
        const t = parseAmountText(v.to_amount_text, unitOf(v.to_account_id));
        if (t.status === 'empty')
          fail('to_amount_text', 'Isi jumlah yang diterima (mata uang berbeda)');
        else if (t.status === 'invalid') fail('to_amount_text', AMOUNT_HINT);
        else if (t.minor <= 0n) fail('to_amount_text', 'Jumlah diterima harus lebih dari 0');
        else toAmount = t.minor;
      }

      let fee: bigint | null = null;
      const f = parseAmountText(v.fee_text, unitOf(v.account_id));
      if (f.status === 'invalid') fail('fee_text', AMOUNT_HINT);
      else if (f.status === 'ok' && f.minor < 0n) fail('fee_text', 'Biaya tidak boleh negatif');
      else if (f.status === 'ok' && f.minor > 0n) {
        fee = f.minor;
        if (!v.fee_category_id) fail('fee_category_id', 'Pilih kategori biaya');
        else if (ctx.categories.get(v.fee_category_id) !== 'expense')
          fail('fee_category_id', 'Kategori ini bukan kategori pengeluaran');
      }

      return {
        type: 'transfer',
        body: {
          from_account_id: v.account_id,
          to_account_id: v.to_account_id,
          amount_minor: amount.toString(),
          to_amount_minor: toAmount === null ? null : toAmount.toString(),
          fee_minor: fee === null ? null : fee.toString(),
          fee_category_id: fee === null ? null : v.fee_category_id,
          occurred_at,
          note,
        },
      };
    });
}

/** Absolute value of a minor-unit string, as editable text. */
function absText(minor: string, currency = 'IDR'): string {
  const n = parseMinor(minor);
  if (n === null) return '';
  return minorToInputText((n < 0n ? -n : n).toString(), minorUnitOf(currency));
}

/**
 * API transaction -> form values for editing. Null for kinds the form cannot represent
 * (adjustments) or malformed shapes.
 */
export function transactionToForm(tx: ApiTransaction): TxFormValues | null {
  const base = {
    ...emptyTxForm(jakartaDate(tx.occurred_at)),
    time: jakartaTime(tx.occurred_at),
    note: tx.note ?? '',
  };
  if (tx.kind === 'expense' || tx.kind === 'income') {
    const e = tx.entries[0];
    if (!e) return null;
    return {
      ...base,
      type: tx.kind,
      amount_text: absText(e.amount_minor, e.currency),
      account_id: e.account_id,
      category_id: e.category_id ?? '',
      payee: tx.payee ?? '',
    };
  }
  if (tx.kind === 'transfer') {
    const legs = tx.entries.filter((e) => !e.is_fee);
    const from = legs.find((e) => (parseMinor(e.amount_minor) ?? 0n) < 0n);
    const to = legs.find((e) => (parseMinor(e.amount_minor) ?? 0n) > 0n);
    if (!from || !to) return null;
    const fee = tx.entries.find((e) => e.is_fee);
    return {
      ...base,
      type: 'transfer',
      amount_text: absText(from.amount_minor, from.currency),
      account_id: from.account_id,
      to_account_id: to.account_id,
      to_amount_text: from.currency !== to.currency ? absText(to.amount_minor, to.currency) : '',
      fee_text: fee ? absText(fee.amount_minor, fee.currency) : '',
      fee_category_id: fee?.category_id ?? '',
    };
  }
  return null;
}

export interface DayNet {
  currency: string;
  /** signed minor units, decimal string */
  minor: string;
}
export interface DayGroup {
  /** Asia/Jakarta YYYY-MM-DD */
  date: string;
  items: ApiTransaction[];
  /** income - expenses (- transfer fees) per currency, IDR first; plain transfers add nothing */
  nets: DayNet[];
}

/** Group a (newest-first) list by Jakarta day, keeping order, with an exact bigint daily net. */
export function groupByDay(list: ApiTransaction[]): DayGroup[] {
  const groups = new Map<string, { items: ApiTransaction[]; nets: Map<string, bigint> }>();
  for (const tx of list) {
    const date = jakartaDate(tx.occurred_at);
    let g = groups.get(date);
    if (!g) groups.set(date, (g = { items: [], nets: new Map() }));
    g.items.push(tx);
    for (const e of tx.entries) {
      if (tx.kind === 'transfer' && !e.is_fee) continue;
      const n = parseMinor(e.amount_minor);
      if (n === null) continue;
      g.nets.set(e.currency, (g.nets.get(e.currency) ?? 0n) + n);
    }
  }
  return [...groups].map(([date, g]) => ({
    date,
    items: g.items,
    nets: [...g.nets]
      .sort(([a], [b]) => (a === 'IDR' ? -1 : b === 'IDR' ? 1 : a.localeCompare(b)))
      .map(([currency, minor]) => ({ currency, minor: minor.toString() })),
  }));
}

export interface TxRowModel {
  title: string;
  category: { icon: string | null; color: string | null } | null;
  /** "payee · note" or '' */
  detail: string;
  /** '' for transfers (the title already names both accounts) */
  accountName: string;
  amount: { minor: string; currency: string; tone: 'neutral' | 'income' | 'dimmed' };
  /** transfer fee in the source currency, when there is one */
  feeMinor: string | null;
  /**
   * Smaller line under the amount: "≈ Rp…" / "kurs belum ada" for a foreign-currency amount (needs
   * `fx` in describeTransaction), or "→ US$61,50" (the received leg) for a cross-currency transfer.
   */
  secondary: string | null;
}

export interface FxContext {
  rates: readonly FxRate[];
  baseCurrency: string;
}

/** Base-currency minor units of `minor` (in `currency`) on a Jakarta date, or null with no rate. */
export function baseEquivalent(
  minor: string,
  currency: string,
  date: string,
  fx: FxContext,
): string | null {
  const n = parseMinor(minor);
  if (n === null) return null;
  if (currency === fx.baseCurrency) return n.toString();
  try {
    const rate = pickRate(fx.rates, currency, fx.baseCurrency, date);
    return convertMinor(
      n,
      { code: currency, minorUnit: minorUnitOf(currency) },
      { code: fx.baseCurrency, minorUnit: minorUnitOf(fx.baseCurrency) },
      rate,
    ).toString();
  } catch {
    return null;
  }
}

/** API transaction -> what a list row shows. Expenses stay neutral (clay is for overspending only). */
export function describeTransaction(
  tx: ApiTransaction,
  accounts: ReadonlyMap<string, { name: string }>,
  categories: ReadonlyMap<string, { name: string; icon: string | null; color: string | null }>,
  fx?: FxContext,
): TxRowModel {
  const accountName = (id: string | undefined) =>
    (id && accounts.get(id)?.name) || 'Akun tidak dikenal';
  const detail = [tx.payee, tx.note].filter((s): s is string => !!s && s.trim() !== '').join(' · ');
  const sign = (m: string) => ((parseMinor(m) ?? 0n) > 0n ? 'income' : 'neutral');

  if (tx.kind === 'transfer') {
    const legs = tx.entries.filter((e) => !e.is_fee);
    const from = legs.find((e) => (parseMinor(e.amount_minor) ?? 0n) < 0n);
    const to = legs.find((e) => (parseMinor(e.amount_minor) ?? 0n) > 0n);
    const fee = tx.entries.find((e) => e.is_fee);
    const sent = from ? absMinor(from.amount_minor) : '0';
    const crossCurrency = !!from && !!to && from.currency !== to.currency;
    const fromCcy = from?.currency ?? 'IDR';
    let secondary: string | null = null;
    if (crossCurrency)
      secondary = `→ ${formatMinorCurrency(absMinor(to.amount_minor), to.currency)}`;
    else if (fx && fromCcy !== fx.baseCurrency)
      secondary = foreignValue(
        sent,
        fromCcy,
        baseEquivalent(sent, fromCcy, jakartaDate(tx.occurred_at), fx),
        fx.baseCurrency,
      )!.secondary;
    return {
      title: `Transfer: ${accountName(from?.account_id)} → ${accountName(to?.account_id)}`,
      category: null,
      detail,
      accountName: '',
      amount: { minor: sent, currency: from?.currency ?? 'IDR', tone: 'dimmed' },
      feeMinor: fee ? absMinor(fee.amount_minor) : null,
      secondary,
    };
  }
  const e = tx.entries[0];
  const cat = e?.category_id ? categories.get(e.category_id) : undefined;
  const secondary =
    fx && e && e.currency !== fx.baseCurrency
      ? foreignValue(
          e.amount_minor,
          e.currency,
          baseEquivalent(e.amount_minor, e.currency, jakartaDate(tx.occurred_at), fx),
          fx.baseCurrency,
        )!.secondary
      : null;
  return {
    title: tx.kind === 'adjustment' ? 'Penyesuaian saldo' : (cat?.name ?? 'Tanpa kategori'),
    category: cat ? { icon: cat.icon, color: cat.color } : null,
    detail,
    accountName: accountName(e?.account_id),
    amount: {
      minor: e?.amount_minor ?? '0',
      currency: e?.currency ?? 'IDR',
      tone: sign(e?.amount_minor ?? '0'),
    },
    feeMinor: null,
    secondary,
  };
}

function absMinor(m: string): string {
  const n = parseMinor(m) ?? 0n;
  return (n < 0n ? -n : n).toString();
}

/** "Hari ini" / "Kemarin" / "Rabu, 28 Okt 2026" for a Jakarta date, relative to `today`. */
export function dayLabel(date: string, today: string): string {
  if (date === today) return 'Hari ini';
  if (date === addDays(today, -1)) return 'Kemarin';
  return dayjs(date)
    .format('dddd, D MMM YYYY')
    .replace(/^./, (c) => c.toUpperCase());
}
