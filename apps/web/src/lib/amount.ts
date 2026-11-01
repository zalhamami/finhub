import { parseIdrAmount } from '@finhub/core';
import { formatMinorCurrency, minorUnitOf } from './money';

/** Result of parsing what the user typed into an amount field. */
export type AmountParse =
  { status: 'empty' } | { status: 'ok'; minor: bigint } | { status: 'invalid' };

/**
 * Indonesian slang / grouped amount text -> minor units. Empty text is "empty" (the caller
 * decides if that means 0 or "required"). A leading "-" negates ("-1,5jt"); "0" is a valid zero.
 * Delegates to core parseIdrAmount, which rejects zero and negatives itself.
 *
 * `minorUnit` is the currency's decimal places in storage (default 2: IDR and USD both have 2;
 * IDR is merely *displayed* with 0). Other values rescale core's 2-decimal result; text that
 * needs more precision than the currency has is "invalid".
 */
export function parseAmountText(text: string, minorUnit = 2): AmountParse {
  const t = text.trim();
  if (t === '') return { status: 'empty' };
  const negative = t.startsWith('-');
  const body = negative ? t.slice(1).trim() : t;
  const signed = (minor: bigint): AmountParse => ({
    status: 'ok',
    minor: negative ? -minor : minor,
  });
  if (/^(rp\.?\s*)?0+([.,]0+)?$/i.test(body)) return { status: 'ok', minor: 0n };
  // Plain "1500,50" (exactly `minorUnit` decimals) is unambiguous minor units; core rejects bare
  // decimals, and this is the form minorToInputText emits, so editing an existing balance round-trips.
  const exact = minorUnit > 0 ? new RegExp(`^(\\d+),(\\d{${minorUnit}})$`).exec(body) : null;
  if (exact) return signed(BigInt(exact[1]! + exact[2]!));
  const minor2 = parseIdrAmount(body);
  if (minor2 === null) return { status: 'invalid' };
  if (minorUnit === 2) return signed(minor2);
  if (minorUnit > 2) return signed(minor2 * 10n ** BigInt(minorUnit - 2));
  const div = 10n ** BigInt(2 - minorUnit);
  return minor2 % div === 0n ? signed(minor2 / div) : { status: 'invalid' };
}

/** Live preview line: "Rp1.500.000" / "US$12,50", or null while empty/invalid. */
export function amountPreview(text: string, currency = 'IDR'): string | null {
  const r = parseAmountText(text, minorUnitOf(currency));
  return r.status === 'ok' ? formatMinorCurrency(r.minor.toString(), currency) : null;
}

/** Minor units (decimal string) -> editable text in major units: "150000000" -> "1500000", "150050" -> "1500,50". */
export function minorToInputText(minor: string | null | undefined, minorUnit = 2): string {
  if (minor == null || !/^-?\d+$/.test(minor)) return '';
  const n = BigInt(minor);
  const abs = n < 0n ? -n : n;
  const scale = 10n ** BigInt(minorUnit);
  const whole = abs / scale;
  const frac = abs % scale;
  const fracText = frac === 0n ? '' : `,${frac.toString().padStart(minorUnit, '0')}`;
  return `${n < 0n ? '-' : ''}${whole}${fracText}`;
}
