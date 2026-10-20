# Mission

Tu vas construire **Wasafili**, une plateforme no-code de collecte de données terrain, fonctionnellement équivalente à Daxium-Air (back-office web + application mobile hors ligne). Ne réutilise ni le nom, ni le logo, ni les visuels, ni le code de Daxium : on reproduit les **fonctionnalités**, pas la marque.

Contexte d'usage : PME BTP/maintenance en Côte d'Ivoire (chantiers, inspections, interventions, QHSE). Réseau mobile instable → **le mode hors ligne est non négociable**. Langue de l'UI : français (i18n prête pour l'anglais). Fuseau par défaut : Africa/Abidjan.

Avant d'écrire du code : passe en **plan mode**, lis ce document en entier, pose-moi tes questions bloquantes, puis propose le plan de la Phase 0. Ensuite travaille **phase par phase**, avec un commit par étape et des tests verts avant de passer à la suivante.

---

# 1. Périmètre fonctionnel

## 1.1 Modèle métier (reprendre ce vocabulaire)

| Concept | Description |
|---|---|
| **Instance** (app) | Espace client isolé (multi-tenant), identifié par un `short` (slug). Personnalisable : logo, couleurs, menus, icônes. |
| **Structure** (formulaire) | Définition versionnée d'un formulaire : champs, sections, règles, workflow, droits. |
| **Fiche** (submission) | Une saisie d'une structure. Porte un état de workflow, un auteur, une géoloc, des pièces jointes, un historique. |
| **Liste** (référentiel) | Liste de valeurs hiérarchique (ex. Site > Bâtiment > Équipement), importable CSV/XLSX, utilisable dans les champs. |
| **Workflow** | Machine à états par structure. Les transitions sont exposées comme **boutons d'enregistrement** personnalisés (libellé, couleur, rôles autorisés, champs requis). |
| **Tâche** | Fiche planifiée assignée à un utilisateur/groupe avec date, échéance, lieu → alimente l'agenda. |
| **Rapport** (publipostage) | Modèle de document (DOCX/HTML) fusionné avec une fiche → PDF. Envoi auto par e-mail possible. |
| **Utilisateur / Groupe / Rôle** | RBAC par instance, droits par structure (créer, lire tout / lire les siennes, modifier, supprimer, exporter) + filtres de visibilité. |

## 1.2 Types de champs (≥ 20)

Texte court, texte long, nombre (min/max/décimales), date, heure, date-heure, booléen, choix unique, choix multiple, **liste (référentiel, en cascade)**, **relation vers une autre fiche**, photo (multi, avec **annotation/dessin**), fichier, **signature**, **géolocalisation** (GPS + carte + saisie manuelle), **code-barres / QR** (scan caméra), **calcul** (formule sur d'autres champs), utilisateur, e-mail, téléphone, note/étoiles, curseur, **tableau répétable** (sous-formulaire n lignes), section/titre, texte informatif, champ caché, horodatage auto, auteur auto.

Chaque champ : libellé, aide, requis, valeur par défaut, lecture seule, **visibilité conditionnelle** et **requis conditionnel** (logique JSON réutilisable côté serveur, web et mobile), validation (regex, bornes), visibilité par état de workflow et par rôle.

## 1.3 Back-office web

- Designer de formulaires **drag & drop** avec aperçu mobile live, versionnage et publication (une fiche reste liée à la version de structure qui l'a créée).
- Éditeur de workflow visuel (états + transitions).
- Gestion des listes/référentiels (CRUD, import/export CSV/XLSX).
- Consultation des fiches : tableau filtrable/triable, vue carte, vue calendrier, détail avec historique (audit trail champ par champ), édition, export CSV/XLSX/PDF, export des photos en ZIP.
- Planning / agenda multi-utilisateurs : création et assignation de tâches, glisser-déposer.
- Suivi des équipes terrain sur carte (dernières positions des fiches/tâches).
- Tableaux de bord configurables (KPI, graphiques, compteurs par état, par période, par utilisateur).
- Éditeur de modèles de rapports (upload DOCX avec balises `{{champ}}`, boucles sur tableaux répétables, photos, signature) + aperçu.
- **Automatisations** : déclencheurs (fiche créée / changement d'état / champ modifié / planifié) → actions (e-mail avec rapport PDF, notification push, création de tâche, webhook sortant, mise à jour de champ).
- Administration : utilisateurs, groupes, rôles, personnalisation de l'instance, clés API, journal d'audit.

## 1.4 Application mobile (iOS + Android, tablette incluse)

- Connexion, sélection d'instance, menu personnalisé (tuiles/icônes configurées dans le back-office).
- Téléchargement des structures, listes et fiches/tâches assignées pour usage **100 % hors ligne**.
- Saisie de fiches avec tous les types de champs, logique conditionnelle et calculs exécutés localement.
- Brouillons, file d'envoi, indicateur de synchronisation, reprise automatique, envoi des photos en arrière-plan avec compression configurable.
- Boutons de workflow, consultation de l'historique de ses fiches, recherche locale.
- Agenda/tâches, carte des fiches, notifications push.
- Scan code-barres/QR pour retrouver un équipement (référentiel) ou pré-remplir une fiche.
- Génération/visualisation du rapport PDF d'une fiche (en ligne).

## 1.5 API publique

API REST versionnée (`/v1`), OAuth2 (password grant + refresh token pour les apps, client credentials pour les intégrations), paramètre `fields=` pour limiter les champs retournés, pagination `page`/`per_page`. Ressources : `/apps`, `/{app}/structures`, `/{app}/structures/{id}/submissions`, `/{app}/submissions/{id}`, `/{app}/lists`, `/{app}/tasks`, `/{app}/users`, `/{app}/reports`, `/{app}/files/upload`, `/{app}/webhooks`. Spécification OpenAPI générée automatiquement. L'API doit être exploitable depuis **n8n** (prévoir un exemple de workflow).

---

# 2. Architecture imposée

Monorepo **TypeScript** (pnpm + Turborepo) — le point clé est de partager le schéma de formulaire et le moteur de règles entre serveur, web et mobile.

```
apps/
  api/        NestJS + Prisma + PostgreSQL 16
  web/        React + Vite + TanStack (Router, Query, Table) + shadcn/ui + MapLibre
  mobile/     Expo (React Native) + expo-sqlite (ou WatermelonDB) + expo-camera + react-native-maps
  worker/     BullMQ (rapports PDF, e-mails, automatisations, webhooks)
packages/
  form-schema/   types + schémas Zod de la définition de structure (JSON)
  form-engine/   évaluation des conditions (json-logic), calculs, validation — pur TS, testé à 100 %
  form-renderer/ composants de champs partagés quand c'est possible
  sdk/           client API typé généré depuis l'OpenAPI
  ui/            design tokens
infra/
  docker-compose.yml  (postgres, redis, minio, gotenberg, api, worker, web, traefik)
```

Choix techniques :
- **Multi-tenant** : colonne `instance_id` partout + Row Level Security PostgreSQL.
- **Données de fiche** : colonne `JSONB` validée par le schéma de la version de structure ; index GIN ; colonnes extraites pour les champs filtrables.
- **Fichiers** : MinIO (S3), URLs signées, miniatures générées par le worker.
- **PDF** : docxtemplater (DOCX) + Gotenberg (conversion PDF).
- **Sync hors ligne** : modèle *pull* par curseur `updated_at` + *push* de mutations idempotentes (UUID générés côté client, `client_mutation_id`). Résolution de conflits : last-write-wins par champ, avec conflit enregistré et visible dans le back-office. Uploads de fichiers découplés et reprenables.
- **Auth** : OAuth2 maison dans NestJS (JWT court + refresh rotatif), mots de passe argon2.
- **Notifications** : Expo Push.
- **Déploiement** : Docker Compose derrière Traefik (TLS Let's Encrypt), compatible accès privé Tailscale. Pas de dépendance SaaS obligatoire.

---

# 3. Plan de livraison

Chaque phase se termine par : tests passants, seed de démo, README à jour, démo manuelle décrite.

**Phase 0 — Socle**
Monorepo, lint/format, CI (GitHub Actions), docker-compose de dev, NestJS + Prisma + migrations, auth OAuth2, multi-tenant + RLS, seed (1 instance, 3 utilisateurs, 3 rôles). `CLAUDE.md` à la racine avec conventions et commandes.

**Phase 1 — Moteur de formulaires**
`form-schema` + `form-engine` (conditions, calculs, validation) avec tests unitaires exhaustifs. CRUD structures versionnées, CRUD fiches, listes/référentiels avec import CSV/XLSX.

**Phase 2 — Back-office v1**
Designer drag & drop (dnd-kit) avec aperçu, gestion des listes, tableau des fiches (filtres, tri, export CSV/XLSX), détail d'une fiche, gestion utilisateurs/rôles/droits par structure.

**Phase 3 — Mobile hors ligne**
App Expo : login, menu, téléchargement des données, saisie de tous les types de champs, photos + annotation, signature, GPS, scan QR, brouillons, file de synchronisation. Tests de sync : mode avion, coupure en plein upload, conflits.

**Phase 4 — Workflow & tâches**
Éditeur de workflow, boutons de transition (web + mobile), droits par état, tâches/assignation, agenda web, notifications push.

**Phase 5 — Rapports & automatisations**
Modèles DOCX → PDF, envoi e-mail, moteur d'automatisations (déclencheurs/actions), webhooks sortants signés (HMAC), journal d'exécution.

**Phase 6 — Pilotage**
Vue carte, tableaux de bord configurables, audit trail complet, export ZIP des photos.

**Phase 7 — API publique & industrialisation**
OpenAPI, clés API, rate limiting, exemple n8n, sauvegardes PostgreSQL + MinIO, monitoring (healthchecks, logs structurés), builds EAS Android/iOS, durcissement sécurité (OWASP ASVS niveau 1).

---

# 4. Critères d'acceptation globaux

- Un administrateur crée un formulaire « Inspection équipement » (référentiel en cascade, photos annotées, signature, champ conditionnel, calcul, workflow Brouillon → Soumis → Validé/Rejeté) **sans code**, en moins de 15 minutes.
- Un technicien en mode avion remplit 10 fiches avec photos ; au retour réseau, tout se synchronise sans doublon ni perte.
- La validation d'une fiche déclenche l'envoi automatique du rapport PDF par e-mail.
- Une instance ne voit jamais les données d'une autre (tests d'isolation dédiés).
- `docker compose up` démarre la stack complète avec données de démo.

---

# 5. Règles de travail pour toi (Claude Code)

- Plan mode avant chaque phase ; liste de tâches tenue à jour.
- TDD sur `form-engine` et la sync ; tests e2e Playwright (web) et Maestro (mobile) sur les parcours critiques.
- Pas de nouvelle dépendance lourde sans la justifier dans `docs/adr/`.
- Une ADR par décision structurante (multi-tenant, sync, PDF, auth).
- Commits conventionnels, petits et atomiques.
- Si une exigence est ambiguë ou coûteuse, propose une alternative plutôt que d'inventer.
- À la fin de chaque phase : résumé de ce qui marche, ce qui reste, dette technique.
