#!/bin/sh
# Rôles PostgreSQL (D6) :
#  - wasafili_owner : propriétaire du schéma, exécute les migrations ;
#  - wasafili_app   : rôle applicatif (api, worker), sans BYPASSRLS, jamais propriétaire,
#                     donc soumis aux policies RLS.
# Exécuté par l'image au premier démarrage (volume vide). Relançable sans toucher aux données :
# crée ce qui manque et aligne les mots de passe sur l'environnement (docs/deploiement.md § 1.3).
set -eu
su="${POSTGRES_USER:-postgres}"

psql -q -v ON_ERROR_STOP=1 --username "$su" --dbname postgres -v su="$su" \
  -v owner="$WASAFILI_OWNER_PASSWORD" -v app="$WASAFILI_APP_PASSWORD" \
  -v supw="$POSTGRES_PASSWORD" <<'SQL'
SELECT 'CREATE ROLE wasafili_owner LOGIN CREATEDB'
  WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'wasafili_owner') \gexec
SELECT 'CREATE ROLE wasafili_app LOGIN NOBYPASSRLS'
  WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'wasafili_app') \gexec
ALTER ROLE wasafili_owner PASSWORD :'owner';
ALTER ROLE wasafili_app PASSWORD :'app';
ALTER ROLE :"su" PASSWORD :'supw';
SELECT format('CREATE DATABASE %I OWNER wasafili_owner', db)
  FROM unnest(ARRAY['wasafili', 'wasafili_test']) AS db
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = db) \gexec
SQL

for db in wasafili wasafili_test; do
  psql -q -v ON_ERROR_STOP=1 --username "$su" --dbname "$db" <<SQL
ALTER SCHEMA public OWNER TO wasafili_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO wasafili_app;
ALTER DEFAULT PRIVILEGES FOR ROLE wasafili_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO wasafili_app;
ALTER DEFAULT PRIVILEGES FOR ROLE wasafili_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO wasafili_app;
SQL
done
