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

## API conventions (`apps/server`)

- `createApp({ db })` – the Drizzle client is injected (tests pass a scratch-db client). Routes live in `src/routes/*`, shared helpers in `src/lib/*`.
- Success: `{ "data": ... }`. Errors: `{ "error": { "code", "message", "details?" } }` – 400 `validation_error`/`invalid_reference`, 404 `not_found`, 409 (`unique_violation`, `foreign_key_violation`, `*_in_use`, `account_has_entries`, ...), 500 `internal_error`. Throw `ApiError`; Postgres 23505/23503 are mapped to 409 automatically.
- Request bodies/queries are Zod-validated (`v('json'|'query'|'param', schema)`); body schemas are strict (unknown fields -> 400). Wire format is snake_case.
- **bigint over JSON:** every `*_minor` field is a decimal **string** in responses (JSON numbers lose precision > 2^53). Inputs accept a string or a safe integer (int64 range). Never put a JS number through money math.
- **Workspace scoping:** `workspaceMiddleware` sets `c.var.workspaceId` from `X-Workspace-Id`, else env `DEFAULT_WORKSPACE_ID`, else the workspace with slug `DEFAULT_WORKSPACE_SLUG` (default `demo`). Every query filters by `workspace_id`, and every id in a body (`type_id`, `group_id`, `parent_id`, ...) must be verified with `assertOwned` (FKs alone don't prevent cross-workspace references). TODO(auth): the header is trusted; replace with real auth + `workspace_members` before exposing beyond localhost.
- Liability sign: `netWorth` counts a liability account as `-|value|` (works whether the balance is stored owed-positive or ledger-negative).

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
