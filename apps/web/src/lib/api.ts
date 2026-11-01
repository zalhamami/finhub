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
    accounts: { id: string; value_base_minor: string | null }[];
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
export const fetchSettings = () => get<Settings>('/api/v1/settings');
export const patchSettings = (body: { accent: string }) =>
  request<Settings>('/api/v1/settings', { method: 'PATCH', body });

export const fetchBalances = () => get<BalancesReport>('/api/v1/reports/balances?group_by=account');
export const fetchAccounts = () => get<ApiAccount[]>('/api/v1/accounts?include_archived=true');
export const fetchAccountTypes = () => get<ApiAccountType[]>('/api/v1/account-types');
export const fetchAccountGroups = () => get<ApiAccountGroup[]>('/api/v1/account-groups');
export const fetchCurrencies = () => get<ApiCurrency[]>('/api/v1/currencies');
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
