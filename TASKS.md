# TASKS — Découpage du projet Tesserax

Source : [PROMPT_claude_code_clone_daxium.md](prompt/PROMPT_claude_code_clone_daxium.md).
Convention : `Px.y` = tâche (≈ 1 PR / 1 série de commits atomiques), `Px.y.z` = sous-tâche (≈ 1 commit).
Chaque tâche a un critère **Fini quand** ; une phase n'est close que si toutes ses tâches le sont + tests verts + seed + README + démo décrite.

---

## 0. Décisions de cadrage (validées)

### Nom : **Tesserax**

Choix du porteur de projet. Évoque la *tessera*, la tesselle d'une mosaïque : chaque fiche terrain est une pièce qui compose la vue d'ensemble dans le back-office.
- Identifiants techniques : scope npm `@tesserax/*`, base `tesserax`, bundle id `com.tesserax.app` (à remplacer par `ci.tesserax.app` si le domaine `tesserax.ci` est acquis).
- Aucune référence à Daxium.
- Vérifié : scope npm `@tesserax` et paquet `tesserax` libres. Homonyme connu : une petite bibliothèque Elixir (wrapper OCR Tesseract sur Hex), sans risque de confusion avec une plateforme de collecte terrain. Proche phonétiquement de *Tesseract* (OCR) : à garder en tête pour le référencement. **Reste à vérifier avant usage commercial** : nom de domaine et dépôt de marque à l'OAPI.

### Choix techniques

Chaque choix est retenu parce qu'il sert un critère d'acceptation ou une contrainte du prompt (hors ligne, pas de SaaS obligatoire, isolation, simplicité).

| # | Sujet | Décision | Pourquoi cela sert l'objectif |
|---|---|---|---|
| D1 | Notifications push | Expo Push, mais **non critique** : toute information poussée (nouvelle tâche, changement d'état) arrive aussi par la sync et un centre de notifications dans l'app. Push désactivable par configuration. | L'app fonctionne sans Expo, donc pas de dépendance SaaS obligatoire. Tout push mobile passe de toute façon par Apple (APNs) ou Google (FCM) : c'est inévitable, à documenter dans l'ADR. |
| D2 | Builds mobiles | EAS Build en confort. Chemin autonome documenté et testé en CI : `expo prebuild` + Gradle (Android) ; iOS via Xcode/fastlane sur macOS. | La livraison ne dépend pas d'un compte Expo. |
| D3 | Cartographie | MapLibre partout : `maplibre-gl` (web) + `@maplibre/maplibre-react-native` (mobile). Fond de carte vectoriel **Protomaps (PMTiles)** extrait sur la Côte d'Ivoire, servi depuis MinIO, sans nouveau service. Le mobile précharge la zone pour le hors ligne. | Pas de clé Google, pas de SaaS, carte utilisable en zone blanche. La politique d'usage des tuiles OSM publiques interdit le préchargement hors ligne. **À valider par un spike** : support PMTiles de MapLibre Native. Repli : serveur de tuiles auto-hébergé (`martin`). |
| D4 | Géolocalisation hors ligne | Le champ GPS fonctionne sans carte (coordonnées + précision). La carte est un plus, pas un prérequis. | La saisie n'est jamais bloquée par l'absence de tuiles. |
| D5 | E-mails | SMTP générique (nodemailer), Mailpit en dev. En production, un relais SMTP au choix du client (son propre serveur ou un relais). | Pas de fournisseur imposé. Un relais est recommandé pour la délivrabilité, car un SMTP auto-hébergé est souvent classé en spam. |
| D6 | Multi-tenant Prisma + RLS | Extension Prisma client qui exécute chaque opération dans une transaction précédée de `set_config('app.instance_id', …, true)`. Rôle applicatif sans `BYPASSRLS`, `FORCE ROW LEVEL SECURITY` sur les tables métier, migrations exécutées avec un rôle propriétaire distinct. Le worker utilise la même extension. | L'isolation repose sur la base, pas sur la discipline du code : un oubli de filtre ne fuit pas. Le critère « une instance ne voit jamais les données d'une autre » est garanti et testé. |
| D7 | Conditions **et** calculs | **Un seul évaluateur : json-logic** (`json-logic-js`, compatible Hermes). Le designer propose une syntaxe lisible (`{prix} * {quantite}`, `SOMME({lignes.montant})`, `SI(...)`) qu'un petit parseur maison de `form-engine` **compile en json-logic** au moment de l'enregistrement. Opérations custom : agrégats sur tableaux répétables, dates, arrondis. | Un seul moteur, identique sur serveur, web et mobile, donc aucun écart de résultat hors ligne. Une formule lisible pour l'admin no-code (critère « < 15 min sans code »). |
| D8 | Stockage local mobile | `expo-sqlite` + Drizzle ORM (migrations typées), FTS5 pour la recherche locale. | WatermelonDB impose son propre format de sync et un module natif de plus, alors que la sync est maison (conflits par champ). Moins de dépendances, plus de contrôle. |
| D9 | Protocole de sync et conflits | UUID générés côté client. Chaque mutation porte `client_mutation_id`, `base_revision` et **uniquement les champs modifiés**. Le serveur applique champ par champ. Si un champ a changé depuis `base_revision`, la dernière écriture reçue par le serveur gagne et un `SubmissionConflict` est enregistré. L'horloge serveur fait foi (les horloges des téléphones ne sont pas fiables). | Rejouer la même mutation n'a aucun effet (pas de doublon). Deux modifications de champs différents fusionnent (pas de perte). Les conflits réels restent visibles. Cela couvre directement le critère « 10 fiches en mode avion ». |
| D10 | Uploads de fichiers | Fichier identifié par un UUID client et envoyé en PUT sur une URL signée. Les photos compressées (< 5 Mo) partent en un seul morceau : une coupure entraîne la reprise du fichier entier, sans risque grâce à l'UUID. Multipart S3 uniquement pour les fichiers > 5 Mo. Upload en arrière-plan via `expo-file-system`. La fiche référence ses fichiers par UUID, quel que soit leur ordre d'arrivée. | Les uploads sont reprenables et découplés de la fiche, sans la complexité du multipart pour 95 % des cas. |
| D11 | Audit trail | Historique champ par champ (`SubmissionRevision`) enregistré **dès la Phase 1**. Interface complète en Phase 6. | Un historique ne peut pas être reconstitué après coup. Il est requis dès la Phase 2 (détail de fiche) et la Phase 3 (conflits). |
| D12 | Personnalisation de l'instance | Rattachée à P2.7 (back-office) et P3.3 (menu mobile). | Elle était absente du plan de livraison. |
| D13 | Annotation photo **et** signature | `@shopify/react-native-skia` pour les deux : dessin sur la photo, export d'une image annotée, conservation de l'original. | Une seule librairie native pour deux besoins, sans WebView. Elle fonctionne hors ligne. |
| D14 | Fuseau et dates | Stockage en UTC (`timestamptz`), affichage en Africa/Abidjan par défaut (UTC+0, sans heure d'été), fuseau configurable par instance. | L'application reste correcte si une instance sort de Côte d'Ivoire. |

---

## Phase 0 — Socle

**P0.1 Monorepo & outillage**
- [x] P0.1.1 Init pnpm workspace + Turborepo (`apps/*`, `packages/*`), Node LTS épinglé (`.nvmrc`, `packageManager`)
- [x] P0.1.2 TypeScript base (`tsconfig.base.json`, strict), alias de paquets
- [x] P0.1.3 ESLint + Prettier (config partagée), lint-staged + husky, commitlint (commits conventionnels)
- [x] P0.1.4 Vitest configuré au niveau racine (preset partagé)
- [x] P0.1.5 Squelettes vides : `apps/api`, `apps/web`, `apps/mobile`, `apps/worker`, `packages/{form-schema,form-engine,form-renderer,sdk,ui}`
- Fini quand : `pnpm lint && pnpm typecheck && pnpm test` passe sur le monorepo vide.

**P0.2 Infra de dev**
- [x] P0.2.1 `infra/docker-compose.yml` : postgres 16, redis, minio (+ bucket init), gotenberg, mailpit
- [x] P0.2.2 Services applicatifs api/worker/web + traefik (profil `full`)
- [x] P0.2.3 `.env.example` documenté, validation des variables d'env au démarrage (Zod)
- Fini quand : `docker compose up` démarre l'infra, healthchecks verts.

**P0.3 CI GitHub Actions**
- [x] P0.3.1 Workflow lint + typecheck + tests unitaires (cache pnpm/turbo)
- [x] P0.3.2 Job tests d'intégration API avec service Postgres
- [x] P0.3.3 Build des images Docker (sans push)

**P0.4 API NestJS + Prisma**
- [x] P0.4.1 Bootstrap NestJS (config, logger structuré pino, filtre d'erreurs, validation Zod des DTO)
- [x] P0.4.2 Prisma : schéma initial (`Instance`, `User`, `Membership`, `Role`, `Group`, `RefreshToken`), migrations
- [x] P0.4.3 Endpoint `/health` (DB + Redis)
- [x] P0.4.4 Préfixe `/v1`, convention pagination `page`/`per_page`, paramètre `fields=` (intercepteur réutilisable)

**P0.5 Auth OAuth2 maison** — *ADR auth*
- [x] P0.5.1 Hash argon2, création/connexion utilisateur
- [x] P0.5.2 `POST /oauth/token` grant `password` → JWT court (15 min) + refresh token
- [x] P0.5.3 Grant `refresh_token` avec rotation + détection de réutilisation (révocation de la famille)
- [x] P0.5.4 Grant `client_credentials` (clients OAuth par instance, secret haché)
- [x] P0.5.5 Guard JWT + décorateurs `@CurrentUser`, `@CurrentInstance`
- [x] P0.5.6 Tests : expiration, rotation, réutilisation de refresh, mauvais mot de passe, rate limit basique du login
- Fini quand : parcours login → appel protégé → refresh → logout testé en intégration.

**P0.6 Multi-tenant + RLS** — *ADR multi-tenant*
- [x] P0.6.1 Colonne `instance_id` sur toutes les tables métier, résolution de l'instance via `/{app}` (`short`)
- [x] P0.6.2 Policies RLS PostgreSQL + rôle applicatif sans `BYPASSRLS`
- [x] P0.6.3 Extension Prisma posant `app.instance_id` par transaction, `FORCE ROW LEVEL SECURITY`, rôle de migration séparé (D6)
- [x] P0.6.4 **Suite de tests d'isolation** : 2 instances, chaque endpoint vérifie l'absence de fuite (lecture, écriture, listing, comptage)
- Fini quand : une requête sans contexte d'instance ne renvoie aucune ligne ; suite d'isolation verte en CI.

**P0.7 RBAC de base**
- [x] P0.7.1 Modèle rôles/permissions par instance (`admin`, `superviseur`, `technicien`)
- [x] P0.7.2 Guard de permission (`@Can('structure:create')`)

**P0.8 Seed & docs**
- [x] P0.8.1 Seed : 1 instance, 3 utilisateurs, 3 rôles
- [x] P0.8.2 `CLAUDE.md` racine (conventions, commandes) — fusionner avec le bloc RTK existant
- [x] P0.8.3 README + `docs/adr/0001-multi-tenant.md`, `0002-auth.md`
- [x] P0.8.4 i18n : choix de la lib (i18next) et structure des fichiers `fr`/`en` partagée web + mobile

---

## Phase 1 — Moteur de formulaires

**P1.1 `packages/form-schema`** (TDD)
- [x] P1.1.1 Types + Zod de la définition de structure : métadonnées, sections, champs, version
- [x] P1.1.2 Schéma commun d'un champ : libellé, aide, requis, défaut, lecture seule, `visibleIf`, `requiredIf`, validation (regex, bornes), visibilité par état/rôle
- [x] P1.1.3 Les ≥ 25 types de champs (union discriminée) : texte court/long, nombre, date, heure, date-heure, booléen, choix unique/multiple, liste (cascade), relation, photo, fichier, signature, géoloc, code-barres, calcul, utilisateur, e-mail, téléphone, note, curseur, tableau répétable, section, texte informatif, caché, horodatage auto, auteur auto
- [x] P1.1.4 Schéma Zod **dynamique** des données d'une fiche généré depuis une version de structure
- [x] P1.1.5 Schéma de workflow (états, transitions, boutons) — défini ici, exploité en Phase 4
- [x] P1.1.6 Export JSON Schema (pour OpenAPI et documentation)

**P1.2 `packages/form-engine`** (TDD, couverture 100 %) — *ADR conditions/calculs*
- [x] P1.2.1 Évaluation des conditions json-logic (opérateurs custom : `empty`, `in_list`, dates)
- [x] P1.2.2 Contexte d'évaluation : valeurs, utilisateur, rôle, état de workflow, ligne courante d'un tableau répétable
- [x] P1.2.3 Calculs : parseur de formules lisibles compilées en json-logic (D7), graphe de dépendances, détection de cycles, recalcul incrémental
- [x] P1.2.4 Visibilité & requis conditionnels ; un champ masqué n'est ni requis ni validé
- [x] P1.2.5 Validation complète d'une fiche (types, bornes, regex, requis) avec erreurs localisables
- [x] P1.2.6 Valeurs par défaut et champs auto (horodatage, auteur)
- [x] P1.2.7 Jeu de fixtures partagé (structures exemples) réutilisé par API, web et mobile
- Fini quand : 100 % de couverture, zéro dépendance runtime Node/DOM (exécutable dans Hermes).

**P1.3 Structures versionnées (API)**
- [x] P1.3.1 Modèles `Structure`, `StructureVersion` (brouillon / publiée / archivée)
- [x] P1.3.2 CRUD + publication (version immuable une fois publiée)
- [x] P1.3.3 Validation de la définition via `form-schema` à l'enregistrement

**P1.4 Fiches (API)**
- [x] P1.4.1 Modèle `Submission` : `id` UUID client, `structure_version_id`, `data` JSONB, auteur, géoloc, état, `client_mutation_id`, `updated_at`
- [x] P1.4.2 Validation serveur via `form-engine` contre la version d'origine
- [x] P1.4.3 Index GIN + colonnes extraites pour champs marqués « filtrables » — alternative retenue : containment GIN + expressions JSONB typées ([ADR 0004](docs/adr/0004-filtrage-des-fiches.md))
- [x] P1.4.4 CRUD + filtres/tri/pagination
- [x] P1.4.5 Historique champ par champ (`SubmissionRevision` : qui, quand, avant/après) enregistré dès maintenant (D11)
- [x] P1.4.6 Idempotence création/mise à jour par `client_mutation_id`

**P1.5 Listes / référentiels**
- [x] P1.5.1 Modèles `List`, `ListItem` hiérarchiques (parent_id, niveau, code, libellé, attributs)
- [x] P1.5.2 CRUD + recherche + filtrage par parent (cascade)
- [x] P1.5.3 Import CSV/XLSX (mapping colonnes → niveaux, prévisualisation, rapport d'erreurs, mode remplacer/fusionner)
- [x] P1.5.4 Export CSV/XLSX
- [x] P1.5.5 Recherche par code (sert au scan QR en Phase 3)

**P1.6 Seed & démo** ✅ : structure « Inspection équipement » (sans workflow), référentiel Site > Bâtiment > Équipement.

---

## Phase 2 — Back-office v1

**P2.1 Socle web**
- [x] P2.1.1 Vite + React + TanStack Router/Query + shadcn/ui + `packages/ui` (tokens)
- [x] P2.1.2 Auth (login, refresh silencieux, sélection d'instance), layout, navigation
- [x] P2.1.3 i18n FR (EN prêt), fuseau Africa/Abidjan par défaut (D14)
- [x] P2.1.4 `packages/sdk` : client typé (amorce ; vérifié contre l'OpenAPI en Phase 7)

**P2.2 `packages/form-renderer`**
- [x] P2.2.1 Contrat de composant de champ partagé (props, valeur, erreurs, état visible/requis issus de `form-engine`)
- [x] P2.2.2 Implémentations web de tous les types (les types natifs — photo, signature, scan — en version web simplifiée)
- [x] P2.2.3 Hook `useFormEngine` (état du formulaire + réévaluation conditions/calculs)

**P2.3 Designer de formulaires (dnd-kit)**
- [x] P2.3.1 Palette de types, canvas, réordonnancement, sections, tableaux répétables imbriqués
- [x] P2.3.2 Panneau de propriétés par type (validation, défaut, aide…)
- [x] P2.3.3 Éditeur de conditions visuel (générant du json-logic) + éditeur de formules de calcul
- [x] P2.3.4 Aperçu mobile live (form-renderer dans un cadre mobile)
- [x] P2.3.5 Versionnage : brouillon, diff avec version publiée, publication
- [x] P2.3.6 Test e2e Playwright : créer et publier un formulaire

**P2.4 Gestion des listes** ✅ : CRUD arborescent, import/export avec UI de mapping.

**P2.5 Consultation des fiches**
- [x] P2.5.1 Tableau TanStack Table : colonnes dynamiques par structure, filtres, tri, pagination serveur
- [x] P2.5.2 Détail d'une fiche (rendu lecture) + historique (onglet basé sur P1.4.5)
- [x] P2.5.3 Édition d'une fiche
- [x] P2.5.4 Export CSV/XLSX — synchrone, plafonné à 50 000 fiches ; bascule sur le worker si besoin mesuré

**P2.6 Utilisateurs, groupes, rôles, droits**
- [x] P2.6.1 CRUD utilisateurs/groupes, invitation (mot de passe provisoire ; e-mail d'invitation en P5.2)
- [x] P2.6.2 Droits par structure : créer, lire tout / lire les siennes, modifier, supprimer, exporter
- [x] P2.6.3 Filtres de visibilité (ex. ne voir que les fiches de son site) — appliqués côté API
- [x] P2.6.4 Tests d'autorisation API couvrant la matrice de droits

**P2.7 Personnalisation de l'instance** (D12) ✅ : logo, couleurs, configuration du menu mobile (tuiles, icônes, structures liées).

**P2.8 Fichiers (prérequis photos)** ✅ ([ADR 0006](docs/adr/0006-stockage-fichiers.md)) : upload vers MinIO via URL signée, métadonnées en base, miniatures générées par le worker (amorce `apps/worker` + BullMQ).

---

## Phase 3 — Mobile hors ligne — *ADR sync*

**P3.1 Socle Expo**
- [x] P3.1.1 App Expo + dev client (requis pour caméra/SQLite/Skia), navigation, thème depuis `packages/ui`
- [x] P3.1.2 Login, sélection d'instance, stockage sécurisé des tokens (expo-secure-store)
- [x] P3.1.3 i18n partagée

**P3.2 Base locale & protocole de sync** (TDD)
- [x] P3.2.1 Schéma SQLite local (structures, listes, fiches, tâches, file de mutations, file d'uploads)
- [x] P3.2.2 API `GET /sync/pull?cursor=` : changements par `updated_at` + tombstones, par ressource
- [x] P3.2.3 API `POST /sync/push` : lot de mutations idempotentes (`client_mutation_id`), réponse par mutation
- [x] P3.2.4 Conflits : mutation = champs modifiés + `base_revision` ; last-write-wins par champ à la réception serveur, enregistrement du conflit (`SubmissionConflict`) (D9)
- [x] P3.2.5 Moteur de sync client : déclenchement réseau retrouvé / app au premier plan / manuel, backoff, reprise
- [x] P3.2.6 Tests de sync côté serveur et client : doublons, réordonnancement, rejeu, conflit concurrent

**P3.3 Menu & navigation** ✅ : menu personnalisé (tuiles de P2.7), liste des fiches locales, recherche locale (FTS SQLite).

**P3.4 Saisie de fiches**
- [x] P3.4.1 Implémentations natives de form-renderer pour les types simples
- [x] P3.4.2 Liste en cascade (référentiel local), relation vers fiche locale
- [x] P3.4.3 Photo multi + compression configurable + annotation/dessin Skia, original conservé (D13)
- [x] P3.4.4 Signature (Skia, D13)
- [ ] P3.4.5 Géolocalisation : GPS et saisie manuelle faits, sans carte ni tuiles (D4) ✅ ; **reste** la carte et le préchargement PMTiles de la zone CI (D3), reportés avec la carte mobile (P6.1.3)
- [x] P3.4.6 Scan code-barres/QR (expo-camera) : pré-remplir un champ / retrouver un équipement du référentiel
- [x] P3.4.7 Tableau répétable
- [x] P3.4.8 Conditions et calculs exécutés localement via `form-engine`
- [x] P3.4.9 Brouillons (sauvegarde auto), validation avant envoi

**P3.5 Uploads de fichiers découplés**
- [x] P3.5.1 File d'upload persistée, upload en arrière-plan, reprise après coupure : PUT signé par UUID, multipart seulement > 5 Mo (D10)
- [x] P3.5.2 Liaison fichier ↔ fiche indépendante de l'ordre d'arrivée

**P3.6 UX de sync** ✅ : indicateur d'état, file d'envoi visible, erreurs actionnables.

**P3.7 Conflits dans le back-office** ✅ : liste des conflits par fiche, résolution manuelle.

**P3.8 Tests de bout en bout**
- [x] P3.8.1 Mode avion → 10 fiches avec photos → retour réseau → aucune perte/doublon : moteur réel contre l'API (`offline-sync.e2e.test.ts`) ; dans l'app sur simulateur iOS avec Maestro (`e2e/hors-ligne.sh`, coupure simulée par l'arrêt du serveur, sans photo faute de caméra)
- [x] P3.8.2 Coupure en plein upload, arrêt de l'app pendant la sync (tests du moteur et de bout en bout, côté protocole)
- [x] P3.8.3 Conflit web/mobile sur la même fiche

---

## Phase 4 — Workflow & tâches — *[ADR 0008](docs/adr/0008-workflow-taches-notifications.md)*

**P4.1 Moteur de workflow (API)**
- [x] P4.1.1 États/transitions par version de structure, rôles autorisés, champs requis par transition (`checkTransition` dans `form-engine`)
- [x] P4.1.2 Endpoint de transition (validation + historique + événement pour automatisations) — l'événement est la révision `transition` (`$state`), journal lu par la Phase 5
- [x] P4.1.3 Visibilité/lecture seule des champs par état et par rôle (dans `form-engine`), réglables dans le designer
- [x] P4.1.4 Transitions hors ligne : mutation de sync, revalidation serveur, rejet expliqué (`409 invalid_state`)

**P4.2 Éditeur de workflow visuel (web)** ✅ : graphe états/transitions (React Flow), configuration des boutons (libellé, couleur, rôles, champs requis, confirmation).

**P4.3 Boutons de transition** ✅ : web (détail et saisie de fiche) + mobile (saisie) ; compteurs par état dans le tableau des fiches.

**P4.4 Tâches**
- [x] P4.4.1 Modèle `Task` (structure, assigné utilisateur/groupe, date, échéance, lieu, statut, fiche liée, pré-remplissage)
- [x] P4.4.2 CRUD + sync mobile des tâches assignées (tombstones à la réassignation)
- [x] P4.4.3 Agenda web multi-utilisateurs + glisser-déposer (création, réassignation, replanification)
- [x] P4.4.4 Vue calendrier des fiches (date de création ou champ date filtrable)
- [x] P4.4.5 Agenda/tâches mobile, ouverture d'une tâche → fiche pré-remplie, close à l'envoi

**P4.5 Notifications** (D1) ✅ : centre de notifications alimenté par la sync (mobile) et cloche du back-office ; push Expo désactivable (`PUSH_ENABLED`, préférence par appareil), envoyé par le worker. Push non testé sur appareil (projet EAS requis).

**P4.6 Démo** ✅ : workflow Brouillon → Soumis → Validé/Rejeté sur « Inspection équipement » (`pnpm db:seed`).

---

## Phase 5 — Rapports & automatisations — *[ADR 0009](docs/adr/0009-rapports-automatisations.md)*

**P5.1 Modèles de rapports**
- [x] P5.1.1 Upload DOCX, stockage, détection des balises `{{champ}}` et vérification contre la structure (erreurs de syntaxe expliquées, balises inconnues signalées)
- [x] P5.1.2 Fusion docxtemplater : champs, boucles sur tableaux répétables, images (photos, signature — module maison, le module libre dépendant de `xmldom` 0.1), listes
- [x] P5.1.3 Conversion PDF via Gotenberg, cache par révision de fiche — appelée par l'API et non par un job du worker (ADR 0009)
- [x] P5.1.4 Aperçu dans le back-office avec une fiche exemple (générée depuis la structure) ou une fiche réelle
- [x] P5.1.5 Génération/visualisation PDF depuis le mobile (en ligne, navigateur intégré)

**P5.2 E-mails** (D5) ✅ : envoi SMTP par le worker (nodemailer, Mailpit en dev), sujets et corps à balises, pièce jointe PDF, journal d'envoi avec renvoi manuel.

**P5.3 Moteur d'automatisations**
- [x] P5.3.1 Modèle `Automation` (déclencheur, conditions json-logic, actions ordonnées)
- [x] P5.3.2 Déclencheurs : fiche créée, changement d'état, champ modifié, planifié (cron BullMQ, fuseau de l'instance)
- [x] P5.3.3 Actions : e-mail + rapport PDF, notification (push si activé), création de tâche, webhook sortant, mise à jour de champ
- [x] P5.3.4 Garde-fous : anti-boucle (jamais sur sa propre écriture, profondeur 3), retries, idempotence par étape, outbox transactionnelle
- [x] P5.3.5 Journal d'exécution consultable (statut, durée par étape, erreur, relance manuelle)
- [x] P5.3.6 UI de configuration dans le back-office (quand / si / alors, erreurs rattachées à leur emplacement)

**P5.4 Webhooks sortants** ✅ : signature HMAC-SHA256 + horodatage, retries exponentiels, désactivation après 5 échecs consécutifs, garde SSRF, endpoint `/{app}/webhooks` (événements, test, livraisons, renvoi, rotation du secret).

**P5.5 Test d'acceptation** ✅ : la validation d'une fiche envoie automatiquement le rapport PDF par e-mail — `node infra/acceptance/rapport-par-email.mjs` (vérifié dans Mailpit, PDF joint valide).

---

## Phase 6 — Pilotage

**P6.1 Cartes** (ADR 0010)
- [x] P6.1.1 Vue carte des fiches (MapLibre + PMTiles auto-hébergé, clustering, filtres partagés avec le tableau)
- [x] P6.1.2 Suivi des équipes terrain (dernières positions issues des fiches/tâches)
- [x] P6.1.3 Carte des fiches sur mobile

**P6.2 Tableaux de bord configurables**
- [x] P6.2.1 Modèle de widget (KPI, graphique, compteur par état/période/utilisateur) + requêtes d'agrégation sécurisées (RLS + droits)
- [x] P6.2.2 Éditeur de tableau de bord (grille, ajout/configuration de widgets)

**P6.3 Audit trail complet**
- [x] P6.3.1 Journal d'audit global (connexions, admin, droits, exports, clés API)
- [x] P6.3.2 UI de consultation/filtrage, historique fiche enrichi (transitions, conflits, automatisations)

**P6.4 Export ZIP des photos** ✅ : job worker, nommage configurable, lien signé à durée limitée.

- Fini quand : parcours Playwright `e2e/pilotage.spec.ts` (carte, équipes, tableau de bord, export ZIP téléchargé, journal d'audit) et Maestro `carte-fiches.yaml` verts ; données de démo par `node infra/demo/fiches-terrain.mjs`.

---

## Phase 7 — API publique & industrialisation — *[ADR 0011](docs/adr/0011-api-publique-exploitation.md)*

**P7.1 API publique**
- [x] P7.1.1 Revue des ressources `/v1` (`/apps`, structures, submissions, lists, tasks, users, reports, files/upload, webhooks) : cohérence, `fields=`, pagination — collections d'activité paginées, listes de configuration en `{ data }` ; requêtes des fiches validées par pipe (documentées)
- [x] P7.1.2 OpenAPI généré automatiquement + doc publiée (Swagger UI auto-hébergé, `/v1/docs`) — depuis les métadonnées NestJS, Zod et la JSDoc ; réponses vérifiées par contrat en intégration
- [x] P7.1.3 `packages/sdk` utilisé par web et mobile, **vérifié** contre l'OpenAPI (écart : écrit à la main, cf. ADR 0011 §3 ; chaque méthode correspond à une opération, toutes couvertes)
- [x] P7.1.4 Clés API / clients OAuth `client_credentials` gérés dans l'admin (scopes = permissions, rotation, révocation immédiate)
- [x] P7.1.5 Rate limiting (Redis) par client, par utilisateur, par instance et par IP (jeton)
- [x] P7.1.6 Exemple de workflow n8n (JSON importable + doc) — vérifié avec n8n 2.43.8

**P7.2 Exploitation** ([docs/exploitation.md](docs/exploitation.md))
- [x] P7.2.1 Sauvegardes PostgreSQL (pg_dump planifié) + stockage (`mc mirror`), vérification de restauration automatique, restauration testée après sinistre simulé
- [x] P7.2.2 Healthchecks complets (API, worker), logs structurés JSON corrélés (`X-Request-Id`), métriques Prometheus
- [x] P7.2.3 Traefik + TLS Let's Encrypt (`docker-compose.prod.yml`), variante d'accès privé Tailscale documentée (non testée sur un tailnet réel)
- [x] P7.2.4 `docker compose up` (dans `infra/`) = stack complète + données de démo (critère d'acceptation)

**P7.3 Mobile** (D2) ✅ : profils EAS `development` / `preview` / `production` (`APP_VARIANT`, clé Google Maps par variable) + chemin autonome `expo prebuild` + Gradle (APK construit localement) et Xcode en CI.

**P7.4 Sécurité (OWASP ASVS niveau 1)**
- [x] P7.4.1 Checklist ASVS L1 passée et tracée dans `docs/security/` (4 écarts partiels justifiés)
- [x] P7.4.2 En-têtes de sécurité, CORS strict, validation des uploads (types actifs refusés, signature, taille), URLs signées courtes ; politique de mot de passe, changement et réinitialisation
- [x] P7.4.3 Audit des dépendances en CI, recherche de secrets (gitleaks), Dependabot

- Fini quand : `cd infra && docker compose up` démarre la stack avec la démo et les 10 parcours Playwright y passent (aussi en HTTPS derrière la surcouche de production) ; sauvegarde, vérification et restauration testées ; workflows n8n exécutés ; tests d'intégration (contrat OpenAPI compris) verts.

---

## Critères d'acceptation globaux → tâches qui les couvrent

| Critère | Tâches |
|---|---|
| Formulaire « Inspection équipement » créé sans code en < 15 min | P2.3, P2.4, P4.2 (+ scénario chronométré dans la démo de Phase 4) |
| 10 fiches avec photos en mode avion, sync sans doublon ni perte | P3.2, P3.5, P3.8.1 |
| Validation → rapport PDF envoyé par e-mail | P4.1, P5.1–P5.3, P5.5 |
| Isolation stricte entre instances | P0.6.4 (étendu à chaque nouvelle ressource) |
| `docker compose up` démarre tout avec démo | P0.2, P7.2.4 ✅ |

## ADR à rédiger (`docs/adr/`)

1. Multi-tenant (RLS + Prisma) — P0.6
2. Auth OAuth2 maison — P0.5
3. Conditions & calculs (json-logic unique, formules compilées) — P1.2
4. Stockage local mobile & protocole de sync — P3.2 ✅ ([0007](docs/adr/0007-stockage-local-synchronisation.md))
5. Cartographie (MapLibre + PMTiles auto-hébergé, hors ligne) — P3.4.5 / P6.1
6. Annotation photo & signature (Skia) — P3.4.3 / P3.4.4
7. Génération PDF (docxtemplater + Gotenberg) — P5.1 ✅ ([0009](docs/adr/0009-rapports-automatisations.md), avec automatisations et webhooks)
8. Notifications (sync + Expo Push optionnel) — P4.5
9. Uploads de fichiers reprenables — P3.5
10. Builds mobiles sans dépendance EAS — P7.3
