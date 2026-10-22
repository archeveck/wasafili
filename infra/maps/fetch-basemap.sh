#!/usr/bin/env sh
# Fond de carte auto-hébergé (P6.1, ADR 0010) : extrait une zone du build OpenStreetMap
# quotidien de Protomaps au format PMTiles, servi ensuite sous /tiles/ par le back-office.
#
#   infra/maps/fetch-basemap.sh                 # Côte d'Ivoire, zoom 0–14
#   BASEMAP_BBOX=2.2,6.2,3.9,12.5 BASEMAP_MAXZOOM=12 infra/maps/fetch-basemap.sh
#   infra/maps/fetch-basemap.sh --mobile-only   # seulement l'extraction mobile, depuis le fichier local
#
# Deux fichiers : basemap.pmtiles (back-office) et basemap-mobile.pmtiles, extraction allégée
# (zoom ≤ BASEMAP_MOBILE_MAXZOOM, 13 par défaut : ≈ 45 Mo) que l'application télécharge pour
# l'usage hors ligne (P3.4.5) ; MapLibre agrandit les tuiles au-delà de ce zoom.
#
# Données © contributeurs OpenStreetMap (ODbL), attribution affichée sur la carte.
set -eu

BBOX="${BASEMAP_BBOX:--8.7,4.2,-2.4,10.8}"
MAXZOOM="${BASEMAP_MAXZOOM:-14}"
MOBILE_MAXZOOM="${BASEMAP_MOBILE_MAXZOOM:-13}"
BUILD="${BASEMAP_BUILD:-$(date -u -v-1d +%Y%m%d 2>/dev/null || date -u -d yesterday +%Y%m%d)}"
PMTILES_VERSION="1.31.2"

DIR=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$DIR/data" "$DIR/.bin"

PMTILES=$(command -v pmtiles || true)
if [ -z "$PMTILES" ]; then
  PMTILES="$DIR/.bin/pmtiles"
  if [ ! -x "$PMTILES" ]; then
    case "$(uname -s)-$(uname -m)" in
      # Empreintes SHA-256 publiées avec la version ${PMTILES_VERSION}.
      Darwin-arm64)
        ASSET="go-pmtiles-${PMTILES_VERSION}_Darwin_arm64.zip"
        EXPECTED=40528f7f616fcbf91207cd48c8fc023d213f6d86c0cbf1f748732803d1880f3d ;;
      Darwin-x86_64)
        ASSET="go-pmtiles-${PMTILES_VERSION}_Darwin_x86_64.zip"
        EXPECTED=1f0dc02eee6c58312dd6c509faee1b5c32f0596568af1bf51f1b034e7a88a65b ;;
      Linux-x86_64)
        ASSET="go-pmtiles_${PMTILES_VERSION}_Linux_x86_64.tar.gz"
        EXPECTED=3ed7dbf4ec2e6dfe5e25b6f70d1ffc932729f93c86db353bf514dd71010a312f ;;
      Linux-aarch64 | Linux-arm64)
        ASSET="go-pmtiles_${PMTILES_VERSION}_Linux_arm64.tar.gz"
        EXPECTED=f8bd47e7ea866863489cad588fbaf2f31f42e5821f7a03f009b3769f05801cb1 ;;
      *) echo "Plateforme non prise en charge : installez pmtiles (github.com/protomaps/go-pmtiles)" >&2; exit 1 ;;
    esac
    BASE="https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_VERSION}"
    TMP=$(mktemp -d)
    trap 'rm -rf "$TMP"' EXIT
    echo "Téléchargement de pmtiles ${PMTILES_VERSION}…"
    curl -fsSL -o "$TMP/$ASSET" "$BASE/$ASSET"
    ACTUAL=$( (sha256sum "$TMP/$ASSET" 2>/dev/null || shasum -a 256 "$TMP/$ASSET") | cut -d' ' -f1)
    if [ "$EXPECTED" != "$ACTUAL" ]; then
      echo "Somme de contrôle invalide pour $ASSET" >&2
      exit 1
    fi
    case "$ASSET" in
      *.zip) unzip -q -o "$TMP/$ASSET" pmtiles -d "$TMP" ;;
      *) tar -xzf "$TMP/$ASSET" -C "$TMP" pmtiles ;;
    esac
    mv "$TMP/pmtiles" "$PMTILES"
    chmod +x "$PMTILES"
  fi
fi

OUT="$DIR/data/basemap.pmtiles"
MOBILE="$DIR/data/basemap-mobile.pmtiles"
if [ "${1:-}" != "--mobile-only" ]; then
  echo "Extraction du build ${BUILD} (zone ${BBOX}, zoom ≤ ${MAXZOOM}) vers ${OUT}…"
  # Des centaines de requêtes par plage d'octets : une coupure réseau (délai TLS, connexion
  # réinitialisée) fait échouer toute l'extraction, d'où quelques nouvelles tentatives.
  # tlsmlkem=0 : sans l'échange de clés post-quantique (défaut de Go ≥ 1.24), le ClientHello
  # tient dans un seul paquet ; certains réseaux perdent la version longue (TLS handshake
  # timeout alors que curl passe). Sans enjeu ici : données publiques, TLS classique conservé.
  ATTEMPT=1
  until GODEBUG="${GODEBUG:+$GODEBUG,}tlsmlkem=0" "$PMTILES" extract "https://build.protomaps.com/$BUILD.pmtiles" "$OUT.part" \
    --bbox="$BBOX" --maxzoom="$MAXZOOM"; do
    rm -f "$OUT.part"
    if [ "$ATTEMPT" -ge 4 ]; then
      echo "Extraction impossible après $ATTEMPT tentatives : vérifier l'accès HTTPS à build.protomaps.com" >&2
      echo "(curl -I https://build.protomaps.com/$BUILD.pmtiles) ou produire le fichier ailleurs (docs/deploiement.md §1.4)." >&2
      exit 1
    fi
    echo "Échec de la tentative $ATTEMPT, nouvel essai dans $((ATTEMPT * 15)) s…" >&2
    sleep $((ATTEMPT * 15))
    ATTEMPT=$((ATTEMPT + 1))
  done
  mv "$OUT.part" "$OUT"
  echo "Fond de carte prêt : $(du -h "$OUT" | cut -f1)"
fi
[ -f "$OUT" ] || { echo "Fond de carte absent : lancer d'abord sans --mobile-only" >&2; exit 1; }
"$PMTILES" extract "$OUT" "$MOBILE.part" --maxzoom="$MOBILE_MAXZOOM"
mv "$MOBILE.part" "$MOBILE"
echo "Fond de carte mobile prêt : $(du -h "$MOBILE" | cut -f1)"
