/** Money is always bigint minor units. IDR has minor_unit 2 (ISO) but is displayed with 0 decimals. */

export interface CurrencyFormat {
  symbol: string;
  minorUnit: number;
  displayDecimals: number;
}

/** Fixed-format helpers for the seeded currencies; extend from the `currencies` table later. */
export const IDR: CurrencyFormat = { symbol: 'Rp', minorUnit: 2, displayDecimals: 0 };

const pow10 = (n: number): bigint => 10n ** BigInt(n);

/** Format minor units using Indonesian grouping ("." thousands, "," decimals). Pure bigint math. */
export function formatMoney(minor: bigint, fmt: CurrencyFormat): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  // Round half-even once, to displayDecimals, on the whole amount.
  const step = pow10(fmt.minorUnit - fmt.displayDecimals);
  const rounded = roundHalfEvenDiv(abs, step); // in units of 10^-displayDecimals
  const scale = pow10(fmt.displayDecimals);
  const whole = rounded / scale;
  const fracStr =
    fmt.displayDecimals > 0
      ? ',' + (rounded % scale).toString().padStart(fmt.displayDecimals, '0')
      : '';
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}${fmt.symbol}${grouped}${fracStr}`;
}

/** n / d rounded half-even, for n >= 0, d > 0. */
function roundHalfEvenDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && q % 2n === 1n)) return q + 1n;
  return q;
}

/** formatIDR(2500000n) -> "Rp25.000" */
export function formatIDR(minor: bigint): string {
  return formatMoney(minor, IDR);
}
