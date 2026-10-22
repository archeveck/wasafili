# Sauvegardes (P7.2.1) : pg_dump de la base et miroir du stockage MinIO, planifiés par crond.
FROM pgsty/mc:RELEASE.2026-09-16T00-00-00Z AS mc

FROM postgres:16-alpine
COPY --from=mc /usr/bin/mc /usr/bin/mc
COPY backup.sh restore.sh verify.sh entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/*.sh
VOLUME /backups
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
