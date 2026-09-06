# syntax=docker/dockerfile:1

# Base: Dependencies for the whole workspace
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# Manifests only
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json ./packages/contracts/
COPY apps/api/package.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

# Build: contracts, then each app
FROM base AS build
COPY . .
RUN pnpm --filter @url-checker/contracts build
RUN pnpm --filter @url-checker/api build
RUN pnpm --filter @url-checker/worker build

# API runtime
FROM node:22-alpine AS api
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json ./packages/contracts/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/migrations ./apps/api/migrations

EXPOSE 4000
CMD ["node", "apps/api/dist/index.js"]

# Worker runtime
FROM node:22-alpine AS worker
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json ./packages/contracts/
COPY apps/worker/package.json ./apps/worker/
RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/apps/worker/dist ./apps/worker/dist

# No EXPOSE — the worker serves no HTTP. Process separation, enforced.
CMD ["node", "apps/worker/dist/index.js"]

# Web runtime
FROM base AS web-build
COPY . .
RUN pnpm --filter @url-checker/contracts build
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter @url-checker/web build

FROM node:22-alpine AS web
WORKDIR /app
ENV NODE_ENV=production

# Next standalone output bundles only the traced dependencies.
COPY --from=web-build /app/apps/web/.next/standalone ./
COPY --from=web-build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build /app/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["node", "apps/web/server.js"]