# syntax=docker/dockerfile:1
# Image de l'API, utilisée aussi par le service `migrate` (prisma migrate deploy + seed).
# Contexte de build : racine du monorepo.
FROM node:24-alpine
RUN apk add --no-cache openssl \
  && corepack enable && corepack prepare pnpm@10.14.0 --activate
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY apps/api/package.json apps/api/
COPY packages/form-schema/package.json packages/form-schema/
COPY packages/form-engine/package.json packages/form-engine/
RUN pnpm install --frozen-lockfile --filter @tesserax/api...

COPY tsconfig.base.json ./
COPY packages/form-schema packages/form-schema
COPY packages/form-engine packages/form-engine
COPY apps/api apps/api
# Construit les paquets partagés puis l'API (ordre topologique).
RUN pnpm --filter @tesserax/api... build

# Dépendances de dev conservées : CLI Prisma et tsx servent au service `migrate`.
# Image dédiée à l'exécution (sans dev deps) : P7.2.
ENV NODE_ENV=production
WORKDIR /repo/apps/api
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
