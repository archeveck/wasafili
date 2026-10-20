#!/bin/sh
# Sauvegarde complète : base (pg_dump, format personnalisé) et fichiers (miroir cumulatif).
#   /backups/db/wasafili-<horodatage>.dump    une archive par sauvegarde, BACKUP_KEEP_DAYS jours
#   /backups/objects/                         miroir du bucket (objets immuables, jamais retirés)
# Les fichiers sont identifiés par UUID et jamais réécrits : le miroir cumulatif contient tous
# les objets de toute archive de base conservée. Les archives ZIP temporaires (exports) sont
# exclues.
set -eu

: "${PGHOST:=postgres}" "${PGUSER:=postgres}" "${PGDATABASE:=wasafili}"
: "${S3_ENDPOINT:=http://minio:9000}" "${S3_BUCKET:=wasafili}" "${BACKUP_KEEP_DAYS:=14}"
export PGHOST PGUSER PGDATABASE
# Pas de NOTICE de PostgreSQL dans les journaux.
export PGOPTIONS="-c client_min_messages=warning"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p /backups/db /backups/objects
log() { echo "$(date -u +%FT%TZ) sauvegarde: $*"; }

# Le superutilisateur contourne la RLS (forcée y compris pour le propriétaire des tables).
log "base $PGDATABASE → db/wasafili-$stamp.dump"
pg_dump --format=custom --no-owner --file="/backups/db/wasafili-$stamp.dump.partial" "$PGDATABASE"
mv "/backups/db/wasafili-$stamp.dump.partial" "/backups/db/wasafili-$stamp.dump"

log "fichiers $S3_BUCKET → objects/"
mc alias set source "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null
mc mirror --quiet --overwrite --exclude "*/exports/*" "source/$S3_BUCKET" /backups/objects >/dev/null

find /backups/db -name 'wasafili-*.dump' -mtime +"$BACKUP_KEEP_DAYS" -print -delete |
  sed 's/^/archive expirée supprimée : /'
log "terminée ($(du -sh /backups/db/wasafili-$stamp.dump | cut -f1) pour la base)"
