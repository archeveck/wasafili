# syntax=docker/dockerfile:1
# Contexte de build : racine du monorepo.
FROM node:24-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.14.0 --activate
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/i18n/package.json packages/i18n/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile --filter @tesserax/web...
COPY tsconfig.base.json ./
COPY packages/i18n packages/i18n
COPY packages/ui packages/ui
COPY apps/web apps/web
RUN pnpm --filter @tesserax/web... build

FROM nginx:1.29-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
