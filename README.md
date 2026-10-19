# Tesserax

Plateforme no-code de collecte de données terrain : back-office web pour concevoir des
formulaires (structures), workflows et rapports ; application mobile **100 % hors ligne** pour
la saisie sur chantier. Conçue pour les PME BTP / maintenance / QHSE en Côte d'Ivoire.

> État : Phases **0 (socle)**, **1 (moteur de formulaires)**, **2 (back-office web)**,
> **3 (mobile hors ligne)** et **4 (workflow et tâches)** livrées : designer de formulaires et
> de workflows, fiches, référentiels, droits ; application Expo 100 % hors ligne (SQLite, file
> d'envoi, photos annotées, signature, GPS, scan QR), synchronisation sans doublon ni perte,
> conflits par champ ; boutons de transition, agenda des tâches, notifications.
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

## Application mobile (Phase 3)

```bash
pnpm --filter "@tesserax/mobile^..." build   # paquets partagés
cd apps/mobile && npx expo start --lan        # puis ouvrir exp://127.0.0.1:8081 dans Expo Go
```

Se connecter avec `technicien@tesserax.local` / `Tesserax2026!` (serveur par défaut :
`http://localhost:3000`, modifiable via « Serveur… » sur l'écran de connexion, ou
`EXPO_PUBLIC_API_URL`). Une fois les formulaires téléchargés, tout fonctionne sans réseau :
saisie, cascade des référentiels, photos compressées et annotées, signature, GPS, scan d'un QR
code d'équipement (fiche pré-remplie), brouillons enregistrés automatiquement, recherche locale.
La barre d'état indique la file d'envoi ; l'écran « Synchronisation » détaille les erreurs.

Tests sur simulateur iOS avec [Maestro](https://maestro.mobile.dev) :

```bash
maestro test apps/mobile/e2e/reinitialiser.yaml apps/mobile/e2e/saisie-fiche.yaml
API_STOP="…" API_START="…" apps/mobile/e2e/hors-ligne.sh   # scénario hors ligne complet
```

## Workflow et tâches (Phase 4)

- **Designer → onglet « Workflow »** : états et transitions dans un graphe (relier deux états
  crée une transition) ; chaque transition est un bouton d'enregistrement (libellé, couleur,
  rôles, champs à renseigner, confirmation). Les champs se règlent par état et par rôle
  (« Par état et par rôle » dans leurs propriétés).
- **Fiches** : filtre par état avec compteurs, vue calendrier, boutons de transition sur le
  détail et la saisie, changements d'état dans l'historique.
- **Agenda** : semaine par personne ou groupe ; glisser une tâche la réassigne et la
  replanifie. Une tâche indique le formulaire à remplir et peut pré-remplir la fiche.
- **Mobile** : « Mes tâches » ouvre la fiche pré-remplie, close la tâche à l'envoi ; boutons
  de workflow utilisables hors ligne ; centre de notifications (cloche) alimenté par la sync.
- **Push** (facultatif) : `PUSH_ENABLED=true` côté API et un build de l'application avec un
  projet EAS (`extra.eas.projectId`). Sans push, les notifications arrivent par la sync.

```bash
maestro test apps/mobile/e2e/taches-workflow.yaml   # après apps/mobile/e2e/planifier-tache.sh
maestro test apps/mobile/e2e/notifications.yaml     # après validation de la fiche au back-office
```

## Rapports et automatisations (Phase 5)

- **Formulaires → ⋯ → Rapports** : déposer un modèle Word (.docx) à balises `{{champ}}`,
  `{{#tableau}}…{{/tableau}}`, `{{@photo}}` ; les balises disponibles se copient d'un clic, celles
  qui ne correspondent pas au formulaire sont signalées. « Aperçu PDF » fonctionne sans fiche.
  Sur une fiche (web ou mobile en ligne) : bouton « Rapport PDF ».
- **Automatisations** : quand (fiche créée, changement d'état, champ modifié, planifié) → si
  (condition) → alors (e-mail avec rapport, notification, tâche, webhook, mise à jour de
  champ). Onglets « Exécutions » (relance), « Webhooks » (secret, test, livraisons) et
  « E-mails envoyés ».
- **Démo** : le seed installe le modèle « Rapport d'inspection » et l'automatisation
  « Rapport PDF à la validation ». Valider une fiche envoie le PDF à son auteur et au
  superviseur ; les e-mails arrivent dans Mailpit (http://localhost:8025).

```bash
pnpm dev                                         # api + worker (envoi SMTP) + web
node infra/acceptance/rapport-par-email.mjs      # acceptation P5.5 : validation → e-mail + PDF
maestro test apps/mobile/e2e/rapport-pdf.yaml    # rapport PDF depuis le mobile
```

Webhooks : chaque requête porte `X-Tesserax-Signature: sha256=<hex>`, HMAC-SHA256 du secret sur
`<X-Tesserax-Timestamp>.<corps>`. En production, `WEBHOOK_ALLOW_PRIVATE=false` interdit les
adresses du réseau interne (sauf intégration locale assumée, ex. n8n).

## Pilotage (Phase 6)

- **Carte** : onglet « Carte » du tableau des fiches (mêmes filtres), points regroupés et
  colorés par état ; page « Équipes terrain » (dernière position de chaque membre) ; sur le
  mobile, bascule « Liste / Carte » de « Mes fiches », hors ligne.
- **Tableaux de bord** : indicateurs, histogrammes et courbes calculés sur les fiches que
  chacun peut lire ; vue tableau de chaque graphique. Le seed installe « Suivi des inspections ».
- **Journal d'audit** : connexions, administration, droits, exports, clés API (permission
  `audit:read`). L'historique d'une fiche regroupe révisions, conflits et automatisations.
- **Photos (ZIP)** depuis le tableau des fiches : nommage configurable (`{date}_{fiche}/{champ}_{n}`
  par défaut), archive préparée par le worker, lien signé valable 15 minutes, export
  téléchargeable 7 jours.

```bash
infra/maps/fetch-basemap.sh                      # fond de carte OSM auto-hébergé (≈ 100 Mo, facultatif)
node infra/demo/fiches-terrain.mjs               # inspections localisées sur l'instance de démo
pnpm --filter @tesserax/web test:e2e             # dont e2e/pilotage.spec.ts
maestro test apps/mobile/e2e/carte-fiches.yaml   # carte mobile
```

Sans fond de carte installé, les cartes web s'affichent sur un fond neutre. Variables :
`BASEMAP_BBOX` (zone, défaut Côte d'Ivoire), `BASEMAP_MAXZOOM` (défaut 14).

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
- [ADR 0007 — Stockage local et synchronisation hors ligne](docs/adr/0007-stockage-local-synchronisation.md)
- [ADR 0008 — Workflow, tâches et notifications](docs/adr/0008-workflow-taches-notifications.md)
- [ADR 0009 — Rapports, automatisations et webhooks](docs/adr/0009-rapports-automatisations.md)
- [ADR 0010 — Pilotage : cartes, tableaux de bord, audit, export ZIP](docs/adr/0010-pilotage.md)

Conventions de code et commandes détaillées : [CLAUDE.md](CLAUDE.md).
