import { formatIDR } from '@finhub/core';

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
