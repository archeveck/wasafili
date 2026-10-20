# ADR 0012 — Carte mobile hors ligne : MapLibre et fond PMTiles sur l'appareil

- Statut : accepté (P3.4.5)
- Décisions liées : D3, D4 de [TASKS.md](../../TASKS.md) ; remplace le point 5 de
  l'ADR [0010](0010-pilotage.md)

## Contexte

D3 prévoyait MapLibre sur le web et le mobile, avec un fond Protomaps (PMTiles) préchargé sur
l'appareil, « à valider par un spike » côté MapLibre Native. La carte mobile des fiches (P6.1.3)
avait retenu `react-native-maps` pour rester dans Expo Go : son fond Apple ou Google dépend du
cache du système, donc rien n'est garanti en zone blanche, et Android exige une clé Google.
Le champ géolocalisation n'avait pas de carte (D4 : GPS et saisie suffisent).

## Décision

1. **MapLibre React Native** (`@maplibre/maplibre-react-native` 11, MapLibre Native iOS 6.31,
   Android 13.6) lit une archive PMTiles locale (`pmtiles://file://…`) : le spike de D3 est
   levé, le support est natif. Même style que le back-office (`@protomaps/basemaps`, variante
   claire, libellés en français), mêmes polices Noto ; icônes du fond absentes, comme sur le web.
2. **Extraction allégée** : `infra/maps/fetch-basemap.sh` dérive `basemap-mobile.pmtiles` du fond
   du back-office (zoom ≤ 13 par défaut, ≈ 46 Mo pour la Côte d'Ivoire ; MapLibre agrandit
   au-delà). Fichier servi sous `/tiles/` et polices sous `/maps/fonts/` par nginx, qui sert
   aussi l'API en production : l'application les trouve à l'adresse du serveur, sans réglage.
   Pas de MinIO ni d'URL signée : données publiques (OSM), déjà servies, aucun service ajouté.
3. **Préchargement** : une tentative par lancement dès qu'un réseau Wi-Fi est disponible ;
   téléchargement, mise à jour et suppression à la demande depuis l'écran « Synchronisation »
   (taille, date, progression, annulation). Le fichier est téléchargé à part, son en-tête
   vérifié, puis il remplace l'ancien : une coupure ne laisse jamais un fond corrompu.
4. **Sans fond**, les cartes affichent un fond neutre et invitent à le télécharger ; la saisie
   n'en dépend jamais (D4).
5. **Champ géolocalisation** : carte sous les coordonnées. Toucher la carte pose ou déplace le
   point (`source: 'map'`) ; la vue suit une position venue du GPS ou de la saisie. Lecture
   seule si le champ est en lecture seule ou refuse la saisie manuelle (`allowManual: false`).
6. **Carte des fiches** : regroupement natif des points (source GeoJSON en clusters), comme sur
   le web ; toucher un groupe l'agrandit, toucher un point affiche la fiche.

## Conséquences

- **Fin d'Expo Go** (le module est natif) : client de développement (`npx expo run:ios`,
  `run:android`, ou profil EAS `development`) ; `pnpm start` sert ce client. Les parcours
  Maestro visent l'application installée (`com.wasafili.app`).
- **Plus de clé Google Maps** : la variable `GOOGLE_MAPS_API_KEY` disparaît.
- Dépendances : `@maplibre/maplibre-react-native`, `@protomaps/basemaps` (mobile) ;
  `react-native-maps` retiré.
- Limites : fond figé à la date de son extraction (mise à jour manuelle sur l'appareil) ; une
  seule zone par serveur (`BASEMAP_BBOX`) ; en développement, l'API seule (`:3000`) ne sert pas
  le fond : pointer l'application sur le back-office (`http://localhost:5173`, qui relaie
  `/v1`) pour le télécharger.
