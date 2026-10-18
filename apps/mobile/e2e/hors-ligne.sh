#!/bin/sh
# Scénario hors ligne de bout en bout sur simulateur (P3.8.1).
# Prérequis : Metro (npx expo start --lan), app ouverte et connectée, base de démonstration.
# API_STOP et API_START : commandes qui coupent puis relancent l'API locale.
set -eu
cd "$(dirname "$0")"
MAESTRO="${MAESTRO:-$HOME/.maestro/bin/maestro}"
: "${API_STOP:?API_STOP requis (ex. pkill -f 'node dist/main.js')}"
: "${API_START:?API_START requis (ex. cd ../../api && node dist/main.js &)}"
COUNT_BEFORE="${COUNT_CMD:+$(sh -c "$COUNT_CMD")}"

sh -c "$API_STOP"
"$MAESTRO" test hors-ligne-saisie.yaml
sh -c "$API_START"
sleep 5
"$MAESTRO" test hors-ligne-retour.yaml

if [ -n "${COUNT_CMD:-}" ]; then
  COUNT_AFTER="$(sh -c "$COUNT_CMD")"
  echo "Fiches sur le serveur : $COUNT_BEFORE → $COUNT_AFTER"
  [ "$((COUNT_AFTER - COUNT_BEFORE))" -eq 3 ] || { echo "Attendu : +3 fiches exactement"; exit 1; }
fi
