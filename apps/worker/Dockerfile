# Contexte de build : racine du monorepo.
FROM node:24-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.14.0 --activate
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/worker/package.json apps/worker/
COPY packages packages
RUN pnpm install --frozen-lockfile --filter @wasafili/worker...
COPY tsconfig.base.json ./
COPY apps/worker apps/worker
RUN pnpm --filter @wasafili/worker... build \
  && pnpm --filter @wasafili/worker deploy --legacy --prod /out \
  && cp -r apps/worker/dist /out/dist

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
USER node
CMD ["node", "dist/main.js"]
