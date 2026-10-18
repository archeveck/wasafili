# Tesserax

Plateforme no-code de collecte de données terrain : back-office web pour concevoir des
formulaires (structures), workflows et rapports ; application mobile **100 % hors ligne** pour
la saisie sur chantier. Conçue pour les PME BTP / maintenance / QHSE en Côte d'Ivoire.

> État : **Phase 0 — Socle** livrée (monorepo, infra, API NestJS, auth OAuth2, multi-tenant
> RLS, RBAC, seed). Feuille de route : [TASKS.md](TASKS.md).

## Démarrage rapide

Prérequis : Node ≥ 24, pnpm 10 (`corepack enable`), Docker.

```bash
pnpm install
cp .env.example .env
pnpm infra:up          # PostgreSQL 16, Redis, MinIO, Gotenberg, Mailpit
pnpm db:migrate        # applique les migrations
pnpm db:seed           # données de démo
pnpm dev               # API sur http://localhost:3000, web sur http://localhost:5173
```

Stack complète conteneurisée (migrations + seed automatiques, derrière Traefik) :

```bash
docker compose -f infra/docker-compose.yml --profile full up -d --build
curl -H 'Host: api.localhost' http://localhost:8080/health
```

| Service                  | URL locale                                                 |
| ------------------------ | ---------------------------------------------------------- |
| API (dev)                | http://localhost:3000 — via Traefik : `api.localhost:8080` |
| Back-office (dev)        | http://localhost:5173 — via Traefik : `app.localhost:8080` |
| PostgreSQL               | `localhost:5440`                                           |
| Console MinIO            | http://localhost:9001                                      |
| Mailpit (e-mails de dev) | http://localhost:8025                                      |
| Gotenberg                | http://localhost:3001                                      |

Les ports se changent dans `.env` (voir [.env.example](.env.example)).

## Démo (Phase 0)

Comptes de démonstration de l'instance `demo` (mot de passe `Tesserax2026!`) :
`admin@tesserax.local`, `superviseur@tesserax.local`, `technicien@tesserax.local`.

```bash
# 1. Connexion (grant password)
curl -s localhost:3000/v1/oauth/token -d grant_type=password \
  -d username=admin@tesserax.local -d 'password=Tesserax2026!'
# → { access_token, token_type: "Bearer", expires_in: 900, refresh_token }

TOKEN=...   # access_token
# 2. Instances accessibles, puis membres de l'instance (pagination + fields=)
curl -s localhost:3000/v1/apps -H "Authorization: Bearer $TOKEN"
curl -s 'localhost:3000/v1/demo/users?per_page=2&fields=email,role' -H "Authorization: Bearer $TOKEN"
# 3. Le technicien n'a pas le droit de lister les membres → 403
# 4. Renouvellement : grant_type=refresh_token&refresh_token=… ; déconnexion : POST /v1/oauth/revoke
```

## Vérifications

```bash
pnpm lint && pnpm typecheck && pnpm test   # sans base de données
pnpm test:integration                      # API contre PostgreSQL/Redis (infra démarrée)
```

Les tests d'intégration couvrent le parcours de session (login → appel protégé → refresh →
logout), la rotation et la détection de réutilisation des refresh tokens, le grant
`client_credentials`, la limitation de débit, l'**isolation entre instances** (au niveau base
et HTTP) et la matrice de droits des rôles système.

## Architecture

```
apps/
  api/      NestJS + Prisma + PostgreSQL 16 (RLS)
  web/      React + Vite (back-office, Phase 2)
  mobile/   Expo (Phase 3)
  worker/   BullMQ (PDF, e-mails, automatisations, webhooks)
packages/
  form-schema/ form-engine/ form-renderer/ sdk/ ui/ i18n/
infra/      docker-compose (postgres, redis, minio, gotenberg, mailpit, traefik, apps)
docs/adr/   décisions d'architecture
```

- [ADR 0001 — Multi-tenant (RLS)](docs/adr/0001-multi-tenant.md)
- [ADR 0002 — Authentification OAuth2](docs/adr/0002-auth.md)

Conventions de code et commandes détaillées : [CLAUDE.md](CLAUDE.md).
