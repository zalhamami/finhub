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
