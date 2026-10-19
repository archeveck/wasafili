#!/bin/sh
# Planification (crond) : sauvegarde puis vérification de restauration, chaque jour à
# BACKUP_CRON (défaut 02:30 UTC). `docker compose run --rm backup backup.sh` pour une
# sauvegarde immédiate.
set -eu
if [ "$#" -gt 0 ]; then exec "$@"; fi
env | grep -E '^(PG|S3_|BACKUP_)' | sed 's/^/export /; s/=/="/; s/$/"/' >/etc/backup.env
echo "${BACKUP_CRON:-30 2 * * *} . /etc/backup.env && backup.sh && verify.sh > /proc/1/fd/1 2>&1" \
  >/etc/crontabs/root
echo "sauvegardes planifiées : ${BACKUP_CRON:-30 2 * * *} (UTC)"
exec crond -f -l 8
