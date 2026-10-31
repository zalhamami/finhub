import { D, decimalToMinor } from './fx';

const SLANG: Record<string, bigint> = {
  cepek: 100n,
  seceng: 1_000n,
  goceng: 5_000n,
  ceban: 10_000n,
  gocap: 50_000n,
};

const SUFFIX: Record<string, number> = {
  rb: 1_000,
  ribu: 1_000,
  k: 1_000,
  jt: 1_000_000,
  juta: 1_000_000,
};

/** 1-3 digits then one or more ".ddd" groups (or the same with ","). */
const GROUPED_DOT = /^[1-9]\d{0,2}(?:\.\d{3})+(?:,\d{1,2})?$/;
const GROUPED_COMMA = /^[1-9]\d{0,2}(?:,\d{3}){2,}(?:\.\d{1,2})?$/;

/**
 * Parse Indonesian-style amount text into IDR minor units (bigint, minor_unit 2), or null.
 *
 * Accepted: "25rb" "25 rb" "25ribu" "25k" "1,5jt" "1.5jt" "2 juta" "goceng" (5.000) "ceban"
 * (10.000) "gocap" (50.000) "seceng" (1.000) "cepek" (100) "25000" "25.000" "Rp 1.250.000"
 * "1.250.000,50".
 * Rejected (null): ambiguous bare decimals like "1,5" / "1.5", zero, negatives, junk.
 * With a suffix (rb/k/jt/...), a single "." or "," is a decimal separator.
 * Without a suffix, "." is a thousands separator ("25.000" = 25000) and "," the decimal one;
 * "1,250,000" (comma-grouped, 2+ groups) is also accepted.
 */
export function parseIdrAmount(text: string): bigint | null {
  let s = text.trim().toLowerCase();
  s = s
    .replace(/^(rp|idr)\.?\s*/, '')
    .replace(/,-$/, '')
    .trim();
  if (!s) return null;

  const slang = SLANG[s];
  if (slang !== undefined) return slang * 100n;

  const m = /^(\d+(?:[.,]\d+)?)\s*([a-z]+)$/.exec(s);
  if (m) {
    const mult = SUFFIX[m[2]!];
    if (mult === undefined) return null;
    const n = new D(m[1]!.replace(',', '.')).mul(mult);
    const minor = decimalToMinor(n, 2);
    return minor > 0n ? minor : null;
  }

  let num: string;
  if (/^\d+$/.test(s)) num = s;
  else if (GROUPED_DOT.test(s)) num = s.replace(/\./g, '').replace(',', '.');
  else if (GROUPED_COMMA.test(s)) num = s.replace(/,/g, '');
  else return null;

  const minor = decimalToMinor(new D(num), 2);
  return minor > 0n ? minor : null;
}
