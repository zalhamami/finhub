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
- `pnpm db:generate` (after schema change) · `pnpm db:migrate` · `pnpm db:seed` · `pnpm db:seed:demo` (need `DATABASE_URL`)
- DB tests need a real Postgres via `DATABASE_URL`; they use a scratch database.

## Runtime, build, deploy

- `ROLE` env: `all` (default, HTTP + worker), `web` (HTTP only), `worker` (no HTTP; pg-boss worker only). `all`/`worker` start pg-boss (needs `DATABASE_URL`; jobs registered in `packages/jobs/src/index.ts`, nightly snapshot is M3). Migrations run on startup for `all`/`web`. SIGTERM/SIGINT shut down gracefully.
- `pnpm build` bundles `apps/server` with tsup into one self-contained `apps/server/dist/index.js` (workspace packages and npm deps inlined; no node_modules at runtime), copies `packages/db/drizzle` to `dist/drizzle` and `apps/web/dist` to `dist/public`. Root `pnpm build` runs web first, then server. Run with `node apps/server/dist/index.js`. Migrations folder: `MIGRATIONS_DIR` > `./drizzle` beside the bundle > the `@finhub/db` source folder (dev).
- Static web: `PUBLIC_DIR` (default `./public` beside the bundle) is served with SPA fallback to `index.html` for GET paths outside `/api`, `/healthz`, `/health`; a missing path with a file extension is a 404. Skipped quietly if the dir is absent.
- `Dockerfile` (multi-stage, runtime has only `dist/`), `docker-compose.yml` `app` + `db`. `infra/backup.sh` / `infra/restore.sh` (pg_dump -Fc / pg_restore via `docker compose exec -T db`).

## Seeds

- Base seed (`packages/db/src/seed.ts`, idempotent): currencies, `demo` workspace, settings, account types, categories; no accounts/transactions. The server runs it at startup (`ROLE=all|web`, after migrations) only on a fresh DB (`seedIfFresh`: no workspace yet), so deleted base data is never resurrected.
- Demo seed (`seed-demo.ts`, `seedDemo(db, {today?, seed?, days?})`): fake data (8 accounts, USD rates, 2 holdings with prices, ~90 days of transactions ending today, deterministic mulberry32 PRNG, validated with core `validateTransaction`). Only when the demo workspace has no accounts. Triggers: `pnpm db:seed:demo`, `node dist/seed.js --demo` (bundled seed CLI, runs migrations first; `docker compose run --rm app node dist/seed.js --demo`), env `DEMO_SEED=true` at startup (default off). CLI logic lives in `seed-cli.ts` (never runs on import; library modules must not have import-time side effects because they are bundled into `dist/index.js`).

## Telegram

`POST /telegram/webhook/:secret` (grammY `webhookCallback`) is mounted only when `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` are set; the secret is compared in constant time, a wrong one is 404. Only chat ids in `TELEGRAM_ALLOWED_CHAT_IDS` are served (empty = nobody). Local long polling: `pnpm --filter @finhub/bot dev`.

## API conventions (`apps/server`)

- `createApp({ db })` – the Drizzle client is injected (tests pass a scratch-db client). Routes live in `src/routes/*`, shared helpers in `src/lib/*`.
- Success: `{ "data": ... }`. Errors: `{ "error": { "code", "message", "details?" } }` – 400 `validation_error`/`invalid_reference`, 404 `not_found`, 409 (`unique_violation`, `foreign_key_violation`, `*_in_use`, `account_has_entries`, ...), 500 `internal_error`. Throw `ApiError`; Postgres 23505/23503 are mapped to 409 automatically.
- Request bodies/queries are Zod-validated (`v('json'|'query'|'param', schema)`); body schemas are strict (unknown fields -> 400). Wire format is snake_case.
- **bigint over JSON:** every `*_minor` field is a decimal **string** in responses (JSON numbers lose precision > 2^53). Inputs accept a string or a safe integer (int64 range). Never put a JS number through money math.
- **Workspace scoping:** `workspaceMiddleware` sets `c.var.workspaceId` from `X-Workspace-Id`, else env `DEFAULT_WORKSPACE_ID`, else the workspace with slug `DEFAULT_WORKSPACE_SLUG` (default `demo`). Every query filters by `workspace_id`, and every id in a body (`type_id`, `group_id`, `parent_id`, ...) must be verified with `assertOwned` (FKs alone don't prevent cross-workspace references). TODO(auth): the header is trusted; replace with real auth + `workspace_members` before exposing beyond localhost.
- Cursor pagination (`GET /transactions`): `{ data, next_cursor }`, order `occurred_at desc, id desc`, opaque base64url cursor, `limit` default 50 / max 200. Ledger rule violations are 400 `ledger_invalid`; category kind mismatches 400 `category_kind_mismatch`; posting to an archived account 409 `account_archived`.
- `GET /currencies`: global read-only list `{ code, minor_unit, display_decimals, symbol }` (feeds the account form's currency Select).
- `GET/PATCH /settings`: `{ base_currency, locale, month_start_day, timezone, accent }`; only `accent` (preset name or `#rrggbb`, lowercased) is writable; a workspace without a row reads defaults and PATCH upserts.
- `GET /reports/net-worth` also returns `accounts[]` (per-account `balance_minor` = ledger balance in the account's own `currency`, holdings excluded, plus `value_base_minor` incl. holdings, liabilities negative, null if unvalued); rows sum to `by_kind`. The net worth page renders from it.
- Reports never 500 on missing data: accounts with no FX rate / price get `value_base_minor: null` (balances) or are left out of totals (net-worth) and listed in `missing_rates`.
- `GET /reports/monthly-summary?month=YYYY-MM` (Beranda; default current Jakarta month; CALENDAR months, `month_start_day` ignored): base-currency `current`/`previous` `{income,expense,net}_minor` (expense includes transfer fee lines; adjustments excluded), `previous.expense_to_date_minor` + `compare_day` + `expense_vs_previous_to_date_minor` (same-day pace; >0 = spending faster), `top_categories` (children roll up to the top-level parent, top 5 + `is_other` "Lainnya", `share_bps`, `previous_amount_minor`), `transaction_count`. Foreign entries convert with the latest fx rate on/before the transaction's own date; no rate -> skipped, listed in `missing_rates`/`unconverted_count`. Pure math in `core/monthly.ts`; loaders in `lib/home-reports.ts`. `createApp({ now })` injects the clock for tests.
- `GET /reports/net-worth-history?months=6&granularity=month|week` (weeks: max 12 months): `points[{date, net_worth_minor, assets_minor, liabilities_minor, source: snapshot|ledger, complete}]`. Month = end of each previous month then today; past dates use a `net_worth_snapshots` row for that exact date if present, else the ledger is replayed (fx on/before the date, holdings at the latest price on/before it, or the current price if none yet; holding units are always current). Today is always live.
- **Access gate:** env `FINHUB_ACCESS_PASSWORD` (+ `FINHUB_ACCESS_USER`, default `demo`); empty = off. When set, `lib/access-gate.ts` (first middleware) requires HTTP Basic on everything except `GET /healthz` and `/telegram/webhook/*`; sha256 + `timingSafeEqual`; 401 + `WWW-Authenticate: Basic realm="Finhub", charset="UTF-8"`. Startup logs `access gate ON|off` only. A demo stopgap, not auth (see README "Demo publik").
- Liability sign: `netWorth` counts a liability account as `-|value|` (works whether the balance is stored owed-positive or ledger-negative).

## UI

Mantine 9 + CSS Modules only. NO Tailwind / utility CSS, ever. PostCSS: only `postcss-preset-mantine` (+ `postcss-simple-vars`). Theme in `apps/web/src/theme/theme.ts` (built from `theme/tokens.ts`; sage income, clay only for overspend), globals in `theme/variables.css`. Icons: Tabler, stroke 1.75. UI copy is Indonesian; dayjs locale `id`. Money from the API is a bigint string: `lib/money.ts` -> core `formatIDR`, never `Number`.

### Forms, pages, shared UI

- Routes: `/` redirects to `/beranda` (BerandaPage, landing: month switcher, spending vs last month + pace hint, top categories -> `/transaksi?category&from&to`, net worth + SVG sparkline (`ui/Sparkline`, no chart lib), recent rows via `features/TransactionRow`), `/kekayaan` (NetWorthPage), `/transaksi`, `/akun`, `/kategori`, `/pengaturan/jenis-akun` (linked from Pengaturan, the mobile "Lainnya" tab together with `/kekayaan` and `/kategori`). Mobile tabs (`components/nav.ts`): Beranda, Transaksi, center Tambah (button, opens the sheet; no FAB), Akun, Lainnya. Pure Beranda logic in `lib/home.ts`.
- Form boundary: `lib/schemas.ts` holds Zod schemas whose input is the raw form strings and whose output is the exact API payload (`accountFormSchema(typeFlags)` only validates/sends credit limit / statement / due day when the type has them). `zodFormResolver` plugs them into `@mantine/form`. Money text goes through `lib/amount.ts` (`parseAmountText` wraps core `parseIdrAmount`; empty = 0, leading `-` negates, `1500,50` = cents) -> bigint minor units sent as strings.
- Pure, tested logic lives in `lib/` (`accounts.ts` kind sections/totals/`moveItem`, `categories.ts` tree flattening, `errors.ts` 409 -> Indonesian message). Features (`features/*Form`, `CategoryTree`) are presentational: data and mutations are injected by the page.
- Shared UI in `ui/`: `AmountInput`, `IconPicker`, `ColorNamePicker` (stores the Mantine color NAME from `lib/palette.ts`, never hex; `expense` clay is not offered), `ResponsiveFormSheet` (Modal >= sm, full-height bottom Drawer below), `ConfirmDialog`, `EntityIcon`. Icons are stored by key (`lib/icons.ts`).

### Foreign currency display

- Accounts in a non-base currency show the own-currency amount as the main figure and "≈ Rp…" (or "kurs belum ada" when there is no rate) as smaller text: `components/AccountAmount` (Akun list, net worth rows), `describeTransaction(tx, accounts, categories, fx)` -> `secondary` (list rows: `≈ base` from `/fx-rates`, latest rate on/before the Jakarta date; cross-currency transfers show `→ received leg`), account picker in `TransactionForm`. Group/section totals, net worth totals and daily subtotals stay in the base currency; the daily subtotal shows base-currency entries only (foreign entries are not converted into it).
- Formatting: `lib/money.ts` `currencyFormat/formatMinorCurrency/foreignValue` (seeded defaults IDR 0 shown, USD `US$` 2, SGD; `fetchCurrencies` registers `/currencies`). Amount parsing is currency-aware: `parseAmountText(text, minorUnit)`, `AmountInput currency=`, `minorToInputText(minor, minorUnit)`; the account/transaction schemas use the account's currency.

### Transactions (UI)

- Pure logic in `lib/transactions.ts` (TDD'd): `txFormSchema(ctx)` (form strings -> `{type, body}` for `POST /transactions` or `POST /transfers`; validates amount > 0, category kind, accounts differ, fee needs a category, cross-currency needs the received amount; empty time = now if the date is today else 12:00, always `+07:00`), `transactionToForm` (edit; null for adjustments), `groupByDay` (Jakarta days, bigint daily net per currency), `describeTransaction` (list row model). Filters <-> URL <-> API query in `lib/txFilters.ts` (URL keys = `TxFilters` keys; `/transaksi` route `validateSearch` drops garbage). Jakarta date helpers in `lib/dates.ts`; category picker data / default fee category ("Biaya Admin", else "Biaya...") in `lib/categories.ts`.
- One add/edit sheet for the whole app: `features/TransactionSheetContext.tsx` (`useTransactionSheet().openCreate/openEdit`; lazy-loads `TransactionSheet`, which owns queries, mutations, invalidation of `transactions`/`accounts`/`reports`, delete confirm). `TransactionForm` is presentational. Entry points: `Layout` header button, the center Tambah tab in `BottomTabs`, desktop key "n" via `lib/shortcuts.ts`. Edit cannot change the type (the API has no kind patch).
- Date pickers: `ui/dates.tsx` (`@mantine/dates`, values are `YYYY-MM-DD` strings, locale `id`); its own `vendor-dates` chunk.

### How to change colors

All colors live in ONE file: `apps/web/src/theme/tokens.ts` (accent palettes `amber`/`jade`/`indigo`, `income` sage, `overspend` clay, `neutralDark`, light/dark `surfaces`, `shadows`).

- **Change the default accent: edit `DEFAULT_ACCENT` in tokens.ts (one line).** The user's choice (Pengaturan > Warna aksen) overrides it, stored in `settings.accent` and cached in localStorage (`finhub.accent`).
- Add a preset: new 10-shade tuple + `ACCENT_PRESETS` entry in tokens.ts, and the name in `apps/server/src/routes/settings.ts`.
- `createFinhubTheme({ accent })` (theme.ts) builds the Mantine theme; `cssVariablesResolver` emits `--finhub-*` (page-bg, surface, chrome, border, text-muted, amount-negative) and re-points Mantine's body/border/dimmed. Components use `var(--finhub-*)` or `var(--mantine-primary-color-N)`, never literals. Custom hex accents go through `generateScale` (theme/accent.ts); text on fills is picked by luminance (dark on amber, white on jade/indigo; keep `autoContrast`).
- **No-hardcoded-color guard:** `apps/web/test/no-hardcoded-colors.test.ts` fails on hex / `rgb()` / `hsl()` etc. literals in `apps/web/src/**/*.{ts,tsx,css}` except `theme/tokens.ts`.
- **Clay (`overspend`, Mantine color `expense`) is reserved for overspending only** (budget over limit). Liabilities, ordinary expenses and error states use neutral text (`Amount tone="neutral"`); the minus sign is enough.

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
