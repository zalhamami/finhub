import type {
  AccountKind,
  ApiAccount,
  ApiAccountGroup,
  ApiAccountType,
  BalancesReport,
  NetWorthReport,
} from './api';
import { asLiability, parseMinor } from './money';

export const KIND_ORDER: readonly AccountKind[] = [
  'cash',
  'bank',
  'ewallet',
  'investment',
  'liability',
];

export const KIND_LABEL: Record<AccountKind, string> = {
  cash: 'Kas',
  bank: 'Bank',
  ewallet: 'E-wallet',
  investment: 'Investasi',
  liability: 'Liabilitas',
};

export interface AccountRow {
  account: ApiAccount;
  kind: AccountKind;
  typeName: string;
  typeIcon: string | null;
  groupName: string | null;
  /** base-currency minor units (decimal string); liabilities negative; null = unknown / archived */
  value: string | null;
  /**
   * Ledger balance in the account's own currency (liabilities negative), only for accounts whose
   * balance IS their value (no holdings); null otherwise or for archived accounts.
   */
  native: string | null;
  archived: boolean;
}

export interface AccountSection {
  kind: AccountKind;
  label: string;
  /** sum of the known values of the active rows (decimal string) */
  total: string;
  rows: AccountRow[];
}

/**
 * Per-account display value. Net worth values (holdings included) win; accounts outside the
 * net worth (excluded from it) fall back to the plain balance report. Archived accounts have none.
 */
export function resolveValues(
  balances: BalancesReport | undefined,
  netWorth: NetWorthReport | undefined,
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const g of balances?.groups ?? [])
    for (const a of g.accounts) out.set(a.id, a.value_base_minor);
  for (const a of netWorth?.accounts ?? []) out.set(a.id, a.value_base_minor);
  return out;
}

/** Per-account ledger balance in the account's own currency (decimal string). */
export function resolveNatives(
  balances: BalancesReport | undefined,
  netWorth: NetWorthReport | undefined,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const g of balances?.groups ?? [])
    for (const a of g.accounts) out.set(a.id, a.balance_minor);
  for (const a of netWorth?.accounts ?? []) out.set(a.id, a.balance_minor);
  return out;
}

export const bySortOrder = (a: ApiAccount, b: ApiAccount) =>
  a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'id');

export interface SectionInput {
  accounts: ApiAccount[];
  types: ApiAccountType[];
  groups: ApiAccountGroup[];
  values: Map<string, string | null>;
  /** own-currency balances (resolveNatives); optional */
  natives?: Map<string, string>;
  showArchived: boolean;
}

/** Accounts -> kind sections (fixed order, empty ones omitted), rows sorted, totals summed in bigint. */
export function buildAccountSections(input: SectionInput): AccountSection[] {
  const typeById = new Map(input.types.map((t) => [t.id, t]));
  const groupById = new Map(input.groups.map((g) => [g.id, g.name]));
  const sections: AccountSection[] = [];
  for (const kind of KIND_ORDER) {
    const rows: AccountRow[] = input.accounts
      .filter((a) => typeById.get(a.type_id)?.kind === kind)
      .filter((a) => input.showArchived || !a.archived_at)
      .sort(bySortOrder)
      .map((account) => {
        const archived = account.archived_at !== null;
        const raw = archived ? null : (input.values.get(account.id) ?? null);
        const type = typeById.get(account.type_id)!;
        const nativeRaw =
          archived || type.has_holdings ? null : (input.natives?.get(account.id) ?? null);
        return {
          account,
          kind,
          native: kind === 'liability' ? asLiability(nativeRaw) : nativeRaw,
          typeName: typeById.get(account.type_id)!.name,
          typeIcon: typeById.get(account.type_id)!.icon,
          groupName: account.group_id ? (groupById.get(account.group_id) ?? null) : null,
          value: kind === 'liability' ? asLiability(raw) : raw,
          archived,
        };
      });
    if (rows.length === 0) continue;
    const total = rows.reduce((sum, r) => sum + (parseMinor(r.value) ?? 0n), 0n);
    sections.push({ kind, label: KIND_LABEL[kind], total: total.toString(), rows });
  }
  return sections;
}

export interface SortUpdate {
  id: string;
  sort_order: number;
}

/**
 * Move one item up/down in an ordered list and return the sort_order updates to send:
 * the list is renumbered 0..n-1 and only items whose number changed are returned.
 * Empty when the move is a no-op (first item up / last item down / unknown id).
 */
export function moveItem(
  items: readonly { id: string; sort_order: number }[],
  id: string,
  dir: 'up' | 'down',
): SortUpdate[] {
  const from = items.findIndex((i) => i.id === id);
  const to = dir === 'up' ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= items.length) return [];
  const order = items.map((i) => i.id);
  [order[from], order[to]] = [order[to]!, order[from]!];
  const before = new Map(items.map((i) => [i.id, i.sort_order]));
  return order
    .map((itemId, index) => ({ id: itemId, sort_order: index }))
    .filter((u) => before.get(u.id) !== u.sort_order);
}
