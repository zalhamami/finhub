# Finhub conventions

Self-hosted personal finance hub for an Indonesian user. IDR first; spending analysis is one part; investment holdings later.

## Layout

- `apps/server` – Hono API (`/healthz`, `/health`, `/api/v1`)
- `packages/db` – Drizzle schema, SQL migrations (`drizzle/`), seed, client factory
- `packages/core` – pure TS domain logic (money, ledger validation); no framework imports
- Later: `apps/web`, `packages/bot`, `packages/jobs`

## Commands

- `pnpm install` · `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm format`
- `pnpm db:generate` (after schema change) · `pnpm db:migrate` · `pnpm db:seed` (need `DATABASE_URL`)
- DB tests need a real Postgres via `DATABASE_URL`; they use a scratch database.

## UI

Mantine 9 + CSS Modules only. NO Tailwind / utility CSS, ever.

## Money & numbers

- Money is bigint minor units. Never JS floats. IDR minor_unit is 2 (ISO), displayed with 0 decimals.
- Units, prices, FX rates are Postgres `numeric` mapped to strings; do math with decimal.js, round half-even once at the end.

## Data model

- Every user-owned table has `workspace_id`.
- A transaction is a header plus entry lines. Transfer = one transaction, two entries netting to zero when currencies match; cross-currency keeps both amounts. Expense/income have exactly one account entry. Fee = extra entry.
- Balance = opening balance + sum(entries).
- Account `kind` enum (cash|bank|ewallet|investment|liability) is fixed; types, groups, categories are user data.
- Liabilities count negative in net worth.
- Posted-transaction integrity is also enforced by a deferred constraint trigger (migration `0001`).

## Hygiene

Never commit secrets or real financial data (`.env*` ignored except `.env.example`). Sonnet is enough for regular work.
