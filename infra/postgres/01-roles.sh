#!/bin/sh
# Rôles PostgreSQL (D6) :
#  - tesserax_owner : propriétaire du schéma, exécute les migrations ;
#  - tesserax_app   : rôle applicatif (api, worker), sans BYPASSRLS, jamais propriétaire,
#                     donc soumis aux policies RLS.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE tesserax_owner LOGIN CREATEDB PASSWORD '${TESSERAX_OWNER_PASSWORD}';
CREATE ROLE tesserax_app LOGIN NOBYPASSRLS PASSWORD '${TESSERAX_APP_PASSWORD}';
SQL

for db in tesserax tesserax_test; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
    -c "CREATE DATABASE $db OWNER tesserax_owner"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" <<SQL
ALTER SCHEMA public OWNER TO tesserax_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO tesserax_app;
ALTER DEFAULT PRIVILEGES FOR ROLE tesserax_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tesserax_app;
ALTER DEFAULT PRIVILEGES FOR ROLE tesserax_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO tesserax_app;
SQL
done
