import { IDR, formatIDR, formatMoney, type CurrencyFormat } from '@finhub/core';

/** API money fields are decimal strings (bigint minor units). Never goes through a JS number. */
export function parseMinor(value: string | null | undefined): bigint | null {
  if (value == null || !/^-?\d+$/.test(value)) return null;
  return BigInt(value);
}

/** "1234500000" -> "Rp12.345.000"; null/invalid -> "–". */
export function formatMinorIDR(value: string | null | undefined): string {
  const minor = parseMinor(value);
  return minor === null ? '–' : formatIDR(minor);
}

/** Liabilities are always shown as owed (negative), whether stored owed-positive or ledger-negative. */
export function asLiability(value: string | null | undefined): string | null {
  const minor = parseMinor(value);
  if (minor === null) return null;
  return (minor < 0n ? minor : -minor).toString();
}

/** Display symbol overrides: id-ID shows the US dollar as "US$" (the DB symbol is just "$"). */
const SYMBOL_OVERRIDE: Record<string, string> = { USD: 'US$' };

const DEFAULTS: Record<string, CurrencyFormat> = {
  IDR: IDR,
  USD: { symbol: 'US$', minorUnit: 2, displayDecimals: 2 },
  SGD: { symbol: 'S$', minorUnit: 2, displayDecimals: 2 },
};
/** Filled from GET /currencies (registerCurrencies); the seeded defaults above cover first paint. */
const registry = new Map<string, CurrencyFormat>();

export function registerCurrencies(
  list: readonly { code: string; minor_unit: number; display_decimals: number; symbol: string }[],
): void {
  for (const c of list) {
    registry.set(c.code, {
      symbol: SYMBOL_OVERRIDE[c.code] ?? c.symbol,
      minorUnit: c.minor_unit,
      displayDecimals: c.display_decimals,
    });
  }
}

/** Format of a currency code; unknown codes are shown as "XYZ 1,00" with 2 decimals. */
export function currencyFormat(code: string): CurrencyFormat {
  return (
    registry.get(code) ?? DEFAULTS[code] ?? { symbol: `${code} `, minorUnit: 2, displayDecimals: 2 }
  );
}

/** Minor units of a currency (IDR 2, USD 2, ...). */
export const minorUnitOf = (code: string): number => currencyFormat(code).minorUnit;

/** Minor units in any currency, e.g. "Rp1.500.000", "US$1.250,00", "-S$61,50". */
export function formatMinorCurrency(value: string | null | undefined, currency: string): string {
  const minor = parseMinor(value);
  if (minor === null) return '–';
  return formatMoney(minor, currencyFormat(currency));
}

export interface ForeignValue {
  /** main figure, in the account's own currency */
  native: string;
  /** "≈ Rp20.312.500", or "kurs belum ada" when there is no rate (value null) */
  secondary: string;
}

/**
 * Own-currency amount with its base-currency equivalent as secondary text. Returns null when the
 * account is in the base currency (nothing to add). `base` = value in base minor units, or null
 * when no FX rate exists.
 */
export function foreignValue(
  native: string | null | undefined,
  currency: string,
  base: string | null | undefined,
  baseCurrency: string,
): ForeignValue | null {
  if (currency === baseCurrency || native == null) return null;
  return {
    native: formatMinorCurrency(native, currency),
    secondary: base == null ? 'kurs belum ada' : `≈ ${formatMinorCurrency(base, baseCurrency)}`,
  };
}
