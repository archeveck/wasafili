#!/bin/sh
# Planifie la tâche « Contrôle ascenseur » du parcours taches-workflow.yaml (dans une heure),
# assignée au technicien de démonstration et pré-remplie avec l'équipement EQ-0003.
# Usage : API=http://localhost:3000 PSQL="docker exec wasafili-postgres-1 psql -U postgres -d wasafili" sh planifier-tache.sh
set -eu
API="${API:-http://localhost:3000}"
PSQL="${PSQL:-docker exec wasafili-postgres-1 psql -U postgres -d wasafili}"
q() { $PSQL -tAc "$1"; }
export SITE="$(q "select id from list_items where code='S-PLT'")"
export BAT="$(q "select id from list_items where code='B-PLT-A'")"
export EQ="$(q "select id from list_items where code='EQ-0003'")"
export TECH="$(q "select id from users where email='technicien@wasafili.local'")"
export STRUCT="$(q "select s.id from structures s join instances i on i.id = s.instance_id where i.short = 'demo' and s.name = 'Inspection équipement'")"
TOKEN="$(curl -sf "$API/v1/oauth/token" -H 'content-type: application/json' \
  -d '{"grant_type":"password","username":"superviseur@wasafili.local","password":"Wasafili2026!"}' |
  python3 -c 'import sys, json; print(json.load(sys.stdin)["access_token"])')"
python3 - <<'PY' | curl -sf "$API/v1/demo/tasks" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d @- >/dev/null
import datetime, json, os
d = datetime.datetime.now(datetime.UTC).replace(minute=0, second=0, microsecond=0)
at = lambda h: (d + datetime.timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M:%SZ")
print(json.dumps({"structureId": os.environ["STRUCT"], "title": "Contrôle ascenseur",
  "assigneeUserId": os.environ["TECH"], "startAt": at(1), "endAt": at(2),
  "locationLabel": "Tour Alpha, bâtiment A",
  "prefill": {"site": os.environ["SITE"], "batiment": os.environ["BAT"], "equipement": os.environ["EQ"]}}))
PY
echo "Tâche planifiée"
