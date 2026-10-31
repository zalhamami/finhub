import { accountValueBase, type HoldingInput, type ValuationContext } from './fx';

export const ACCOUNT_KINDS = ['cash', 'bank', 'ewallet', 'investment', 'liability'] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export interface NetWorthAccount {
  id: string;
  kind: AccountKind;
  currency: string;
  /** opening + sum(entries), in the account's own minor units (signed) */
  balanceMinor: bigint;
  includeInNetWorth: boolean;
  archived: boolean;
  /** only meaningful for investment accounts */
  holdings?: readonly HoldingInput[];
}

export interface NetWorthResult {
  /** sum of non-liability accounts, base minor units */
  assetsMinor: bigint;
  /** sum of liability accounts; always <= 0 */
  liabilitiesMinor: bigint;
  /** assets + liabilities */
  netWorthMinor: bigint;
  byKind: Record<AccountKind, bigint>;
  /** per-account base value actually used (liabilities already negative) */
  perAccount: Record<string, bigint>;
}

/**
 * Net worth in base-currency minor units.
 * - archived accounts and include_in_net_worth = false are skipped.
 * - liabilities count negative: a liability account contributes -|value|, so it reduces net
 *   worth whether the balance is stored as owed-positive or ledger-style negative.
 * - investment accounts add holdings value to the cash balance.
 * Throws MissingRateError / MissingPriceError if data needed for a counted account is absent.
 */
export function netWorth(
  accounts: readonly NetWorthAccount[],
  ctx: ValuationContext,
): NetWorthResult {
  const byKind = Object.fromEntries(ACCOUNT_KINDS.map((k) => [k, 0n])) as Record<
    AccountKind,
    bigint
  >;
  const perAccount: Record<string, bigint> = {};
  let assets = 0n;
  let liabilities = 0n;

  for (const a of accounts) {
    if (a.archived || !a.includeInNetWorth) continue;
    const holdings = a.kind === 'investment' ? (a.holdings ?? []) : [];
    let v = accountValueBase(a.balanceMinor, a.currency, holdings, ctx);
    if (a.kind === 'liability') {
      v = v < 0n ? v : -v;
      liabilities += v;
    } else {
      assets += v;
    }
    byKind[a.kind] += v;
    perAccount[a.id] = v;
  }
  return {
    assetsMinor: assets,
    liabilitiesMinor: liabilities,
    netWorthMinor: assets + liabilities,
    byKind,
    perAccount,
  };
}
