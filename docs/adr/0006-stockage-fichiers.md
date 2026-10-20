# ADR 0006 — Stockage des fichiers : S3 (MinIO), URL signées, miniatures par le worker

- Statut : accepté (Phase 2)
- Décision liée : D10 de [TASKS.md](../../TASKS.md)

## Décision

- **Dépôt direct** : `POST /v1/{app}/files/upload` enregistre le fichier (`pending`) et renvoie
  une URL `PUT` signée valable 15 minutes. Le **type MIME et la taille sont signés** : le
  stockage refuse un autre contenu. `POST /files/{id}/complete` vérifie l'objet (`HEAD`, taille)
  avant de le marquer `uploaded`. Les octets ne transitent jamais par l'API.
- **Reprise** : l'identifiant peut être généré par le client. Redemander l'upload avec le même
  identifiant renvoie une nouvelle URL, sans doublon. Un fichier déjà déposé ne renvoie plus
  d'URL. Le multipart pour les fichiers de plus de 5 Mo est prévu avec la file d'upload mobile (P3.5).
- **Deux points d'accès S3** : `S3_ENDPOINT` (réseau interne, conteneurs) et
  `S3_PUBLIC_ENDPOINT` (adresse vue des navigateurs et du mobile, utilisée pour signer).
- **Miniatures** : à la confirmation d'une image, l'API publie un job `thumbnail` (contrat
  partagé `@wasafili/jobs`, identifiant de job déterministe donc idempotent). Le worker génère un
  JPEG de 320 px avec **sharp**, l'écrit dans `{instance}/thumbs/{id}.jpg`, puis renseigne
  `files.thumbnail_key` en posant le contexte RLS de l'instance (rôle applicatif, ADR 0001).
- **Dépendances** : `@aws-sdk/client-s3` et `@aws-sdk/s3-request-presigner`, le SDK de référence,
  compatible avec tout stockage S3 (MinIO, Garage, SeaweedFS). Le client `minio` est écarté pour
  ne pas lier le code à un fournisseur. `sharp` (libvips, binaires précompilés, Alpine compris)
  sert aux miniatures. Il n'est installé que dans le worker.

## Conséquences

- MinIO doit accepter les requêtes CORS du back-office. C'est le cas par défaut. En production,
  restreindre les origines côté stockage (P7.4.2).
- L'image officielle MinIO n'étant plus publiée, le fork `pgsty/minio` est utilisé. Le code ne
  dépend que de l'API S3 : un changement de stockage ne demande qu'une configuration.
