# Tesserax

Plateforme no-code de collecte de données terrain : back-office web pour concevoir des
formulaires (structures), workflows et rapports ; application mobile **100 % hors ligne** pour
la saisie sur chantier. Conçue pour les PME BTP / maintenance / QHSE en Côte d'Ivoire.

> État : Phases **0 (socle)**, **1 (moteur de formulaires)** et **2 (back-office web)**
> livrées : designer de formulaires par glisser-déposer avec aperçu mobile, fiches (tableau,
> filtres, export, historique), référentiels (arbre, import/export), utilisateurs, rôles,
> groupes, droits par formulaire, personnalisation, fichiers et miniatures.
> Feuille de route : [TASKS.md](TASKS.md).

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

## Démo du back-office (Phase 2)

Ouvrir http://localhost:5173 (ou http://app.localhost:8080 avec la stack conteneurisée) et se
connecter avec `admin@tesserax.local` / `Tesserax2026!` :

1. **Formulaires → Nouveau formulaire** : glisser des champs depuis la palette, régler leurs
   propriétés (validation, valeur par défaut, référentiel en cascade, formule de calcul,
   conditions « Visible si » / « Obligatoire si »), contrôler le rendu dans **Aperçu mobile**,
   **Comparer** avec la version publiée, puis **Publier**.
2. **Fiches** d'un formulaire : tableau trié et filtré côté serveur, export CSV/Excel, saisie
   d'une nouvelle fiche, détail, modification et **historique champ par champ**.
3. **Droits** d'un formulaire : règles par rôle ou groupe et filtres de visibilité, par exemple
   `site = $user.site` combiné à l'attribut `site` d'un membre (page Utilisateurs).
4. **Référentiels** : arbre Site › Bâtiment › Équipement, recherche, import avec prévisualisation
   et rapport d'erreurs, export.
5. **Paramètres** : logo, couleurs (appliquées au back-office), fuseau, menu de l'application mobile.

Test de bout en bout : `pnpm test:e2e` (Playwright ; API locale et base de démo requises).

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

## Démo (Phase 1)

Le seed crée le référentiel « Sites et équipements » (Site > Bâtiment > Équipement, codes
`S-PLT`, `B-PLT-A`, `EQ-0001`…) et la structure publiée « Inspection équipement » : cascade de
référentiels, champs conditionnels selon l'état, photos, tableau de pièces avec montant par
ligne et total calculé, signature.

```bash
# Retrouver un équipement par son code (scan QR)
curl -s 'localhost:3000/v1/demo/list-items?code=EQ-0001' -H "Authorization: Bearer $TOKEN"
# Créer une fiche (idempotente via clientMutationId ; le serveur recalcule et horodate)
curl -s localhost:3000/v1/demo/structures/$STRUCTURE/submissions -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"clientMutationId":"m-1","data":{"site":"…","batiment":"…","equipement":"…","etat":"bon","signature":{"fileId":"…"}}}'
# Filtrer et trier : champs marqués « filterable »
curl -s "localhost:3000/v1/demo/structures/$STRUCTURE/submissions?filter[etat]=degrade&sort=-date_inspection" \
  -H "Authorization: Bearer $TOKEN"
# Historique champ par champ
curl -s localhost:3000/v1/demo/submissions/$ID/revisions -H "Authorization: Bearer $TOKEN"
# Import d'un référentiel (prévisualisation puis application)
curl -s localhost:3000/v1/demo/lists/$LIST/import -H "Authorization: Bearer $TOKEN" \
  -F file=@equipements.xlsx -F dry_run=true
```

Formules des champs calculés : `{prix} * {quantite}`, `SOMME({pieces.montant})`,
`SI({etat} = "bon"; 0; 1)`, `JOURS_ENTRE({date_debut}; AUJOURDHUI())`
(voir [ADR 0003](docs/adr/0003-conditions-calculs.md)).

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
- [ADR 0003 — Conditions et calculs (json-logic)](docs/adr/0003-conditions-calculs.md)
- [ADR 0004 — Filtrage des fiches (JSONB)](docs/adr/0004-filtrage-des-fiches.md)
- [ADR 0005 — Import / export tableurs](docs/adr/0005-import-export-tableurs.md)
- [ADR 0006 — Stockage des fichiers](docs/adr/0006-stockage-fichiers.md)

Conventions de code et commandes détaillées : [CLAUDE.md](CLAUDE.md).
