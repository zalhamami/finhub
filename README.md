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

Resources: `account-types`, `account-groups`, `accounts` (+ `/:id/archive`, `/:id/unarchive`, `PATCH /reorder`), `categories` (nested tree; `?flat=true`). Success bodies are `{ "data": ... }`; errors are `{ "error": { "code", "message", "details?" } }`. Money fields (`*_minor`) are strings.

```sh
curl localhost:3000/api/v1/account-types
curl -X POST localhost:3000/api/v1/accounts -H 'content-type: application/json' \
  -d '{"name":"BCA","type_id":"<id>","opening_balance_minor":"150000000"}'
curl localhost:3000/api/v1/categories
```
