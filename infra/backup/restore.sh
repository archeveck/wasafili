#!/bin/sh
# Restauration (P7.2.1) — REMPLACE la base et complète le stockage. Arrêter d'abord l'API et le
# worker : docker compose stop api worker web
#   restore.sh --yes [archive]      dernière archive par défaut (/backups/db/wasafili-*.dump)
set -eu

[ "${1:-}" = "--yes" ] || {
  echo "Remplace la base $PGDATABASE par une archive. Relancer avec --yes pour confirmer."
  exit 2
}
: "${PGHOST:=postgres}" "${PGUSER:=postgres}" "${PGDATABASE:=wasafili}"
: "${S3_ENDPOINT:=http://minio:9000}" "${S3_BUCKET:=wasafili}"
export PGHOST PGUSER PGDATABASE
# Pas de NOTICE de PostgreSQL dans les journaux.
export PGOPTIONS="-c client_min_messages=warning"
archive=${2:-$(ls -1 /backups/db/wasafili-*.dump | sort | tail -n 1)}
log() { echo "$(date -u +%FT%TZ) restauration: $*"; }

log "base $PGDATABASE ← $(basename "$archive")"
# Schéma public recréé (tables, policies RLS, triggers) puis données ; droits rétablis ensuite.
psql -q -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE" -c "CREATE SCHEMA public AUTHORIZATION wasafili_owner"
pg_restore --no-owner --role=wasafili_owner --exit-on-error --dbname="$PGDATABASE" "$archive"
psql -q -v ON_ERROR_STOP=1 \
  -c "GRANT USAGE ON SCHEMA public TO wasafili_app" \
  -c "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO wasafili_app" \
  -c "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO wasafili_app"

log "fichiers objects/ → $S3_BUCKET"
mc alias set cible "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null
mc mb --ignore-existing "cible/$S3_BUCKET"
mc mirror --quiet --overwrite /backups/objects "cible/$S3_BUCKET" >/dev/null
log "terminée : redémarrer l'API et le worker (docker compose start api worker web)"
