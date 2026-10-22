#!/usr/bin/env bash
# Déploiement du serveur de bout en bout (docs/deploiement.md, partie 1), sur le serveur, en
# root. Relançable : sert à la première installation comme aux mises à jour.
#
#   sudo infra/deploy/deployer.sh                   # branche main
#   sudo infra/deploy/deployer.sh --ref v1.1.0      # étiquette de version
#   curl -fsSL https://raw.githubusercontent.com/archeveck/wasafili/main/infra/deploy/deployer.sh \
#     | sudo bash                                   # serveur vierge (clone dans /srv/wasafili)
#
# Étapes : prérequis → code → infra/.env (créé au premier passage, secrets générés) → fond de
# carte → sauvegarde (mise à jour) → rôles PostgreSQL → construction et démarrage (migrations)
# → première instance → vérification.
#
# Sans terminal (cloud-init, CI), les réponses viennent de l'environnement : APP_DOMAIN,
# FILES_DOMAIN, ACME_EMAIL, SMTP_URL, MAIL_FROM au premier passage ; BOOTSTRAP_INSTANCE_SHORT,
# BOOTSTRAP_INSTANCE_NAME, BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_FIRST_NAME,
# BOOTSTRAP_ADMIN_LAST_NAME (et BOOTSTRAP_ADMIN_PASSWORD, facultatif) pour la première instance.
set -euo pipefail

REPO=${WASAFILI_REPO:-https://github.com/archeveck/wasafili.git}
# Lancé depuis un dépôt : ce dépôt ; par curl : /srv/wasafili.
ici=$(cd "$(dirname "${BASH_SOURCE[0]:-.}")/../.." 2>/dev/null && pwd || true)
[ -f "$ici/infra/deploy/deployer.sh" ] && [ -d "$ici/.git" ] || ici=/srv/wasafili
DIR=${WASAFILI_DIR:-$ici}
REF=${WASAFILI_REF:-main}
CARTE=1
SAUVEGARDE=1
ARGS=("$@")

usage() {
  sed -n '2,17p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'
  cat <<'EOF'

Options :
  --ref REF            branche ou étiquette à déployer (défaut : main)
  --dir DIR            dépôt sur le serveur (défaut : celui du script, sinon /srv/wasafili)
  --sans-carte         ne pas télécharger le fond de carte
  --sans-sauvegarde    pas de sauvegarde avant une mise à jour
EOF
}

while [ $# -gt 0 ]; do
  case $1 in
    --ref) REF=${2:?--ref REF}; shift ;;
    --dir) DIR=${2:?--dir DIR}; shift ;;
    --sans-carte) CARTE=0 ;;
    --sans-sauvegarde) SAUVEGARDE=0 ;;
    -h | --help) usage; exit 0 ;;
    *) echo "Option inconnue : $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

etape() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '\033[33m    attention : %s\033[0m\n' "$*" >&2; }
die() { printf '\033[31merreur : %s\033[0m\n' "$*" >&2; exit 1; }
tty() { { : </dev/tty; } 2>/dev/null; }

# ask VAR "question" [défaut] : valeur de l'environnement, sinon question, sinon défaut.
ask() {
  local var=$1 question=$2 defaut=${3:-} rep=
  if [ -n "${!var:-}" ]; then printf '%s' "${!var}"; return; fi
  if tty; then
    read -r -p "    $question${defaut:+ [$defaut]} : " rep </dev/tty
  elif [ -z "$defaut" ]; then
    die "$var requis (pas de terminal pour le demander)"
  fi
  rep=${rep:-$defaut}
  [ -n "$rep" ] || die "$var requis"
  printf '%s' "$rep"
}

confirm() { tty && { read -r -p "    $1 [o/N] " rep </dev/tty; [[ $rep =~ ^[oOyY] ]]; }; }

[ "$(id -u)" -eq 0 ] || die "à lancer en root : sudo $0"

# ---------------------------------------------------------------------------------------------
etape "Prérequis"
manquants=()
for cmd in git openssl curl; do command -v $cmd >/dev/null || manquants+=("$cmd"); done
if [ ${#manquants[@]} -gt 0 ]; then
  command -v apt-get >/dev/null || die "à installer : ${manquants[*]}"
  info "installation : ${manquants[*]}"
  apt-get update -qq && apt-get install -y -qq "${manquants[@]}" >/dev/null
fi
if ! command -v docker >/dev/null; then
  confirm "Docker absent : l'installer (script officiel get.docker.com) ?" ||
    die "installer Docker Engine et le plugin Compose (docs.docker.com/engine/install)"
  curl -fsSL https://get.docker.com | sh
fi
docker info >/dev/null 2>&1 || die "le démon Docker ne répond pas (systemctl status docker)"
compose_v=$(docker compose version --short 2>/dev/null | sed 's/^v//') ||
  die "plugin Docker Compose absent (paquet docker-compose-plugin)"
# `!reset` et `!override` de docker-compose.prod.yml : Compose 2.24.4 au moins.
[ "$(printf '%s\n' 2.24.4 "$compose_v" | sort -V | head -1)" = 2.24.4 ] ||
  die "Docker Compose $compose_v trop ancien (2.24.4 au moins)"
info "Docker $(docker version -f '{{.Server.Version}}'), Compose $compose_v"

# ---------------------------------------------------------------------------------------------
etape "Code ($REF)"
if [ ! -d "$DIR/.git" ]; then
  [ ! -e "$DIR" ] || [ -z "$(ls -A "$DIR")" ] || die "$DIR existe et n'est pas un dépôt Git"
  git clone -q "$REPO" "$DIR"
fi
cd "$DIR"
[ -z "$(git status --porcelain --untracked-files=no)" ] ||
  die "modifications locales dans $DIR (git status) : les committer ailleurs ou les annuler"
git fetch -q --tags --prune origin
if git show-ref -q --verify "refs/remotes/origin/$REF"; then
  git checkout -q "$REF" && git merge -q --ff-only "origin/$REF"
elif git show-ref -q --verify "refs/tags/$REF"; then
  git checkout -q --detach "refs/tags/$REF"
else
  die "ni branche ni étiquette « $REF » sur origin"
fi
info "$(git log -1 --format='%h %s (%cs)')"

# La suite vient de la version déployée du script (mise à jour ou lancement par curl).
if [ -z "${WASAFILI_DEPLOYER_REEXEC:-}" ]; then
  WASAFILI_DEPLOYER_REEXEC=1 WASAFILI_DIR=$DIR WASAFILI_REF=$REF \
    exec bash "$DIR/infra/deploy/deployer.sh" "${ARGS[@]}"
fi

dc() { docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml "$@"; }
val() { grep "^$1=" infra/.env | tail -1 | cut -d= -f2-; }
sql() { dc exec -T postgres psql -U postgres -d "$1" -tAqc "$2"; }

# ---------------------------------------------------------------------------------------------
etape "Configuration (infra/.env)"
if [ ! -f infra/.env ]; then
  info "premier passage : création, secrets générés (hexadécimal, voir docs/deploiement.md § 1.3)"
  app=$(ask APP_DOMAIN "Nom du back-office et de l'API (ex. wasafili.exemple.ci)")
  files=$(ask FILES_DOMAIN "Nom du stockage des fichiers" "fichiers.$app")
  acme=$(ask ACME_EMAIL "E-mail pour Let's Encrypt")
  info "relais SMTP : smtps://utilisateur:motdepasse@smtp.exemple.ci:465"
  info "(dans le mot de passe, @ : / s'écrivent %40 %3A %2F)"
  smtp=$(ask SMTP_URL "Relais SMTP")
  from=$(ask MAIL_FROM "Expéditeur des e-mails" "Wasafili <no-reply@$app>")
  s() { openssl rand -hex 32; }
  ( umask 077
    cat >infra/.env <<EOF
APP_DOMAIN=$app
FILES_DOMAIN=$files
ACME_EMAIL=$acme

JWT_SECRET=$(s)
POSTGRES_PASSWORD=$(s)
WASAFILI_OWNER_PASSWORD=$(s)
WASAFILI_APP_PASSWORD=$(s)
MINIO_ROOT_USER=wasafili
MINIO_ROOT_PASSWORD=$(s)

SMTP_URL=$smtp
MAIL_FROM=$from

# Facultatif
METRICS_TOKEN=$(s)
# TLS_CLASSIC_KEY_EXCHANGE=1   # si « TLS handshake timeout » (docs/deploiement.md § 1.1)
# ACME_CA_SERVER=https://acme-staging-v02.api.letsencrypt.org/directory   # essai (§ 1.5)
BACKUP_DIR=/srv/wasafili-sauvegardes
EOF
  )
  info "créé ; en garder une copie dans un coffre-fort de mots de passe"
else
  info "existant, conservé"
fi
chmod 600 infra/.env
for v in APP_DOMAIN FILES_DOMAIN ACME_EMAIL JWT_SECRET POSTGRES_PASSWORD WASAFILI_OWNER_PASSWORD \
  WASAFILI_APP_PASSWORD MINIO_ROOT_USER MINIO_ROOT_PASSWORD SMTP_URL MAIL_FROM; do
  [ -n "$(val $v)" ] || die "$v vide dans infra/.env"
done
! grep -qE '^(APP_DOMAIN|FILES_DOMAIN|ACME_EMAIL|SMTP_URL|MAIL_FROM)=.*exemple\.ci' infra/.env ||
  die "valeurs d'exemple (exemple.ci) dans infra/.env : les remplacer"
dc config --quiet || die "infra/.env refusé par Docker Compose"
APP_DOMAIN=$(val APP_DOMAIN)

# Avertissements seulement : DNS et ports se corrigent sans relancer le script.
ip=$(curl -4 -fsS --max-time 5 https://ifconfig.me 2>/dev/null || true)
for d in "$APP_DOMAIN" "$(val FILES_DOMAIN)"; do
  r=$(getent ahostsv4 "$d" | awk 'NR==1{print $1}')
  if [ -z "$r" ]; then warn "$d ne se résout pas (DNS)"
  elif [ -n "$ip" ] && [ "$r" != "$ip" ]; then
    warn "$d → $r, adresse publique du serveur : $ip (box : redirection de ports, § 1.10)"
  fi
done
if command -v ss >/dev/null; then
  for p in 80 443; do
    occupe=$(ss -Hltnp "sport = :$p" 2>/dev/null | grep -v docker-proxy || true)
    [ -z "$occupe" ] || warn "port $p déjà pris : $occupe"
  done
fi
backup_dir=$(val BACKUP_DIR)
[ -z "$backup_dir" ] || mkdir -p "$backup_dir"

# ---------------------------------------------------------------------------------------------
etape "Fond de carte"
if [ $CARTE -eq 0 ]; then
  info "ignoré (--sans-carte)"
elif [ ! -f infra/maps/data/basemap.pmtiles ]; then
  infra/maps/fetch-basemap.sh ||
    warn "fond de carte non téléchargé : cartes sur fond neutre ; relancer infra/maps/fetch-basemap.sh (§ 1.4)"
elif [ ! -f infra/maps/data/basemap-mobile.pmtiles ]; then
  infra/maps/fetch-basemap.sh --mobile-only || warn "extraction mobile échouée"
else
  info "présent (infra/maps/data/)"
fi

# ---------------------------------------------------------------------------------------------
etape "Sauvegarde avant mise à jour"
if [ $SAUVEGARDE -eq 0 ]; then
  info "ignorée (--sans-sauvegarde)"
elif [ -n "$(dc ps -q --status running backup postgres 2>/dev/null | sed -n 2p)" ] &&
  [ "$(sql postgres "SELECT 1 FROM pg_database WHERE datname = 'wasafili'")" = 1 ] &&
  [ "$(sql wasafili "SELECT to_regclass('public.instances') IS NOT NULL")" = t ]; then
  { dc exec -T backup backup.sh && dc exec -T backup verify.sh; } ||
    die "sauvegarde échouée : rien n'a été modifié (--sans-sauvegarde pour passer outre)"
else
  info "aucune donnée déployée : rien à sauvegarder"
fi

# ---------------------------------------------------------------------------------------------
etape "Base de données"
dc up -d --wait postgres
# Crée rôles et bases s'ils manquent, aligne les mots de passe sur infra/.env.
dc exec -T postgres sh /docker-entrypoint-initdb.d/01-roles.sh
info "rôles et bases à jour"

# ---------------------------------------------------------------------------------------------
etape "Construction et démarrage (migrations comprises)"
# `web` attend une API saine : un retour sans erreur vaut démarrage complet.
if ! dc up -d --build --remove-orphans; then
  dc ps -a
  for s in migrate api worker; do
    printf '\n--- %s ---\n' "$s"
    dc logs --no-log-prefix --tail 40 "$s" 2>/dev/null || true
  done
  die "démarrage incomplet (journaux ci-dessus)"
fi

# ---------------------------------------------------------------------------------------------
etape "Première instance"
if [ "$(sql wasafili 'SELECT count(*) FROM instances')" != 0 ]; then
  info "déjà créée : $(sql wasafili "SELECT string_agg(short, ', ') FROM instances")"
elif [ -z "${BOOTSTRAP_INSTANCE_SHORT:-}" ] && ! tty; then
  warn "aucune instance : BOOTSTRAP_* absents, voir docs/deploiement.md § 1.6"
elif [ -z "${BOOTSTRAP_INSTANCE_SHORT:-}" ] && ! confirm "Aucune instance : la créer maintenant ?"; then
  info "plus tard : relancer ce script, ou docs/deploiement.md § 1.6"
else
  BOOTSTRAP_INSTANCE_SHORT=$(ask BOOTSTRAP_INSTANCE_SHORT "Identifiant (minuscules, chiffres, tirets ; ex. sodeci)")
  BOOTSTRAP_INSTANCE_NAME=$(ask BOOTSTRAP_INSTANCE_NAME "Nom de l'instance (ex. SODECI Abidjan)")
  BOOTSTRAP_ADMIN_EMAIL=$(ask BOOTSTRAP_ADMIN_EMAIL "E-mail de l'administrateur")
  BOOTSTRAP_ADMIN_FIRST_NAME=$(ask BOOTSTRAP_ADMIN_FIRST_NAME "Prénom")
  BOOTSTRAP_ADMIN_LAST_NAME=$(ask BOOTSTRAP_ADMIN_LAST_NAME "Nom")
  export BOOTSTRAP_INSTANCE_SHORT BOOTSTRAP_INSTANCE_NAME BOOTSTRAP_ADMIN_EMAIL \
    BOOTSTRAP_ADMIN_FIRST_NAME BOOTSTRAP_ADMIN_LAST_NAME
  opt=()
  [ -z "${BOOTSTRAP_ADMIN_PASSWORD:-}" ] || opt=(-e BOOTSTRAP_ADMIN_PASSWORD)
  dc run --rm --no-deps -e BOOTSTRAP_INSTANCE_SHORT -e BOOTSTRAP_INSTANCE_NAME \
    -e BOOTSTRAP_ADMIN_EMAIL -e BOOTSTRAP_ADMIN_FIRST_NAME -e BOOTSTRAP_ADMIN_LAST_NAME \
    "${opt[@]}" migrate pnpm db:bootstrap
  info "mot de passe initial affiché une seule fois ci-dessus : le transmettre à l'administrateur"
fi

# ---------------------------------------------------------------------------------------------
etape "Vérification"
dc ps
# Le certificat Let's Encrypt est obtenu au premier accès HTTPS : quelques essais.
sante=
for _ in $(seq 12); do
  sante=$(curl -fsS --max-time 10 "https://$APP_DOMAIN/health" 2>/dev/null) && break
  sante=
  sleep 10
done
if [ -n "$sante" ]; then
  info "https://$APP_DOMAIN/health : $sante"
else
  warn "https://$APP_DOMAIN/health ne répond pas : vérifier DNS, ports 80/443 et certificat"
  info "journaux : docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml logs traefik"
fi

etape "Terminé"
info "Back-office : https://$APP_DOMAIN"
info "À faire : se connecter et changer le mot de passe initial, tester un e-mail (§ 1.7),"
info "copier ${backup_dir:-infra/backups} hors du serveur (§ 1.8), puis l'application mobile (partie 2)."
