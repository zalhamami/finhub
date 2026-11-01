import { registerCurrencies } from './money';

export type AccountKind = 'cash' | 'bank' | 'ewallet' | 'investment' | 'liability';

export interface MissingRate {
  account_id: string;
  account_name: string;
  type: 'fx_rate' | 'price';
}

export interface NetWorthAccount {
  id: string;
  name: string;
  kind: AccountKind;
  currency: string;
  /** ledger balance in the account's own currency (holdings not included) */
  balance_minor: string;
  /** base-currency minor units incl. holdings; liabilities negative; null = no rate / price */
  value_base_minor: string | null;
}

export interface NetWorthReport {
  as_of: string;
  base_currency: string;
  assets_minor: string;
  liabilities_minor: string;
  net_worth_minor: string;
  by_kind: Record<AccountKind, string>;
  accounts: NetWorthAccount[];
  missing_rates: MissingRate[];
}

export interface MonthlyTotals {
  income_minor: string;
  expense_minor: string;
  net_minor: string;
}
export interface MonthlyCategory {
  /** null for the "Lainnya" roll-up */
  category_id: string | null;
  name: string;
  icon: string | null;
  /** palette color NAME */
  color: string | null;
  is_other: boolean;
  amount_minor: string;
  /** share of the month's expense in basis points (4762 = 47,62%) */
  share_bps: number;
  previous_amount_minor: string;
}
export interface MonthlySummary {
  month: string;
  base_currency: string;
  current: MonthlyTotals;
  previous: MonthlyTotals & { month: string; expense_to_date_minor: string };
  compare_day: number;
  /** this month's expense minus last month's through the same day; > 0 = spending faster */
  expense_vs_previous_to_date_minor: string;
  top_categories: MonthlyCategory[];
  transaction_count: number;
  missing_rates: { currency: string; quote: string }[];
  unconverted_count: number;
}
export interface NetWorthPoint {
  date: string;
  net_worth_minor: string;
  assets_minor: string;
  liabilities_minor: string;
  source: 'snapshot' | 'ledger';
  complete: boolean;
}
export interface NetWorthHistory {
  base_currency: string;
  granularity: 'month' | 'week';
  points: NetWorthPoint[];
}

export interface Settings {
  base_currency: string;
  locale: string;
  month_start_day: number;
  timezone: string;
  /** preset name (amber|jade|indigo) or #rrggbb */
  accent: string;
}

export interface ApiAccountType {
  id: string;
  name: string;
  icon: string | null;
  kind: AccountKind;
  has_credit_limit: boolean;
  has_due_day: boolean;
  has_holdings: boolean;
}
export interface ApiAccountGroup {
  id: string;
  name: string;
  sort_order: number;
}
export interface ApiAccount {
  id: string;
  name: string;
  type_id: string;
  group_id: string | null;
  currency: string;
  icon: string | null;
  color: string | null;
  opening_balance_minor: string;
  opening_date: string | null;
  credit_limit_minor: string | null;
  statement_day: number | null;
  due_day: number | null;
  include_in_net_worth: boolean;
  sort_order: number;
  archived_at: string | null;
}
export interface ApiCurrency {
  code: string;
  minor_unit: number;
  display_decimals: number;
  symbol: string;
}
export type CategoryKind = 'expense' | 'income';
export interface ApiCategory {
  id: string;
  parent_id: string | null;
  kind: CategoryKind;
  name: string;
  icon: string | null;
  color: string | null;
  sort_order: number;
  archived_at: string | null;
  children: ApiCategory[];
}
export interface BalancesReport {
  base_currency: string;
  groups: {
    accounts: {
      id: string;
      currency: string;
      balance_minor: string;
      value_base_minor: string | null;
    }[];
  }[];
}

/** Wire payloads for create/patch (money as decimal strings). */
export interface AccountPayload {
  name: string;
  type_id: string;
  group_id: string | null;
  currency: string;
  icon: string | null;
  color: string | null;
  opening_balance_minor: string;
  opening_date: string | null;
  credit_limit_minor: string | null;
  statement_day: number | null;
  due_day: number | null;
  include_in_net_worth: boolean;
}
export interface CategoryPayload {
  name: string;
  kind?: CategoryKind;
  parent_id: string | null;
  icon: string | null;
  color: string | null;
}
export interface AccountTypePayload {
  name: string;
  kind?: AccountKind;
  icon: string | null;
  has_credit_limit: boolean;
  has_due_day: boolean;
  has_holdings: boolean;
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** machine code from the API envelope, e.g. "account_has_entries" */
    readonly code?: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: { method: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method,
    headers: {
      accept: 'application/json',
      ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  let body: { data?: T; error?: { code?: string; message?: string } } | undefined;
  try {
    body = await res.json();
  } catch {
    // non-JSON error body
  }
  if (!res.ok || !body || body.data === undefined) {
    throw new ApiRequestError(
      body?.error?.message ?? `Permintaan gagal (${res.status})`,
      res.status,
      body?.error?.code,
    );
  }
  return body.data;
}

const get = <T>(path: string) => request<T>(path);

export const fetchNetWorth = () => get<NetWorthReport>('/api/v1/reports/net-worth');
export const fetchMonthlySummary = (month: string) =>
  get<MonthlySummary>(`/api/v1/reports/monthly-summary?month=${month}`);
export const fetchNetWorthHistory = (months = 6) =>
  get<NetWorthHistory>(`/api/v1/reports/net-worth-history?months=${months}`);
export interface AccountBalanceHistory {
  currency: string;
  from: string;
  to: string;
  /** end-of-day balance (Asia/Jakarta) in the account's own currency, oldest first */
  points: { date: string; balance_minor: string }[];
  start_balance_minor: string;
  end_balance_minor: string;
}
export const fetchAccountBalanceHistory = (id: string, days = 30) =>
  get<AccountBalanceHistory>(`/api/v1/accounts/${id}/balance-history?days=${days}`);
export const fetchSettings = () => get<Settings>('/api/v1/settings');
export const patchSettings = (body: { accent: string }) =>
  request<Settings>('/api/v1/settings', { method: 'PATCH', body });

export const fetchBalances = () => get<BalancesReport>('/api/v1/reports/balances?group_by=account');
export const fetchAccounts = () => get<ApiAccount[]>('/api/v1/accounts?include_archived=true');
export const fetchAccountTypes = () => get<ApiAccountType[]>('/api/v1/account-types');
export const fetchAccountGroups = () => get<ApiAccountGroup[]>('/api/v1/account-groups');
/** Also feeds the money formatters (lib/money.ts) with the workspace's currency formats. */
export const fetchCurrencies = async () => {
  const list = await get<ApiCurrency[]>('/api/v1/currencies');
  registerCurrencies(list);
  return list;
};
export interface ApiFxRate {
  base: string;
  quote: string;
  date: string;
  /** 1 base = rate quote */
  rate: string;
}
export const fetchFxRates = () => get<ApiFxRate[]>('/api/v1/fx-rates');
export const fetchCategories = () => get<ApiCategory[]>('/api/v1/categories?include_archived=true');

const send = <T>(method: string, path: string, body?: unknown) =>
  request<T>(path, { method, body });

export const createAccount = (body: AccountPayload) =>
  send<ApiAccount>('POST', '/api/v1/accounts', body);
export const updateAccount = (id: string, body: Partial<AccountPayload>) =>
  send<ApiAccount>('PATCH', `/api/v1/accounts/${id}`, body);
export const setAccountArchived = (id: string, archived: boolean) =>
  send<ApiAccount>('POST', `/api/v1/accounts/${id}/${archived ? 'archive' : 'unarchive'}`);
export const deleteAccount = (id: string) =>
  send<{ id: string }>('DELETE', `/api/v1/accounts/${id}`);
export const reorderAccounts = (items: { id: string; sort_order: number }[]) =>
  send<ApiAccount[]>('PATCH', '/api/v1/accounts/reorder', items);

export const createAccountGroup = (name: string) =>
  send<ApiAccountGroup>('POST', '/api/v1/account-groups', { name });

export const createAccountType = (body: AccountTypePayload) =>
  send<ApiAccountType>('POST', '/api/v1/account-types', body);
export const updateAccountType = (id: string, body: Partial<AccountTypePayload>) =>
  send<ApiAccountType>('PATCH', `/api/v1/account-types/${id}`, body);
export const deleteAccountType = (id: string) =>
  send<{ id: string }>('DELETE', `/api/v1/account-types/${id}`);

export const createCategory = (body: CategoryPayload) =>
  send<ApiCategory>('POST', '/api/v1/categories', body);
export const updateCategory = (
  id: string,
  body: Partial<Omit<CategoryPayload, 'kind'>> & { sort_order?: number },
) => send<ApiCategory>('PATCH', `/api/v1/categories/${id}`, body);
export const setCategoryArchived = (id: string, archived: boolean) =>
  send<ApiCategory>('POST', `/api/v1/categories/${id}/${archived ? 'archive' : 'unarchive'}`);
export const deleteCategory = (id: string) =>
  send<{ id: string }>('DELETE', `/api/v1/categories/${id}`);

/* ---------- transactions ---------- */

export type TxKind = 'expense' | 'income' | 'transfer' | 'adjustment';
export interface ApiEntry {
  id: string;
  account_id: string;
  category_id: string | null;
  /** signed minor units (decimal string): expense negative, income positive */
  amount_minor: string;
  currency: string;
  fx_rate: string | null;
  /** transfer fee line (entry with a category on a transfer) */
  is_fee: boolean;
}
export interface ApiTransaction {
  id: string;
  occurred_at: string;
  kind: TxKind;
  payee: string | null;
  note: string | null;
  status: 'posted' | 'draft';
  source: string;
  archived_at: string | null;
  entries: ApiEntry[];
  tag_ids: string[];
}
export interface TransactionPage {
  data: ApiTransaction[];
  next_cursor: string | null;
}

/** POST /transactions body (expense / income). The magnitude is positive; the server signs it. */
export interface SimpleTxBody {
  kind: 'expense' | 'income';
  account_id: string;
  amount_minor: string;
  category_id: string;
  occurred_at: string;
  note: string | null;
  payee: string | null;
}
/** POST /transfers body. */
export interface TransferTxBody {
  from_account_id: string;
  to_account_id: string;
  amount_minor: string;
  to_amount_minor: string | null;
  fee_minor: string | null;
  fee_category_id: string | null;
  occurred_at: string;
  note: string | null;
}

/** Cursor-paged list: `query` is a ready query string (see lib/txFilters filtersToApiQuery). */
export async function fetchTransactionPage(query: string): Promise<TransactionPage> {
  const res = await fetch(`/api/v1/transactions?${query}`, {
    headers: { accept: 'application/json' },
  });
  let body:
    | {
        data?: ApiTransaction[];
        next_cursor?: string | null;
        error?: { code?: string; message?: string };
      }
    | undefined;
  try {
    body = await res.json();
  } catch {
    // non-JSON error body
  }
  if (!res.ok || !body?.data) {
    throw new ApiRequestError(
      body?.error?.message ?? `Permintaan gagal (${res.status})`,
      res.status,
      body?.error?.code,
    );
  }
  return { data: body.data, next_cursor: body.next_cursor ?? null };
}
export const createTransaction = (body: SimpleTxBody) =>
  send<ApiTransaction>('POST', '/api/v1/transactions', body);
export const createTransfer = (body: TransferTxBody) =>
  send<ApiTransaction>('POST', '/api/v1/transfers', body);
/** Edit never changes the kind, so `kind` is stripped for simple transactions. */
export const updateTransaction = (id: string, body: Omit<SimpleTxBody, 'kind'> | TransferTxBody) =>
  send<ApiTransaction>('PATCH', `/api/v1/transactions/${id}`, body);
export const deleteTransaction = (id: string) =>
  send<{ id: string }>('DELETE', `/api/v1/transactions/${id}`);
