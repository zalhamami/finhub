# Finhub conventions

Self-hosted personal finance hub for an Indonesian user. IDR first; spending analysis is one part; investment holdings later.

## Layout

- `apps/server` – Hono API (`/healthz`, `/health`, `/api/v1`)
- `packages/db` – Drizzle schema, SQL migrations (`drizzle/`), seed, client factory
- `packages/core` – pure TS domain logic (money, ledger validation); no framework imports
- `apps/web` – Vite + React 19 SPA (`@finhub/web`)
- `packages/jobs` – pg-boss setup (`createBoss`, `startWorker`, typed `JobRegistry`); own `pgboss` schema
- `packages/bot` – grammY bot factory (`createBot`), allowlist, `/start`

## Commands

- `pnpm dev` (server :3000 + Vite :5173 with /api proxy) · `pnpm install` · `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm format` · `pnpm build`
- `pnpm db:generate` (after schema change) · `pnpm db:migrate` · `pnpm db:seed` (need `DATABASE_URL`)
- DB tests need a real Postgres via `DATABASE_URL`; they use a scratch database.

## Runtime, build, deploy

- `ROLE` env: `all` (default, HTTP + worker), `web` (HTTP only), `worker` (no HTTP; pg-boss worker only). `all`/`worker` start pg-boss (needs `DATABASE_URL`; jobs registered in `packages/jobs/src/index.ts`, nightly snapshot is M3). Migrations run on startup for `all`/`web`. SIGTERM/SIGINT shut down gracefully.
- `pnpm build` bundles `apps/server` with tsup into one self-contained `apps/server/dist/index.js` (workspace packages and npm deps inlined; no node_modules at runtime), copies `packages/db/drizzle` to `dist/drizzle` and `apps/web/dist` to `dist/public`. Root `pnpm build` runs web first, then server. Run with `node apps/server/dist/index.js`. Migrations folder: `MIGRATIONS_DIR` > `./drizzle` beside the bundle > the `@finhub/db` source folder (dev).
- Static web: `PUBLIC_DIR` (default `./public` beside the bundle) is served with SPA fallback to `index.html` for GET paths outside `/api`, `/healthz`, `/health`; a missing path with a file extension is a 404. Skipped quietly if the dir is absent.
- `Dockerfile` (multi-stage, runtime has only `dist/`), `docker-compose.yml` `app` + `db`. `infra/backup.sh` / `infra/restore.sh` (pg_dump -Fc / pg_restore via `docker compose exec -T db`).

## Telegram

`POST /telegram/webhook/:secret` (grammY `webhookCallback`) is mounted only when `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` are set; the secret is compared in constant time, a wrong one is 404. Only chat ids in `TELEGRAM_ALLOWED_CHAT_IDS` are served (empty = nobody). Local long polling: `pnpm --filter @finhub/bot dev`.

## API conventions (`apps/server`)

- `createApp({ db })` – the Drizzle client is injected (tests pass a scratch-db client). Routes live in `src/routes/*`, shared helpers in `src/lib/*`.
- Success: `{ "data": ... }`. Errors: `{ "error": { "code", "message", "details?" } }` – 400 `validation_error`/`invalid_reference`, 404 `not_found`, 409 (`unique_violation`, `foreign_key_violation`, `*_in_use`, `account_has_entries`, ...), 500 `internal_error`. Throw `ApiError`; Postgres 23505/23503 are mapped to 409 automatically.
- Request bodies/queries are Zod-validated (`v('json'|'query'|'param', schema)`); body schemas are strict (unknown fields -> 400). Wire format is snake_case.
- **bigint over JSON:** every `*_minor` field is a decimal **string** in responses (JSON numbers lose precision > 2^53). Inputs accept a string or a safe integer (int64 range). Never put a JS number through money math.
- **Workspace scoping:** `workspaceMiddleware` sets `c.var.workspaceId` from `X-Workspace-Id`, else env `DEFAULT_WORKSPACE_ID`, else the workspace with slug `DEFAULT_WORKSPACE_SLUG` (default `demo`). Every query filters by `workspace_id`, and every id in a body (`type_id`, `group_id`, `parent_id`, ...) must be verified with `assertOwned` (FKs alone don't prevent cross-workspace references). TODO(auth): the header is trusted; replace with real auth + `workspace_members` before exposing beyond localhost.
- Cursor pagination (`GET /transactions`): `{ data, next_cursor }`, order `occurred_at desc, id desc`, opaque base64url cursor, `limit` default 50 / max 200. Ledger rule violations are 400 `ledger_invalid`; category kind mismatches 400 `category_kind_mismatch`; posting to an archived account 409 `account_archived`.
- Reports never 500 on missing data: accounts with no FX rate / price get `value_base_minor: null` (balances) or are left out of totals (net-worth) and listed in `missing_rates`.
- Liability sign: `netWorth` counts a liability account as `-|value|` (works whether the balance is stored owed-positive or ledger-negative).

## UI

Mantine 9 + CSS Modules only. NO Tailwind / utility CSS, ever. PostCSS: only `postcss-preset-mantine` (+ `postcss-simple-vars`). Theme in `apps/web/src/theme/theme.ts` (amber primary, dark text on fills; sage income, clay expense), globals in `theme/variables.css`. Icons: Tabler, stroke 1.75. UI copy is Indonesian; dayjs locale `id`. Money from the API is a bigint string: `lib/money.ts` -> core `formatIDR`, never `Number`.

## Money & numbers

- Money is bigint minor units. Never JS floats. IDR minor_unit is 2 (ISO), displayed with 0 decimals.
- Units, prices, FX rates are Postgres `numeric` mapped to strings; do math with decimal.js, round half-even once at the end.

## Data model

- Every user-owned table has `workspace_id`.
- A transaction is a header plus entry lines. Transfer = one transaction, two **legs** (entries without `category_id`) netting to zero when currencies match; cross-currency keeps both amounts. Expense/income/adjustment have exactly one entry (expense negative, income positive, adjustment signed; API takes a positive magnitude for expense/income).
- **Fee lines:** on a transfer, an entry **with** a `category_id` is a fee line (negative, on the source account, expense category). Fee lines are excluded from the zero-sum / leg-count checks in `core.validateTransaction` and in the DB trigger (migration `0002`); legs never carry a category. `POST /transfers {fee_minor, fee_category_id}` creates it.
- Transactions have `archived_at`; archived and draft transactions are excluded from balances and reports. As-of dates mean end of day Asia/Jakarta.
- Balance = opening balance + sum(entries).
- Account `kind` enum (cash|bank|ewallet|investment|liability) is fixed; types, groups, categories are user data.
- Liabilities count negative in net worth.
- Posted-transaction integrity is also enforced by a deferred constraint trigger (migration `0001`, fee-line aware since `0002`). Never edit old migrations; add new ones.

## Hygiene

Never commit secrets or real financial data (`.env*` ignored except `.env.example`). Sonnet is enough for regular work.
