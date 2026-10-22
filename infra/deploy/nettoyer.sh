#!/usr/bin/env bash
# Nettoyage du serveur : retire la pile Docker de Wasafili pour repartir d'un état propre,
# avant un nouveau infra/deploy/deployer.sh. Sur le serveur, en root.
#
#   sudo infra/deploy/nettoyer.sh               # conteneurs, réseaux, images construites, cache
#   sudo infra/deploy/nettoyer.sh --donnees     # + base, Redis, fichiers (sauvegardés avant)
#   sudo infra/deploy/nettoyer.sh --donnees --certificats --secrets   # remise à zéro complète
#
# Sans option, aucune donnée n'est perdue : `deployer.sh` remonte la pile à l'identique.
# Jamais touchés : les sauvegardes (BACKUP_DIR), le code, le fond de carte, les images de base
# (postgres, redis… : long à re-télécharger) et les autres projets Docker du serveur.
set -euo pipefail

PROJET=wasafili
DONNEES=0
CERTIFICATS=0
SECRETS=0
SAUVEGARDE=1
OUI=0

usage() {
  sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
  cat <<'EOF'

Options :
  --donnees           supprime aussi les volumes de la base, de Redis et des fichiers
  --certificats       supprime aussi les certificats Let's Encrypt (quota : 5 par semaine)
  --secrets           supprime aussi infra/.env (avec --donnees seulement)
  --sans-sauvegarde   pas de sauvegarde avant --donnees
  --oui               pas de confirmation
EOF
}

while [ $# -gt 0 ]; do
  case $1 in
    --donnees) DONNEES=1 ;;
    --certificats) CERTIFICATS=1 ;;
    --secrets) SECRETS=1 ;;
    --sans-sauvegarde) SAUVEGARDE=0 ;;
    --oui) OUI=1 ;;
    -h | --help) usage; exit 0 ;;
    *) echo "Option inconnue : $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

etape() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
die() { printf '\033[31merreur : %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "à lancer en root : sudo $0"
# Nouveaux mots de passe sur d'anciennes données : base et stockage illisibles.
[ $SECRETS -eq 0 ] || [ $DONNEES -eq 1 ] || die "--secrets n'a de sens qu'avec --donnees"
ENV="$(cd "$(dirname "$0")/.." && pwd)/.env"

# Par étiquette du projet Compose : fonctionne même sans infra/.env (ou avec un .env invalide).
filtre=(--filter "label=com.docker.compose.project=$PROJET")
service() { docker ps -q "${filtre[@]}" --filter "label=com.docker.compose.service=$1"; }
volumes=()
[ $DONNEES -eq 0 ] || volumes+=("${PROJET}_postgres-data" "${PROJET}_redis-data" "${PROJET}_minio-data")
[ $CERTIFICATS -eq 0 ] || volumes+=("${PROJET}_letsencrypt")
existants=()
for v in "${volumes[@]}"; do docker volume inspect "$v" >/dev/null 2>&1 && existants+=("$v"); done

etape "À supprimer"
info "conteneurs : $(docker ps -aq "${filtre[@]}" | wc -l | tr -d ' ')"
info "images construites, cache de build inutilisé"
[ ${#existants[@]} -eq 0 ] || info "volumes : ${existants[*]}"
[ $SECRETS -eq 0 ] || [ ! -f "$ENV" ] || info "secrets : $ENV"

if [ $OUI -eq 0 ]; then
  { : </dev/tty; } 2>/dev/null || die "pas de terminal pour confirmer : ajouter --oui"
  if [ ${#existants[@]} -gt 0 ] || [ $SECRETS -eq 1 ]; then
    read -r -p "    Suppression définitive. Taper « $PROJET » pour confirmer : " rep </dev/tty
    [ "$rep" = "$PROJET" ] || die "abandon"
  else
    read -r -p "    Continuer ? [o/N] " rep </dev/tty
    [[ $rep =~ ^[oOyY] ]] || die "abandon"
  fi
fi

if [ $DONNEES -eq 1 ] && [ $SAUVEGARDE -eq 1 ]; then
  etape "Sauvegarde"
  pg=$(service postgres)
  if [ -n "$pg" ] && [ "$(docker exec "$pg" psql -U postgres -d postgres -tAqc \
    "SELECT 1 FROM pg_database WHERE datname = 'wasafili'")" = 1 ] &&
    [ "$(docker exec "$pg" psql -U postgres -d wasafili -tAqc \
      "SELECT to_regclass('public.instances') IS NOT NULL")" = t ]; then
    bk=$(service backup)
    [ -n "$bk" ] || die "service backup arrêté : impossible de sauvegarder (--sans-sauvegarde pour passer outre)"
    docker exec "$bk" backup.sh || die "sauvegarde échouée : rien n'a été supprimé"
  else
    info "aucune donnée déployée : rien à sauvegarder"
  fi
fi

etape "Conteneurs et réseaux"
ids=$(docker ps -aq "${filtre[@]}")
if [ -n "$ids" ]; then
  # shellcheck disable=SC2086
  docker stop -t 30 $ids >/dev/null && docker rm -f $ids >/dev/null
fi
docker network ls -q "${filtre[@]}" | xargs -r docker network rm >/dev/null
info "retirés"

etape "Images et cache"
# Images construites par la pile : wasafili/api, wasafili-web, wasafili-worker, wasafili-backup.
docker images -q --filter "reference=$PROJET/*" --filter "reference=$PROJET-*" | sort -u |
  xargs -r docker rmi -f >/dev/null
docker image prune -f >/dev/null
docker builder prune -f >/dev/null
info "retirés"

if [ ${#existants[@]} -gt 0 ]; then
  etape "Volumes"
  docker volume rm "${existants[@]}" >/dev/null
  info "supprimés : ${existants[*]}"
fi
if [ $SECRETS -eq 1 ] && [ -f "$ENV" ]; then
  rm -f "$ENV"
  info "supprimé : $ENV (recréé par deployer.sh)"
fi

etape "Terminé"
docker system df
info "Redéployer : sudo infra/deploy/deployer.sh"
