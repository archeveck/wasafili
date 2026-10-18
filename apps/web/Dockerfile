# syntax=docker/dockerfile:1
# Contexte de build : racine du monorepo.
FROM node:24-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.14.0 --activate
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages packages
RUN pnpm install --frozen-lockfile --filter @tesserax/web...
COPY tsconfig.base.json ./
COPY apps/web apps/web
# Paquets partagés (form-schema, form-engine, sdk…) puis le back-office.
RUN pnpm --filter @tesserax/web... build

FROM nginx:1.29-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
