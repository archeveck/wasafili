# Dépendances et secrets (P7.4.3)

## Contrôles automatiques

| Contrôle                               | Où                               | Bloquant                                     |
| -------------------------------------- | -------------------------------- | -------------------------------------------- |
| `pnpm audit --prod --audit-level=high` | CI, job « Sécurité »             | oui : vulnérabilité haute ou critique livrée |
| gitleaks sur tout l'historique         | CI, job « Sécurité »             | oui : secret détecté                         |
| Dependabot (npm, Docker, Actions)      | `.github/dependabot.yml`, hebdo  | non : pull requests groupées                 |
| Lockfile figé                          | `pnpm install --frozen-lockfile` | oui                                          |

La règle gitleaks `wasafili-api-key-secret` reconnaît les secrets de clés API Wasafili par
leur préfixe `wsfsk_` : une clé publiée par erreur (dépôt, ticket, capture) est détectée.

## Exceptions en vigueur

Déclarées dans `pnpm-workspace.yaml` (`auditConfig.ignoreGhsas`). Revue au 19/10/2026 :
aucune n'est corrigée en amont, et toutes ne concernent que l'outillage de build mobile,
exécuté sur le poste ou la CI, jamais embarqué dans les images serveur ni dans
l'application.

| Alerte              | Paquet       | Gravité | Chemin                                | Pourquoi l'exception                                                                |
| ------------------- | ------------ | ------- | ------------------------------------- | ----------------------------------------------------------------------------------- |
| GHSA-86w9-cpqp-85rv | `node-forge` | haute   | `expo › @expo/cli`                    | CLI de développement Expo ; pas de vérification de signatures RSA d'origine externe |
| GHSA-vfj7-8cjw-p6xm | `braces`     | haute   | `react-native-worklets › metro`       | bundler Metro, motifs de fichiers du dépôt uniquement                               |
| GHSA-w5hq-g745-h8pq | `uuid`       | modérée | `expo › @expo/config-plugins › xcode` | génération du projet Xcode ; pas de tampon fourni                                   |

À réexaminer à chaque montée de SDK Expo (`npx expo install --fix`), et à retirer dès qu'un
correctif est publié.

## Faux positifs de secrets

`.gitleaksignore` liste par empreinte les faux positifs vérifiés (par exemple la lecture de
`S3_SECRET_KEY` depuis la configuration du worker). N'y ajouter une entrée qu'après avoir
vérifié qu'aucun secret réel n'est en cause ; un vrai secret publié se **révoque**
(clé API, mot de passe, secret de webhook) avant tout nettoyage de l'historique.
