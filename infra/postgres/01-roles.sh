#!/bin/sh
# Rôles PostgreSQL (D6) :
#  - wasafili_owner : propriétaire du schéma, exécute les migrations ;
#  - wasafili_app   : rôle applicatif (api, worker), sans BYPASSRLS, jamais propriétaire,
#                     donc soumis aux policies RLS.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE wasafili_owner LOGIN CREATEDB PASSWORD '${WASAFILI_OWNER_PASSWORD}';
CREATE ROLE wasafili_app LOGIN NOBYPASSRLS PASSWORD '${WASAFILI_APP_PASSWORD}';
SQL

for db in wasafili wasafili_test; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
    -c "CREATE DATABASE $db OWNER wasafili_owner"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" <<SQL
ALTER SCHEMA public OWNER TO wasafili_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO wasafili_app;
ALTER DEFAULT PRIVILEGES FOR ROLE wasafili_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO wasafili_app;
ALTER DEFAULT PRIVILEGES FOR ROLE wasafili_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO wasafili_app;
SQL
done
