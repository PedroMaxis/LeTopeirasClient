# syntax=docker/dockerfile:1
# Build context: the repository root (see infra/docker-compose.yml), since the server
# bundles @letopeiras/shared and installs from the workspace lockfile.
#
# Native deps: better-sqlite3 and argon2 ship N-API prebuilds for linux-arm64 and
# linux-x64 (glibc), so this builds as-is on the Ampere instance with no compiler.

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
# Every workspace manifest is needed for `--frozen-lockfile`, even the ones we don't install.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
COPY packages/shared/package.json packages/shared/
COPY native/audio-capture/package.json native/audio-capture/

FROM base AS build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store --filter "@letopeiras/server..."
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN pnpm --filter @letopeiras/server build

FROM base AS deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --store-dir /pnpm/store --filter @letopeiras/server

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/letopeiras.db
WORKDIR /app
# Keep pnpm's layout: apps/server/node_modules symlinks into node_modules/.pnpm.
COPY --from=deps /repo/node_modules node_modules
COPY --from=deps /repo/apps/server/node_modules apps/server/node_modules
COPY --from=build /repo/apps/server/package.json apps/server/
COPY --from=build /repo/apps/server/dist apps/server/dist
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
WORKDIR /app/apps/server
EXPOSE 3000
CMD ["node", "dist/index.mjs"]
