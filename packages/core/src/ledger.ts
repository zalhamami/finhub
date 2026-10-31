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
}

export interface LedgerIssue {
  code: 'expense_income_entry_count' | 'transfer_needs_two_accounts' | 'transfer_not_balanced';
  message: string;
}

/**
 * Invariants (see CLAUDE.md). Drafts are never checked.
 * - expense/income: exactly one entry (fee entries are not modelled on these kinds).
 * - transfer: at least two entries; entries in one currency must sum to zero.
 *   Cross-currency transfers keep both amounts: each currency group is not
 *   required to net to zero, but a transfer must involve >= 2 entries.
 *   Fee = extra entry, and is included in the same-currency sum only when the
 *   transfer is entirely single-currency.
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
    if (entries.length < 2) {
      issues.push({
        code: 'transfer_needs_two_accounts',
        message: 'transfer needs at least two entries',
      });
    } else if (new Set(entries.map((e) => e.currency)).size === 1) {
      const sum = entries.reduce((s, e) => s + e.amountMinor, 0n);
      if (sum !== 0n) {
        issues.push({
          code: 'transfer_not_balanced',
          message: `transfer entries sum to ${sum}, expected 0`,
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
