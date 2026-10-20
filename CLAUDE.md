# Wasafili — conventions du dépôt

Plateforme no-code de collecte de données terrain (back-office web + mobile hors ligne).
Spécification : [PROMPT_claude_code_clone_daxium.md](prompt/PROMPT_claude_code_clone_daxium.md).
Découpage et décisions (D1–D14) : [TASKS.md](TASKS.md) — cocher les tâches au fil de l'eau.
Décisions structurantes : [docs/adr/](docs/adr/).

## Commandes

```bash
pnpm install                 # dépendances (Node >= 24, pnpm 10)
cp .env.example .env         # configuration locale
pnpm infra:up                # postgres, redis, minio (+ bucket), gotenberg, mailpit
pnpm db:migrate              # migrations Prisma (rôle propriétaire) — dev
pnpm db:seed                 # instance « demo » + 3 utilisateurs
pnpm dev                     # api (:3000), web (:5173), worker
pnpm lint && pnpm typecheck && pnpm test   # vérifications rapides (sans base)
pnpm test:integration        # tests API contre la base wasafili_test (infra requise)
cd infra && docker compose up -d --build   # stack complète
```

## Structure

- `apps/api` — NestJS 12 + Prisma 7 (adaptateur `pg`). Client généré dans `src/generated/`
  (non versionné, `prisma generate`). Tests : `src/**/*.test.ts` (unitaires),
  `test/**/*.e2e.test.ts` (intégration, base réelle, fichiers exécutés en série).
- `apps/web` — back-office : React 19, TanStack Router (routes déclarées dans `src/router.tsx`)
  / Query / Table v8, Tailwind 4 + composants Radix façon shadcn (`src/components/ui`), dnd-kit
  (designer). Fonctionnalités dans `src/features/*`, rendu des champs dans `src/form`. API via
  `@wasafili/sdk` sous la même origine (`/v1` : proxy Vite en dev, nginx en conteneur).
  e2e : `pnpm test:e2e` (Playwright, `apps/web/e2e`).
- `apps/worker` — BullMQ ; jobs typés par `@wasafili/jobs` (contrat partagé avec l'API).
- `apps/mobile` — Expo SDK 58 (Expo Router, `src/app`). **Ne pas se fier à la mémoire pour les
  API Expo** : consulter https://docs.expo.dev/versions/v58.0.0/ ; ajouter un module avec
  `npx expo install`. React est épinglé à la même version exacte dans tout le monorepo (un seul
  exemplaire, sinon « invalid hook call »). Données : `@wasafili/sync` (base SQLite locale, file
  d'envoi, moteur) ; jamais d'appel API direct pour lire ou écrire des fiches.
  e2e : Maestro (`apps/mobile/e2e`, simulateur iOS + Expo Go : `pnpm start` = `expo start --go`).
  Builds : `eas.json` (profils, `APP_VARIANT`) ou `expo prebuild` + Gradle/Xcode (D2).
- `packages/sync` — stockage local et moteur de synchronisation, indépendants de la plateforme
  (testés avec `node:sqlite`).
- `packages/*` — ESM, compilés vers `dist/` (`turbo` construit les dépendances avant
  typecheck/test). `form-schema` et `form-engine` : zéro dépendance Node/DOM (Hermes).

## Règles

- **Multi-tenant (ADR 0001)** : toute table métier porte `instance_id`, active et force la RLS
  avec la policy `tenant_isolation` dans sa migration, et référence les autres tables d'instance
  par FK composite `(id, instance_id)`. Le test générique de `rls.e2e.test.ts` échoue sinon.
- Accès base **uniquement** via `PrismaService.db` (contexte RLS automatique) ou
  `PrismaService.transaction()`. Hors requête HTTP : `runWithContext()`. Ne jamais sortir
  d'un contexte une requête Prisma non attendue (elles sont paresseuses).
- Routes d'instance : `@Controller(':app/…')` + `@Can('permission')`. Les guards globaux
  (JWT → instance → permission) résolvent l'instance, vérifient l'adhésion et posent le contexte.
  Routes sans jeton : `@Public()`.
- Validation des entrées : `ZodValidationPipe` (Zod 4). Erreurs : `{ statusCode, error, message,
  details? }` ; codes `error` en snake_case.
- API : préfixe `/v1`, attributs JSON en camelCase, pagination `page`/`per_page` →
  `{ data, meta: { page, perPage, total, totalPages } }`, `fields=` géré globalement.
- UI et messages en français ; textes partagés dans `packages/i18n` (fr/en, clés identiques).
  Dates stockées en UTC (`timestamptz`), affichées en `Africa/Abidjan` par défaut (D14).
- Commits conventionnels (commitlint), petits et atomiques ; tests verts avant de clore une tâche.
- **Formulaires** : toute évaluation (conditions, calculs, validation, défauts) passe par
  `@wasafili/form-engine`, jamais par du code ad hoc côté API, web ou mobile. Le paquet reste
  sans dépendance Node/DOM et à 100 % de couverture (`pnpm --filter @wasafili/form-engine test`).
  Fixtures partagées : `inspectionEquipement()` dans `@wasafili/form-schema`.
- **Droits sur les fiches** : évalués par structure dans `StructureAccessService` (règles par
  rôle/groupe + filtres de visibilité, repli sur les permissions d'instance) — jamais par `@Can`
  sur les routes de fiches.
- **Workflow, tâches, notifications (ADR 0008)** : transitions vérifiées par `checkTransition`
  (`form-engine`) partout ; l'historique des révisions (`transition`, `$state`) est le journal
  d'événements. Une notification s'écrit dans la transaction de l'événement
  (`NotificationsService.notify`), le push n'est qu'un relais (`dispatch` après validation).
- **Rapports, automatisations, webhooks (ADR 0009)** : une écriture de fiche passe par
  `EventsService.record` dans sa transaction (exécutions + livraisons, outbox) puis `dispatch`.
  Les automatisations s'exécutent dans l'API (file `wasafili-automations`), via les services
  métier et `SYSTEM_ACTOR` ; le worker ne fait que les relais (SMTP, webhooks, push). Jamais de
  XML brut issu d'une saisie dans un rapport. Acceptation : `infra/acceptance/rapport-par-email.mjs`.
- **Pilotage (ADR 0010)** : carte, widgets et export ZIP partent de `SubmissionsService.query()`
  (jamais un filtre ou un droit recodé). Toute action d'administration, de droits ou d'export
  porte `@Audit('famille.action')` (liste `AUDIT_ACTIONS`, libellés `audit.actions` dans
  `packages/i18n`) ; `audit_logs` est en ajout seul. Fond de carte : `infra/maps/fetch-basemap.sh`
  (servi sous `/tiles/`).
- **API publique et exploitation (ADR 0011)** : une route se résume en JSDoc (résumé de
  l'OpenAPI), trouve sa section dans `TAGS` (`openapi/document.ts`) ; une ressource publique
  déclare sa réponse (`@OpenApi`, schéma dans `openapi/resources.ts`, vérifié en intégration) ;
  le SDK la couvre (test). Puis `pnpm --filter @wasafili/api openapi` (fichier versionné).
  Fichiers : types actifs refusés, signature vérifiée (`files/content-types.ts`). Pile Docker :
  `cd infra && docker compose up` (pas de compose à la racine : le `.env` de dev s'y
  appliquerait) ; production : `docker-compose.prod.yml`, procédure `docs/exploitation.md`.
- **Migrations Prisma** : `migrate dev --create-only`, retirer les `DROP INDEX "*_sync"` générés
  (index `xid8` écrits à la main), puis `pnpm db:deploy`.
- **Synchronisation (ADR 0007)** : toute table synchronisée porte `sync_txid` (trigger
  `touch_sync_txid`) ; une nouvelle ressource mobile s'ajoute au pull avec curseur `(sync_txid, id)`.
  Les mutations hors ligne passent par les mêmes services que l'API (droits, validation).
- **Fiches** : le serveur fait foi pour les champs calculés et automatiques (il les retire de
  l'entrée et les recalcule). Une fiche reste liée à sa version de structure, et une version
  publiée est immuable (trigger). Chaque écriture crée une `SubmissionRevision` ; un
  `clientMutationId` rejoué ne réapplique rien.
- Nouvelle dépendance lourde ou décision structurante → ADR dans `docs/adr/`.

<!-- rtk-instructions v2 -->
# RTK (Rust Token Killer) - Token-Optimized Commands

## Golden Rule

**Always prefix commands with `rtk`**. If RTK has a dedicated filter, it uses it. If not, it passes through unchanged. This means RTK is always safe to use.

**Important**: Even in command chains with `&&`, use `rtk`:
```bash
# ❌ Wrong
git add . && git commit -m "msg" && git push

# ✅ Correct
rtk git add . && rtk git commit -m "msg" && rtk git push
```

## RTK Commands by Workflow

### Build & Compile (80-90% savings)
```bash
rtk cargo build         # Cargo build output
rtk cargo check         # Cargo check output
rtk cargo clippy        # Clippy warnings grouped by file (80%)
rtk tsc                 # TypeScript errors grouped by file/code (83%)
rtk lint                # ESLint/Biome violations grouped (84%)
rtk prettier --check    # Files needing format only (70%)
rtk next build          # Next.js build with route metrics (87%)
```

### Test (60-99% savings)
```bash
rtk cargo test          # Cargo test failures only (90%)
rtk go test             # Go test failures only (90%)
rtk jest                # Jest failures only (99.5%)
rtk vitest              # Vitest failures only (99.5%)
rtk playwright test     # Playwright failures only (94%)
rtk pytest              # Python test failures only (90%)
rtk rake test           # Ruby test failures only (90%)
rtk rspec               # RSpec test failures only (60%)
rtk test <cmd>          # Generic test wrapper - failures only
```

### Git (59-80% savings)
```bash
rtk git status          # Compact status
rtk git log             # Compact log (works with all git flags)
rtk git diff            # Compact diff (80%)
rtk git show            # Compact show (80%)
rtk git add             # Ultra-compact confirmations (59%)
rtk git commit          # Ultra-compact confirmations (59%)
rtk git push            # Ultra-compact confirmations
rtk git pull            # Ultra-compact confirmations
rtk git branch          # Compact branch list
rtk git fetch           # Compact fetch
rtk git stash           # Compact stash
rtk git worktree        # Compact worktree
```

Note: Git passthrough works for ALL subcommands, even those not explicitly listed.

### GitHub (26-87% savings)
```bash
rtk gh pr view <num>    # Compact PR view (87%)
rtk gh pr checks        # Compact PR checks (79%)
rtk gh run list         # Compact workflow runs (82%)
rtk gh issue list       # Compact issue list (80%)
rtk gh api              # Compact API responses (26%)
```

### JavaScript/TypeScript Tooling (70-90% savings)
```bash
rtk pnpm list           # Compact dependency tree (70%)
rtk pnpm outdated       # Compact outdated packages (80%)
rtk pnpm install        # Compact install output (90%)
rtk npm run <script>    # Compact npm script output
rtk npx <cmd>           # Compact npx command output
rtk prisma              # Prisma without ASCII art (88%)
rtk uv run <cmd>        # Compact uv project command output
```

### Files & Search (60-75% savings)
```bash
rtk ls <path>           # Tree format, compact (65%)
rtk read <file>         # Code reading with filtering (60%)
rtk grep <pattern>      # Search grouped by file (75%). Format flags (-c, -l, -L, -o, -Z) run raw.
rtk find <pattern>      # Find grouped by directory (70%)
```

### Analysis & Debug (70-90% savings)
```bash
rtk err <cmd>           # Filter errors only from any command
rtk log <file>          # Deduplicated logs with counts
rtk json <file>         # JSON structure without values
rtk deps                # Dependency overview
rtk env                 # Environment variables compact
rtk summary <cmd>       # Smart summary of command output
rtk diff                # Ultra-compact diffs
```

### Infrastructure (85% savings)
```bash
rtk docker ps           # Compact container list
rtk docker images       # Compact image list
rtk docker logs <c>     # Deduplicated logs
rtk kubectl get         # Compact resource list
rtk kubectl logs        # Deduplicated pod logs
```

### Network (65-70% savings)
```bash
rtk curl <url>          # Compact HTTP responses (70%)
rtk wget <url>          # Compact download output (65%)
```

### Meta Commands
```bash
rtk gain                # View token savings statistics
rtk gain --history      # View command history with savings
rtk discover            # Analyze Claude Code sessions for missed RTK usage
rtk proxy <cmd>         # Run command without filtering (for debugging)
rtk init                # Add RTK instructions to CLAUDE.md
rtk init --global       # Add RTK to ~/.claude/CLAUDE.md
```

## Token Savings Overview

| Category | Commands | Typical Savings |
|----------|----------|-----------------|
| Tests | vitest, playwright, cargo test | 90-99% |
| Build | next, tsc, lint, prettier | 70-87% |
| Git | status, log, diff, add, commit | 59-80% |
| GitHub | gh pr, gh run, gh issue | 26-87% |
| Package Managers | pnpm, npm, npx | 70-90% |
| Files | ls, read, grep, find | 60-75% |
| Infrastructure | docker, kubectl | 85% |
| Network | curl, wget | 65-70% |

Overall average: **60-90% token reduction** on common development operations.
<!-- /rtk-instructions -->
