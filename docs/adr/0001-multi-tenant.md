# ADR 0001 — Multi-tenant : `instance_id` + Row Level Security PostgreSQL

- Statut : accepté (Phase 0)
- Décision liée : D6 de [TASKS.md](../../TASKS.md)

## Contexte

Une instance (client) ne doit **jamais** voir les données d'une autre (critère d'acceptation
global). Un filtre `WHERE instance_id = …` oublié dans le code applicatif suffirait à provoquer
une fuite : l'isolation doit reposer sur la base, pas sur la discipline des développeurs.

## Décision

1. **Colonne `instance_id`** sur toute table métier, avec une policy RLS
   `instance_id = app_current_instance()` en lecture (`USING`) et en écriture (`WITH CHECK`).
2. **Contexte par transaction** : l'API pose `app.instance_id`, `app.user_id` et
   `app.oauth_client_id` via `set_config(…, true)` (portée = transaction). Sans contexte, les
   fonctions `app_current_*()` renvoient `NULL` : aucune ligne n'est visible ni modifiable.
3. **Extension Prisma** ([tenant.ts](../../apps/api/src/prisma/tenant.ts)) : chaque opération
   de modèle est exécutée dans une transaction `[set_config, requête]`. Le contexte est lu dans
   un `AsyncLocalStorage` ouvert par un middleware et complété par les guards (utilisateur,
   puis instance résolue depuis `/v1/{app}/…`). `PrismaService.transaction()` couvre les
   transactions interactives.
4. **Deux rôles PostgreSQL** ([01-roles.sh](../../infra/postgres/01-roles.sh)) :
   `tesserax_owner` possède le schéma et exécute les migrations ; `tesserax_app` (API, worker)
   n'a pas `BYPASSRLS` et ne possède aucune table. `FORCE ROW LEVEL SECURITY` soumet aussi le
   propriétaire aux policies (seed et fixtures doivent poser un contexte).
5. **Clés étrangères composites** `(id, instance_id)` entre tables d'une même instance : les
   vérifications de FK contournent la RLS, la clé composite empêche donc de référencer une ligne
   d'une autre instance.
6. **Registre d'identité hors RLS** : `instances`, `users` et `refresh_tokens` ne contiennent
   aucune donnée propre à une instance. Un utilisateur peut appartenir à plusieurs instances
   (`memberships`).
7. **Lectures « propres lignes »** limitées aux requêtes **sans** contexte d'instance :
   l'utilisateur lit ses adhésions (`GET /v1/apps`), l'endpoint de jeton lit le client OAuth
   en cours d'authentification. Dans une instance, ces policies ne s'appliquent pas — sinon,
   combinées en OU à `tenant_isolation`, elles exposeraient les adhésions aux autres instances.
8. Une instance inaccessible répond **404**, comme une instance inexistante.

## Garde-fous testés

[rls.e2e.test.ts](../../apps/api/test/rls.e2e.test.ts) et
[isolation.e2e.test.ts](../../apps/api/test/isolation.e2e.test.ts) vérifient notamment :

- toute table portant `instance_id` a la RLS **activée et forcée** (test générique : une
  nouvelle table oubliée fait échouer la CI) ;
- le rôle applicatif n'a ni `BYPASSRLS` ni `SUPERUSER` et ne possède aucune table ;
- sans contexte : zéro ligne, y compris en SQL brut ; insertion refusée ;
- avec le contexte A : lecture, listing, comptage, mise à jour et suppression limités à A ;
- chaque endpoint `/v1/{app}/…` appelé depuis une autre instance → 404.

## Conséquences

- Chaque requête de modèle coûte une transaction (`BEGIN`, `set_config`, requête, `COMMIT`).
  Acceptable au volume visé ; à mesurer en Phase 7 (regroupement en transactions interactives
  sur les chemins chauds si besoin).
- Les requêtes Prisma sont **paresseuses** : elles s'exécutent au premier `await`.
  `runWithContext()` attend donc le résultat à l'intérieur du contexte ; ne jamais renvoyer une
  requête Prisma non attendue hors du scope où le contexte est posé.
- Toute nouvelle table métier doit : porter `instance_id`, activer et forcer la RLS, créer la
  policy `tenant_isolation` dans sa migration, utiliser des FK composites vers les tables
  d'instance.
- Le worker (Phase 2+) utilisera la même extension, en posant le contexte du job.
