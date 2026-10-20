# Connecter Wasafili à n8n

Deux workflows prêts à importer dans [n8n](https://n8n.io) (auto-hébergé ou n8n Cloud) :

| Fichier                                                    | Déclencheur                      | Ce qu'il fait                                                                                                               |
| ---------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [`rapport-fiche-validee.json`](rapport-fiche-validee.json) | webhook Wasafili                 | À chaque fiche **validée** : vérifie la signature du webhook, génère le rapport PDF de la fiche par l'API et le télécharge. |
| [`export-fiches.json`](export-fiches.json)                 | toutes les heures (ou à la main) | Lit les fiches validées des dernières 24 h, **toutes les pages**, et produit une ligne par fiche.                           |

Le dernier nœud de chaque workflow (« À brancher : … ») ne fait rien : remplacez-le par
l'outil de votre choix (e-mail, Google Drive, tableur, ERP, entrepôt de données…).

Vérifié le 19/10/2026 avec n8n 2.43.8 : signature valide, rapport PDF téléchargé (43,6 Ko),
appel forgé ou rejoué refusé (401), pagination sur 4 pages sans doublon.

## 1. Créer une clé API dans Wasafili

Back-office → **Clés API** → **Nouvelle clé** (permission `apikey:manage`).

- Nom : `n8n`.
- Permissions, le strict nécessaire :
  - `structure:read` et `submission:read:all` pour les deux workflows ;
  - ajoutez-en d'autres seulement si vous étendez les workflows (par exemple
    `submission:update` pour écrire dans les fiches).

Copiez l'**identifiant** (`wsf_…`) et le **secret** (`wsfsk_…`) : le secret n'est affiché
qu'une fois. En cas de perte ou de fuite : **Régénérer le secret** (l'ancien cesse de
fonctionner) ou **révoquer** la clé (effet immédiat, même sur les jetons déjà émis).

## 2. Créer l'identifiant dans n8n

n8n → **Credentials** → **Add credential** → **OAuth2 API** :

| Champ            | Valeur                                               |
| ---------------- | ---------------------------------------------------- |
| Name             | `Wasafili (clé API)` (nom attendu par les workflows) |
| Grant Type       | `Client Credentials`                                 |
| Access Token URL | `https://<votre-domaine>/v1/oauth/token`             |
| Client ID        | l'identifiant `wsf_…`                                |
| Client Secret    | le secret `wsfsk_…`                                  |
| Scope            | (vide : les permissions sont celles de la clé)       |
| Authentication   | `Header`                                             |

n8n obtient et renouvelle seul le jeton d'accès (15 minutes).

## 3. Importer les workflows

n8n → **Workflows** → **Import from File**, puis ouvrez le nœud **Configuration** :

| Champ            | Workflow | Valeur                                                                     |
| ---------------- | -------- | -------------------------------------------------------------------------- |
| `baseUrl`        | les deux | adresse du back-office, sans `/` final (`https://wasafili.exemple.ci`)     |
| `app`            | les deux | nom court de l'instance (dans l'URL du back-office : `/demo/…`)            |
| `reportId`       | rapport  | identifiant du modèle de rapport (`id`, voir ci-dessous)                   |
| `validatedState` | rapport  | clé de l'état « validé » du workflow du formulaire (`valide` dans la démo) |
| `webhookSecret`  | rapport  | secret du webhook Wasafili (étape 4)                                       |
| `structureId`    | export   | identifiant du formulaire (URL de sa page de fiches)                       |
| `state`, `since` | export   | état et période des fiches lues                                            |

Sur chaque nœud **HTTP Request** qui appelle l'API, sélectionnez l'identifiant
`Wasafili (clé API)`. Les identifiants viennent de l'API (page `/v1/docs`, bouton
**Authorize** avec la clé) : `GET /v1/{app}/structures` pour les formulaires, puis
`GET /v1/{app}/structures/{id}/reports` pour leurs modèles de rapport.

## 4. Brancher le webhook (workflow « rapport »)

1. Dans n8n, activez (publiez) le workflow et copiez l'URL de production du nœud
   **Webhook Wasafili** (`https://<n8n>/webhook/wasafili-fiches`).
2. Back-office Wasafili → **Automatisations** → **Webhooks** → **Nouveau webhook** :
   l'URL ci-dessus, l'événement **Changement d'état**, et le formulaire voulu.
3. Copiez le secret affiché dans le champ `webhookSecret` du nœud **Configuration**, puis
   enregistrez le workflow.
4. Bouton **Tester** du webhook : la livraison doit apparaître « livrée » (réponse
   `{"ignored":true}`, l'événement de test n'étant pas une validation). Validez ensuite une
   fiche : le journal des exécutions de n8n montre le PDF téléchargé.

## Sécurité

- **Signature** : chaque livraison porte `X-Wasafili-Signature: sha256=<hex>`, un
  HMAC-SHA256 du secret sur `<X-Wasafili-Timestamp>.<corps>`. Le workflow refuse (401) une
  signature fausse ou un horodatage de plus de 5 minutes (rejeu). Wasafili retente une
  livraison refusée, puis désactive le webhook après 5 échecs d'affilée.
- **Moindre privilège** : la clé n'a que les permissions nécessaires. Toute action de la
  clé figure au **Journal d'audit** sous son nom (par exemple « Rapport généré »).
- **Secrets** : le secret de la clé reste dans le coffre d'identifiants de n8n ; celui du
  webhook est dans le workflow, ne partagez donc pas un export de workflow configuré.
- **Débit** : 300 requêtes par minute et par clé (réglable : `RATE_LIMIT_CLIENT_PER_MINUTE`).
  Au-delà, l'API répond `429` avec `Retry-After` ; activez **Retry On Fail** sur les nœuds
  HTTP Request pour les gros volumes.

## Aller plus loin

La documentation interactive de l'API est servie par Wasafili sous `/v1/docs` (OpenAPI
3.1 : `/v1/openapi.json`). Chaque route y indique la permission (scope) requise.
