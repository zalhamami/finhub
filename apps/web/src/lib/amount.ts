import { parseIdrAmount } from '@finhub/core';
import { formatMinorIDR } from './money';

/** Result of parsing what the user typed into an amount field. */
export type AmountParse =
  { status: 'empty' } | { status: 'ok'; minor: bigint } | { status: 'invalid' };

/**
 * Indonesian slang / grouped amount text -> minor units. Empty text is "empty" (the caller
 * decides if that means 0 or "required"). A leading "-" negates ("-1,5jt"); "0" is a valid zero.
 * Delegates to core parseIdrAmount, which rejects zero and negatives itself.
 */
export function parseAmountText(text: string): AmountParse {
  const t = text.trim();
  if (t === '') return { status: 'empty' };
  const negative = t.startsWith('-');
  const body = negative ? t.slice(1).trim() : t;
  if (/^(rp\.?\s*)?0+([.,]0+)?$/i.test(body)) return { status: 'ok', minor: 0n };
  // Plain "1500,50" (exactly two decimals) is unambiguous cents; core rejects bare decimals, and
  // this is the form minorToInputText emits, so editing an existing balance round-trips.
  const cents = /^(\d+),(\d{2})$/.exec(body);
  if (cents) {
    const minor = BigInt(cents[1]!) * 100n + BigInt(cents[2]!);
    return { status: 'ok', minor: negative ? -minor : minor };
  }
  const minor = parseIdrAmount(body);
  if (minor === null) return { status: 'invalid' };
  return { status: 'ok', minor: negative ? -minor : minor };
}

/** Live preview line: "Rp1.500.000", or null while empty/invalid. */
export function amountPreview(text: string): string | null {
  const r = parseAmountText(text);
  return r.status === 'ok' ? formatMinorIDR(r.minor.toString()) : null;
}

/** Minor units (decimal string) -> editable text in major units: "150000000" -> "1500000", "150050" -> "1500,50". */
export function minorToInputText(minor: string | null | undefined): string {
  if (minor == null || !/^-?\d+$/.test(minor)) return '';
  const n = BigInt(minor);
  const abs = n < 0n ? -n : n;
  const whole = abs / 100n;
  const cents = abs % 100n;
  const frac = cents === 0n ? '' : `,${cents.toString().padStart(2, '0')}`;
  return `${n < 0n ? '-' : ''}${whole}${frac}`;
}
