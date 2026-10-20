# OWASP ASVS 4.0.3 — niveau 1

Revue du 19/10/2026 (Phase 7, P7.4.1). Chaque exigence de niveau 1 applicable est tracée
vers son implémentation et le test qui la vérifie.

Statuts : ✅ conforme · 🟡 partiel (écart justifié, plan indiqué) · ➖ non applicable.

Synthèse : aucune exigence non traitée. 4 écarts partiels, tous documentés ci-dessous :
2.1.7, 2.5.x, 3.2.3 et 12.4.1 (antivirus).

## V1 — Architecture (niveau 1 : pas d'exigence vérifiable)

Décisions structurantes dans [`docs/adr/`](../adr/) : isolation multi-tenant par RLS
([0001](../adr/0001-multi-tenant.md)), authentification ([0002](../adr/0002-auth.md)),
API publique et exploitation ([0011](../adr/0011-api-publique-exploitation.md)).

## V2 — Authentification

| #           | Exigence                                       | Statut | Preuve                                                                                                                                                                                                                                                                                                                                    |
| ----------- | ---------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1.1–2.1.4 | 12 caractères min., 64+ admis, tout Unicode    | ✅     | `apps/api/src/auth/password-policy.ts` (12–200, sans troncature) ; `password-policy.test.ts`                                                                                                                                                                                                                                              |
| 2.1.5–2.1.6 | Changement de mot de passe, ancien exigé       | ✅     | `POST /v1/me/password` ; toutes les sessions fermées ; `auth.e2e.test.ts`, `e2e/account.spec.ts`                                                                                                                                                                                                                                          |
| 2.1.7       | Mots de passe compromis refusés                | 🟡     | liste embarquée des mots de passe les plus répandus et variantes locales, sans service externe (pas de dépendance SaaS) ; liste élargie possible sans changement d'interface                                                                                                                                                              |
| 2.1.8–2.1.9 | Pas de règle de composition, indicateur aidant | ✅     | aucune règle de composition ; conseil « phrase de passe » dans le formulaire                                                                                                                                                                                                                                                              |
| 2.1.10      | Pas de rotation périodique imposée             | ✅     | aucune expiration de mot de passe                                                                                                                                                                                                                                                                                                         |
| 2.1.11      | Copier-coller, gestionnaires de mots de passe  | ✅     | champs `password` standard, `autocomplete` renseigné                                                                                                                                                                                                                                                                                      |
| 2.1.12      | Affichage temporaire du mot de passe           | ✅     | navigateur ; mobile : bouton « Afficher » (`apps/mobile/e2e/connexion.yaml`)                                                                                                                                                                                                                                                              |
| 2.2.1       | Anti-automatisation                            | ✅     | limite par IP sur `/v1/oauth/token` (Redis, `LOGIN_RATE_LIMIT_PER_MINUTE`) ; `auth.e2e.test.ts`, `rate-limit.e2e.test.ts`                                                                                                                                                                                                                 |
| 2.2.2       | Authentifiants faibles (SMS, e-mail) évités    | ✅     | mot de passe et refresh token rotatif ; aucun facteur faible                                                                                                                                                                                                                                                                              |
| 2.2.3       | Notification après changement de sécurité      | ✅     | changement de mot de passe et usages de clés API journalisés (`auth.password_change`, `apikey.*`), visibles des administrateurs                                                                                                                                                                                                           |
| 2.3.1       | Secret initial aléatoire, à usage limité       | ✅     | mot de passe temporaire de 16 caractères aléatoires, montré une fois à l'administrateur ; changement possible par l'utilisateur                                                                                                                                                                                                           |
| 2.5.1–2.5.4 | Récupération du compte                         | 🟡     | pas de « mot de passe oublié » libre-service : réinitialisation par un administrateur de l'instance (`POST /v1/{app}/users/{id}/password-reset`, mot de passe provisoire, sessions fermées, refusée pour un compte membre d'autres instances ; `iam.e2e.test.ts`). Aucun indice ni question secrète. Libre-service par e-mail : à prévoir |
| 2.5.6       | Pas de secret partagé par défaut               | ✅     | comptes de démonstration créés par `pnpm db:seed` seulement ; production : aucun compte par défaut hors l'administrateur initial                                                                                                                                                                                                          |
| 2.7–2.8     | OTP, MFA                                       | ➖     | non proposés au niveau 1                                                                                                                                                                                                                                                                                                                  |
| 2.10.1–4    | Secrets de service                             | ✅     | aucun secret dans le code : variables d'environnement (`${VAR:?}` obligatoires en production) ; recherche de secrets en CI (gitleaks)                                                                                                                                                                                                     |

Stockage des mots de passe : argon2id (`@node-rs/argon2`), comparaison constante, compte
inconnu traité au même coût (ADR 0002). Secrets de clés API : 256 bits, SHA-256.

## V3 — Sessions

| #           | Exigence                                    | Statut | Preuve                                                                                                                                     |
| ----------- | ------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 3.1.1       | Jeton jamais dans l'URL                     | ✅     | en-tête `Authorization: Bearer` uniquement                                                                                                 |
| 3.2.1–3.2.2 | Nouveau jeton à la connexion, 128 bits+     | ✅     | JWT signé à chaque connexion ; refresh token opaque de 256 bits                                                                            |
| 3.2.3       | Stockage sûr côté navigateur                | 🟡     | `localStorage` (stockage HTML5 admis par l'exigence), protégé par la CSP stricte du back-office ; cookie `HttpOnly` envisageable plus tard |
| 3.3.1       | Déconnexion effective                       | ✅     | `POST /v1/oauth/revoke` révoque la famille de refresh tokens ; `auth.e2e.test.ts`                                                          |
| 3.3.2       | Réauthentification périodique               | ✅     | jeton d'accès 15 min, refresh 30 jours                                                                                                     |
| 3.5.2–3.5.3 | Jetons signés, algorithme imposé            | ✅     | HS256 imposé à la vérification (`algorithms: ['HS256']`), émetteur vérifié                                                                 |
| 3.7.1       | Réauthentification avant opération sensible | ✅     | ancien mot de passe exigé pour le changer                                                                                                  |

Révocation immédiate d'une clé API (relue à chaque requête) : `api-clients.e2e.test.ts`.

## V4 — Contrôle d'accès

| #           | Exigence                                    | Statut | Preuve                                                                                                                                                          |
| ----------- | ------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1.1–4.1.3 | Contrôle côté serveur, refus par défaut     | ✅     | guards globaux JWT → instance → débit → permission ; RLS PostgreSQL forcée (une instance ne voit jamais une autre) ; `rls.e2e.test.ts`, `isolation.e2e.test.ts` |
| 4.1.5       | Échec sûr                                   | ✅     | instance inaccessible = 404, permission manquante = 403, sans détail interne                                                                                    |
| 4.2.1       | IDOR                                        | ✅     | RLS par instance + droits par formulaire (`StructureAccessService`) ; `access.e2e.test.ts`, `rbac.e2e.test.ts`                                                  |
| 4.2.2       | CSRF                                        | ✅     | jeton Bearer en en-tête (pas de cookie d'authentification), CORS fermé par défaut                                                                               |
| 4.3.1       | Interfaces d'administration protégées       | ✅     | permissions `*:manage` ; pas de délégation d'une permission non détenue (clés API, rôles)                                                                       |
| 4.3.2       | Pas de listing de répertoires, ni de `.git` | ✅     | nginx sert le build seul ; aucun index de répertoire                                                                                                            |

## V5 — Validation, assainissement, encodage

| #           | Exigence                                 | Statut | Preuve                                                                                                                           |
| ----------- | ---------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 5.1.1–5.1.5 | Validation positive des entrées          | ✅     | schémas Zod sur chaque corps et requête (`ZodValidationPipe`) ; fiches validées par `@wasafili/form-engine`                      |
| 5.2.x       | Assainissement (HTML, gabarits, SSRF)    | ✅     | React échappe tout rendu ; jamais de XML brut issu d'une saisie dans un rapport (ADR 0009) ; webhooks : garde SSRF en production |
| 5.3.1–5.3.4 | Encodage de sortie, requêtes paramétrées | ✅     | Prisma et `Prisma.sql` paramétrés (filtres, agrégations) ; aucune concaténation SQL                                              |
| 5.3.8       | Injection de commande système            | ✅     | aucun appel au shell depuis l'API                                                                                                |
| 5.5.x       | Désérialisation                          | ✅     | JSON uniquement, validé ; DOCX ouvert par `pizzip` (pas d'exécution)                                                             |

## V7 — Erreurs et journalisation

| #           | Exigence                              | Statut | Preuve                                                                                                             |
| ----------- | ------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| 7.1.1–7.1.2 | Pas de secret ni de donnée de session | ✅     | en-têtes `authorization` et `cookie` masqués (pino) ; métadonnées d'audit assainies (`sanitizeMetadata`)           |
| 7.4.1       | Message d'erreur générique            | ✅     | filtre global : `{ statusCode, error, message }`, pas de trace en réponse ; identifiant de requête pour le support |

Journal d'audit en ajout seul (ADR 0010) ; journaux JSON corrélés par `X-Request-Id`.

## V8 — Protection des données

| #     | Exigence                                              | Statut | Preuve                                                                                                                                        |
| ----- | ----------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 8.2.1 | Pas de mise en cache des données                      | ✅     | `Cache-Control: no-store` sur toute réponse de l'API ; `ops.e2e.test.ts`                                                                      |
| 8.2.2 | Données sensibles hors stockage durable du navigateur | ✅     | le back-office ne conserve que les jetons ; le mobile chiffre ses jetons (SecureStore) et garde les fiches pour le hors ligne (besoin métier) |
| 8.3.1 | Données sensibles hors de l'URL                       | ✅     | identifiants et secrets dans le corps ou les en-têtes ; URL signées de 15 minutes pour les fichiers                                           |

## V9 — Communications

| #     | Exigence                         | Statut | Preuve                                                                                    |
| ----- | -------------------------------- | ------ | ----------------------------------------------------------------------------------------- |
| 9.1.1 | TLS pour toute connexion cliente | ✅     | Traefik (Let's Encrypt), redirection HTTP → HTTPS, HSTS ; `infra/docker-compose.prod.yml` |
| 9.1.2 | Configuration TLS à jour         | ✅     | TLS 1.2+ par défaut de Traefik 3                                                          |

## V10 — Code malveillant

| #      | Exigence              | Statut | Preuve                                                                                           |
| ------ | --------------------- | ------ | ------------------------------------------------------------------------------------------------ |
| 10.3.2 | Dépendances vérifiées | ✅     | lockfile figé en CI, `pnpm audit --prod` bloquant, Dependabot ; [dependances.md](dependances.md) |

## V11 — Logique métier

| #             | Exigence                                       | Statut | Preuve                                                                                             |
| ------------- | ---------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------- |
| 11.1.1–11.1.4 | Ordre des étapes, limites, anti-automatisation | ✅     | transitions vérifiées par `checkTransition` ; limites de débit par utilisateur, client et instance |

## V12 — Fichiers et ressources

| #          | Exigence                              | Statut | Preuve                                                                                                                                                                |
| ---------- | ------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 12.1.1     | Taille maximale                       | ✅     | `MAX_UPLOAD_BYTES` (25 Mo), taille signée dans l'URL de dépôt et vérifiée à la confirmation ; import tableur 10 Mo                                                    |
| 12.3.x     | Pas de chemin issu de l'utilisateur   | ✅     | clés de stockage `instance/uuid` générées par l'API ; noms des archives ZIP assainis                                                                                  |
| 12.4.1     | Fichiers servis hors de l'application | ✅     | domaine de stockage distinct, URL signées ; types actifs refusés, signature des images et PDF vérifiée, autres types en téléchargement ; `files-settings.e2e.test.ts` |
| 12.4.1 bis | Analyse antivirus                     | 🟡     | non intégrée (pas de dépendance imposée) ; branchement possible d'un ClamAV à la confirmation du dépôt                                                                |
| 12.5.1–2   | Pas de fichiers sensibles servis      | ✅     | nginx ne sert que le build ; `/metrics` hors proxy                                                                                                                    |
| 12.6.1     | SSRF                                  | ✅     | webhooks : adresses privées refusées en production (`WEBHOOK_ALLOW_PRIVATE=false`)                                                                                    |

## V13 — API

| #      | Exigence                        | Statut | Preuve                                                                           |
| ------ | ------------------------------- | ------ | -------------------------------------------------------------------------------- |
| 13.1.1 | Encodages et parseurs cohérents | ✅     | JSON UTF-8 ; formulaire `x-www-form-urlencoded` pour OAuth seulement             |
| 13.1.3 | Pas de clé d'API dans l'URL     | ✅     | `client_credentials` dans l'en-tête Basic ou le corps                            |
| 13.2.1 | Méthodes HTTP restreintes       | ✅     | routes déclarées seulement ; CORS limité à GET, POST, PUT, PATCH, DELETE         |
| 13.2.3 | Protection CSRF des API REST    | ✅     | pas de cookie d'authentification                                                 |
| 13.2.5 | Vérification du type de contenu | ✅     | corps validé par schéma ; documentation OpenAPI exacte (contrat vérifié en test) |

## V14 — Configuration

| #             | Exigence                           | Statut | Preuve                                                                                                                                                                       |
| ------------- | ---------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 14.2.1        | Composants à jour                  | ✅     | Dependabot hebdomadaire ; audit bloquant en CI                                                                                                                               |
| 14.3.2        | Pas de mode débogage en production | ✅     | `NODE_ENV=production`, pas de trace en réponse, `x-powered-by` retiré, `server_tokens off`                                                                                   |
| 14.3.3        | En-têtes sans version de composant | ✅     | `Server: nginx` sans version ; pas d'en-tête Express                                                                                                                         |
| 14.4.1–14.4.7 | En-têtes de sécurité               | ✅     | API : CSP `default-src 'none'`, `nosniff`, `no-referrer`, CORP ; back-office : CSP stricte, `frame-ancestors 'none'`, Permissions-Policy, HSTS (Traefik) ; `ops.e2e.test.ts` |
| 14.5.3        | CORS : liste d'origines            | ✅     | `CORS_ORIGINS` (vide par défaut) ; origine inconnue refusée ; `ops.e2e.test.ts`                                                                                              |

## Rejouer la revue

```bash
pnpm test:integration                       # contrôles d'accès, RLS, en-têtes, fichiers, débit
pnpm test:e2e                               # parcours (dont clés API, mot de passe)
pnpm audit --prod --audit-level=high        # dépendances (exceptions : dependances.md)
docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:v8.28.0 git /repo \
  --config /repo/.gitleaks.toml --gitleaks-ignore-path /repo/.gitleaksignore
```
