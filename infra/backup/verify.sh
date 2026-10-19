#!/bin/sh
# Vérification de restauration (P7.2.1) : restaure la dernière archive dans une base jetable,
# compare le nombre de lignes de chaque table avec la base vivante (qui ne doit pas avoir
# changé entre-temps : à lancer juste après la sauvegarde), et vérifie que chaque fichier
# déposé référencé par la base est présent dans le miroir. Code de sortie non nul en cas d'écart.
set -eu

: "${PGHOST:=postgres}" "${PGUSER:=postgres}" "${PGDATABASE:=tesserax}"
export PGHOST PGUSER
export PGOPTIONS="-c client_min_messages=warning"
scratch=tesserax_verification
archive=$(ls -1 /backups/db/tesserax-*.dump 2>/dev/null | sort | tail -n 1)
[ -n "$archive" ] || { echo "vérification: aucune archive"; exit 1; }
log() { echo "$(date -u +%FT%TZ) vérification: $*"; }

log "restauration de $(basename "$archive") dans $scratch"
psql -q -d postgres -c "DROP DATABASE IF EXISTS $scratch" -c "CREATE DATABASE $scratch"
trap 'psql -q -d postgres -c "DROP DATABASE IF EXISTS $scratch"' EXIT
pg_restore --no-owner --exit-on-error --dbname="$scratch" "$archive"

counts() {
  psql -At -d "$1" -c "SELECT format('SELECT %L, count(*) FROM %I UNION ALL', tablename, tablename)
    FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename" |
    { cat; echo "SELECT '', 0"; } | psql -At -F ' ' -d "$1" | grep -v '^ 0$'
}
counts "$PGDATABASE" >/tmp/live.txt
counts "$scratch" >/tmp/restored.txt
if ! diff -u /tmp/live.txt /tmp/restored.txt; then
  log "ÉCHEC : nombres de lignes différents"
  exit 1
fi
log "$(wc -l </tmp/live.txt) tables, $(awk '{ s += $2 } END { print s }' /tmp/live.txt) lignes identiques"

missing=0
for key in $(psql -At -d "$scratch" -c "SELECT key FROM files WHERE status = 'uploaded'"); do
  [ -f "/backups/objects/$key" ] || { log "fichier absent du miroir : $key"; missing=$((missing + 1)); }
done
if [ "$missing" -gt 0 ]; then
  log "ÉCHEC : $missing fichier(s) manquant(s)"
  exit 1
fi
log "OK : $(psql -At -d "$scratch" -c "SELECT count(*) FROM files WHERE status = 'uploaded'") fichier(s) présents"
