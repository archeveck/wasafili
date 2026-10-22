# Image de l'API, utilisée aussi par le service `migrate` (migrations, seed ou amorçage).
# Contexte de build : racine du monorepo.
FROM node:24-alpine
# Échange de clés TLS classique si TLS_CLASSIC_KEY_EXCHANGE=1 (infra/tls/openssl-classique.cnf).
COPY infra/tls/openssl-classique.cnf /etc/ssl/
ARG OPENSSL_CONF
RUN apk add --no-cache openssl \
  && corepack enable && corepack prepare pnpm@10.14.0 --activate
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY apps/api/package.json apps/api/
COPY packages packages
RUN pnpm install --frozen-lockfile --filter @wasafili/api...

COPY tsconfig.base.json ./
COPY apps/api apps/api
# Construit les paquets partagés puis l'API (ordre topologique).
RUN pnpm --filter @wasafili/api... build

# Dépendances de dev conservées : CLI Prisma et tsx servent au service `migrate`.
# Image dédiée à l'exécution (sans dev deps) : P7.2.
ENV NODE_ENV=production
WORKDIR /repo/apps/api
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
