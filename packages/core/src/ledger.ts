export type TransactionKind = 'expense' | 'income' | 'transfer' | 'adjustment';
export type TransactionStatus = 'draft' | 'posted';

export interface TransactionHeader {
  kind: TransactionKind;
  status: TransactionStatus;
}

export interface EntryLine {
  accountId: string;
  amountMinor: bigint;
  currency: string;
  /**
   * On a transfer, an entry with a category is a FEE line (an expense charged to the
   * source account) and is excluded from the transfer-leg checks. Legs have no category.
   */
  categoryId?: string | null;
}

/** True for a fee line: an entry of a transfer that carries a category. */
export const isFeeLine = (e: Pick<EntryLine, 'categoryId'>): boolean => e.categoryId != null;

export interface LedgerIssue {
  code: 'expense_income_entry_count' | 'transfer_needs_two_accounts' | 'transfer_not_balanced';
  message: string;
}

/**
 * Invariants (see CLAUDE.md). Drafts are never checked.
 * - expense/income: exactly one entry.
 * - transfer: entries WITHOUT a category are the legs; entries WITH a category are fee
 *   lines (excluded from the checks below). Need at least two legs; if all legs share one
 *   currency they must sum to zero. Cross-currency transfers keep both amounts and are not summed.
 */
export function validateTransaction(
  header: TransactionHeader,
  entries: readonly EntryLine[],
): LedgerIssue[] {
  if (header.status === 'draft') return [];
  const issues: LedgerIssue[] = [];

  if (header.kind === 'expense' || header.kind === 'income') {
    if (entries.length !== 1) {
      issues.push({
        code: 'expense_income_entry_count',
        message: `${header.kind} must have exactly one entry, got ${entries.length}`,
      });
    }
  } else if (header.kind === 'transfer') {
    const legs = entries.filter((e) => !isFeeLine(e));
    if (legs.length < 2) {
      issues.push({
        code: 'transfer_needs_two_accounts',
        message: 'transfer needs at least two non-fee entries',
      });
    } else if (new Set(legs.map((e) => e.currency)).size === 1) {
      const sum = legs.reduce((s, e) => s + e.amountMinor, 0n);
      if (sum !== 0n) {
        issues.push({
          code: 'transfer_not_balanced',
          message: `transfer legs sum to ${sum}, expected 0`,
        });
      }
    }
  }
  return issues;
}

/** balance = opening balance + sum(entries) */
export function accountBalance(
  opening: bigint,
  entries: readonly Pick<EntryLine, 'amountMinor'>[],
): bigint {
  return entries.reduce((s, e) => s + e.amountMinor, opening);
}
