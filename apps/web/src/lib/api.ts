export type AccountKind = 'cash' | 'bank' | 'ewallet' | 'investment' | 'liability';

export interface MissingRate {
  account_id: string;
  account_name: string;
  type: 'fx_rate' | 'price';
}

export interface NetWorthReport {
  as_of: string;
  base_currency: string;
  assets_minor: string;
  liabilities_minor: string;
  net_worth_minor: string;
  by_kind: Record<AccountKind, string>;
  missing_rates: MissingRate[];
}

export interface BalanceAccount {
  id: string;
  name: string;
  kind: AccountKind;
  currency: string;
  value_base_minor: string | null;
}

export interface BalancesReport {
  as_of: string;
  base_currency: string;
  total_base_minor: string;
  groups: {
    key: string | null;
    name: string;
    total_base_minor: string;
    accounts: BalanceAccount[];
  }[];
  missing_rates: MissingRate[];
}

export class ApiRequestError extends Error {}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: 'application/json' } });
  let body: { data?: T; error?: { message?: string } } | undefined;
  try {
    body = await res.json();
  } catch {
    // non-JSON error body
  }
  if (!res.ok || !body || body.data === undefined) {
    throw new ApiRequestError(body?.error?.message ?? `Permintaan gagal (${res.status})`);
  }
  return body.data;
}

export const fetchNetWorth = () => get<NetWorthReport>('/api/v1/reports/net-worth');
export const fetchBalancesByKind = () =>
  get<BalancesReport>('/api/v1/reports/balances?group_by=kind');
