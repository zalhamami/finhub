# syntax=docker/dockerfile:1
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm CI=true
RUN corepack enable
WORKDIR /app

# ---- deps: install with only the manifests copied, so this layer caches until deps change ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
# Later workspaces (apps/web, packages/bot, packages/jobs): add their package.json COPY lines here.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ---- build: self-contained server bundle (dist/index.js + dist/drizzle) ----
FROM deps AS build
COPY tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm --filter @finhub/server build
# OPTIONAL web build (session 4): skipped while apps/web does not exist. When it does, its build output
# must land in /app/apps/server/dist/public (Vite: set build.outDir or copy it as below).
RUN if [ -d apps/web ]; then \
      pnpm --filter web build && cp -r apps/web/dist apps/server/dist/public; \
    else \
      mkdir -p apps/server/dist/public; \
    fi

# ---- runtime: the bundle needs no node_modules ----
FROM node:22-slim AS runtime
ENV NODE_ENV=production PORT=3000 ROLE=all
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/server/dist ./dist
USER node
EXPOSE 3000
# Applies to ROLE=all|web. A ROLE=worker container has no HTTP port: override/disable the healthcheck there.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/index.js"]
