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

export class ApiRequestError extends Error {}

async function request<T>(path: string, init?: { method: string; body: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method,
    headers: {
      accept: 'application/json',
      ...(init ? { 'content-type': 'application/json' } : {}),
    },
    body: init ? JSON.stringify(init.body) : undefined,
  });
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

const get = <T>(path: string) => request<T>(path);

export const fetchNetWorth = () => get<NetWorthReport>('/api/v1/reports/net-worth');
export const fetchSettings = () => get<Settings>('/api/v1/settings');
export const patchSettings = (body: { accent: string }) =>
  request<Settings>('/api/v1/settings', { method: 'PATCH', body });
