# Finhub

Self-hosted personal finance hub (IDR-first net worth, spending analysis, holdings later).
See `CLAUDE.md` for conventions.

## Setup

```sh
cp .env.example .env        # edit POSTGRES_PASSWORD / DATABASE_URL
pnpm install
docker compose up db -d     # Postgres 16 on 127.0.0.1:5432
export DATABASE_URL=postgres://finhub:change-me@localhost:5432/finhub
pnpm db:migrate
pnpm db:seed                # idempotent demo workspace, currencies, types, categories
pnpm dev                    # http://localhost:3000/healthz
```

## Checks

```sh
pnpm typecheck && pnpm lint && DATABASE_URL=... pnpm test
```

DB integration tests create and drop a scratch database; they skip if `DATABASE_URL` is unset.

## API (`/api/v1`)

Single-user dev mode: the workspace comes from the `X-Workspace-Id` header, else `DEFAULT_WORKSPACE_ID`, else the seeded `demo` workspace. **No authentication yet** – do not expose beyond localhost.

Resources: `account-types`, `account-groups`, `accounts` (+ `/:id/archive`, `/:id/unarchive`, `PATCH /reorder`), `categories` (nested tree; `?flat=true`), `tags`, `fx-rates`, `transactions` (expense/income/adjustment; filters + cursor pagination; `/:id/archive`, `/:id/unarchive`), `POST /transfers` (optional fee line, `to_amount_minor` when currencies differ), `GET /reports/balances?group_by=kind|group|account&as_of=` and `GET /reports/net-worth?as_of=`. Success bodies are `{ "data": ... }`; errors are `{ "error": { "code", "message", "details?" } }`. Money fields (`*_minor`) are strings.

```sh
curl localhost:3000/api/v1/account-types
curl -X POST localhost:3000/api/v1/accounts -H 'content-type: application/json' \
  -d '{"name":"BCA","type_id":"<id>","opening_balance_minor":"150000000"}'
curl localhost:3000/api/v1/categories
```

```sh
curl -X POST localhost:3000/api/v1/transfers -H 'content-type: application/json' \
  -d '{"occurred_at":"2026-03-01T10:00:00+07:00","from_account_id":"<bank>","to_account_id":"<ewallet>","amount_minor":"10000000","fee_minor":"650000","fee_category_id":"<Biaya admin id>"}'
curl 'localhost:3000/api/v1/reports/net-worth?as_of=2026-03-01'
```

## Transactions model

One transaction = header + entries. Expense (negative), income (positive) and adjustment (signed) have one entry. A transfer has two legs netting to zero (cross-currency keeps both amounts) plus an optional **fee line**: an extra negative entry on the source account carrying an expense `category_id`. Entries with a category on a transfer are fee lines and are ignored by the balance check (core + DB trigger). Archived/draft transactions are excluded from balances and reports; "as of" = end of day Asia/Jakarta.

## Run modes, build, Docker

`ROLE=all|web|worker` (default `all`). `web`/`all` apply migrations on start. The worker is a stub until session 4.

```sh
pnpm build                          # apps/server/dist/index.js (self-contained) + dist/drizzle
DATABASE_URL=... PORT=3000 node apps/server/dist/index.js
docker compose up -d --build        # db + app on 127.0.0.1:3000 (needs POSTGRES_PASSWORD in .env)
```

The web app (session 4) is served from `PUBLIC_DIR` (default `./public` beside the bundle, `/app/dist/public` in the image) with SPA fallback. A `ROLE=worker` container has no HTTP port, so disable the image HEALTHCHECK for it.

## Backup / restore

```sh
infra/backup.sh                     # backups/finhub-<UTC timestamp>.dump, keeps 30 days (BACKUP_DIR, RETENTION_DAYS)
docker compose stop app && infra/restore.sh backups/finhub-....dump   # asks for confirmation (-y to skip)
```
