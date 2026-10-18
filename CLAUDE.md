# Tesserax — conventions du dépôt

Plateforme no-code de collecte de données terrain (back-office web + mobile hors ligne).
Spécification : [PROMPT_claude_code_clone_daxium.md](PROMPT_claude_code_clone_daxium.md).
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
pnpm test:integration        # tests API contre la base tesserax_test (infra requise)
docker compose -f infra/docker-compose.yml --profile full up -d --build   # stack complète
```

## Structure

- `apps/api` — NestJS 12 + Prisma 7 (adaptateur `pg`). Client généré dans `src/generated/`
  (non versionné, `prisma generate`). Tests : `src/**/*.test.ts` (unitaires),
  `test/**/*.e2e.test.ts` (intégration, base réelle, fichiers exécutés en série).
- `apps/web` — Vite + React (back-office, Phase 2). `apps/worker` — BullMQ. `apps/mobile` — Expo (Phase 3).
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
