# Déploiement de Wasafili en production

Procédure pas à pas pour mettre en service la plateforme (serveur : back-office, API, worker)
puis diffuser l'application mobile aux agents de terrain. Sauvegardes, supervision et variante
Tailscale : [docs/exploitation.md](exploitation.md).

Ordre à respecter : **le serveur d'abord**, l'application mobile ensuite (elle a besoin de
l'adresse du serveur). À chaque nouvelle version, même ordre : serveur mis à jour, puis
application.

---

## Partie 1 — Serveur

Toute la plateforme tourne en conteneurs Docker sur une seule machine :

| Service             | Rôle                                                                |
| ------------------- | ------------------------------------------------------------------- |
| `traefik`           | entrée HTTPS (ports 80/443), certificats Let's Encrypt automatiques |
| `web`               | back-office (nginx) ; relaie `/v1/` vers l'API et sert `/tiles/`    |
| `api`               | API REST                                                            |
| `worker`            | tâches de fond : e-mails, webhooks, notifications push, miniatures  |
| `migrate`           | applique les migrations de base au démarrage, puis s'arrête         |
| `postgres`, `redis` | base de données, files d'attente                                    |
| `minio`             | stockage des photos et fichiers (domaine dédié, URL signées)        |
| `gotenberg`         | conversion des rapports en PDF                                      |
| `backup`            | sauvegarde quotidienne vérifiée par restauration                    |

### 1.1 Prérequis

- Un serveur Linux avec Docker Engine et le plugin Compose (`docker compose version`).
- Ports **80** et **443** ouverts depuis Internet (Let's Encrypt en a besoin).
- **Deux noms DNS** (enregistrements A/AAAA) pointant vers le serveur, par exemple :
  - `wasafili.exemple.ci` : back-office et API ;
  - `fichiers.wasafili.exemple.ci` : stockage des photos et fichiers.
- Un **relais SMTP** (invitations, mot de passe oublié, rapports par e-mail).
- Un accès au dépôt Git (`https://github.com/archeveck/wasafili.git`).,

Serveur hébergé dans des locaux (box Internet, adresse IP qui change) ou sans nom de
domaine : voir [§ 1.10](#110-variante--serveur-à-adresse-ip-dynamique-ddns-no-ip).

**`TLS handshake timeout` alors que `curl` passe** (Docker, `fetch-basemap.sh`) : certains
réseaux perdent le premier message TLS des programmes Go récents, allongé par l'échange de
clés post-quantique. `fetch-basemap.sh` le désactive déjà ; pour Docker, à la fois pour le
client (`docker compose` obtient lui-même les jetons de Docker Hub) et pour le démon :

```bash
echo 'GODEBUG=tlsmlkem=0' | sudo tee -a /etc/environment   # sessions suivantes
export GODEBUG=tlsmlkem=0                                   # session en cours
sudo mkdir -p /etc/systemd/system/docker.service.d
printf '[Service]\nEnvironment="GODEBUG=tlsmlkem=0"\n' | sudo tee /etc/systemd/system/docker.service.d/tls.conf
sudo systemctl daemon-reload && sudo systemctl restart docker
```

### 1.2 Récupérer le code

```bash
git clone https://github.com/archeveck/wasafili.git /srv/wasafili
cd /srv/wasafili
git checkout main          # ou une étiquette de version, par exemple v1.0.0
```

Déployer une version validée (branche `main` ou étiquette), jamais une branche de travail.

### 1.3 Configurer les secrets

Créer `infra/.env` (jamais versionné ; droits `600`), secrets générés directement. Les
secrets sont en hexadécimal : deux mots de passe entrent dans une URL PostgreSQL, où `/`, `+`
ou `=` (sortie de `openssl rand -base64`) la rendraient invalide.

```bash
umask 077
cat > infra/.env <<EOF
APP_DOMAIN=wasafili.exemple.ci
FILES_DOMAIN=fichiers.wasafili.exemple.ci
ACME_EMAIL=exploitation@exemple.ci

JWT_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 32)
WASAFILI_OWNER_PASSWORD=$(openssl rand -hex 32)
WASAFILI_APP_PASSWORD=$(openssl rand -hex 32)
MINIO_ROOT_USER=wasafili
MINIO_ROOT_PASSWORD=$(openssl rand -hex 32)

SMTP_URL=smtps://utilisateur:motdepasse@smtp.exemple.ci:465
MAIL_FROM=Wasafili <no-reply@exemple.ci>

# Facultatif
METRICS_TOKEN=$(openssl rand -hex 32)
BACKUP_DIR=/srv/wasafili-sauvegardes
EOF
```

Puis remplacer dans `infra/.env` les domaines, l'e-mail ACME et le relais SMTP (`nano
infra/.env`), et vérifier que Docker Compose lit le fichier :

```bash
docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml config --quiet
```

Un mot de passe du relais SMTP contenant `@`, `:` ou `/` s'écrit encodé dans `SMTP_URL`
(`%40`, `%3A`, `%2F`).

Conserver une copie de ce fichier dans un coffre-fort de mots de passe : sans lui, les
sauvegardes de la base restent lisibles, mais les jetons et accès doivent être recréés.

### 1.4 Fond de carte (recommandé)

Les cartes du back-office et le mode hors ligne de l'application mobile utilisent un fond
OpenStreetMap hébergé sur le serveur. Le télécharger une fois (Côte d'Ivoire par défaut) :

```bash
infra/maps/fetch-basemap.sh
# autre zone : BASEMAP_BBOX=ouest,sud,est,nord infra/maps/fetch-basemap.sh
```

Les fichiers sont produits dans `infra/maps/data/` et servis sous `/tiles/`. Sans eux, les
cartes s'affichent sur un fond neutre.

Le script relance l'extraction jusqu'à trois fois en cas de coupure réseau. Si le serveur ne
joint pas `build.protomaps.com` (erreur `TLS handshake timeout` persistante, pare-feu sortant),
produire les fichiers depuis un poste qui y accède puis les copier :

```bash
infra/maps/fetch-basemap.sh                      # sur le poste
scp infra/maps/data/basemap*.pmtiles serveur:/srv/wasafili/infra/maps/data/
```

### 1.5 Démarrer

```bash
docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml up -d --build
```

Le premier démarrage construit les images, applique les migrations (`migrate`), puis lance
l'API, le worker et le back-office. Traefik obtient les certificats au premier accès HTTPS.

Pour un premier essai sans consommer le quota Let's Encrypt, ajouter dans `infra/.env` :
`ACME_CA_SERVER=https://acme-staging-v02.api.letsencrypt.org/directory` (certificat non
reconnu par les navigateurs), puis retirer la ligne et redémarrer `traefik`.

### 1.6 Créer la première instance et son administrateur

La production ne contient aucune donnée de démonstration. Créer l'instance du client :

```bash
docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml run --rm \
  -e BOOTSTRAP_INSTANCE_SHORT=sodeci \
  -e BOOTSTRAP_INSTANCE_NAME="SODECI Abidjan" \
  -e BOOTSTRAP_ADMIN_EMAIL=admin@sodeci.ci \
  -e BOOTSTRAP_ADMIN_FIRST_NAME=Awa -e BOOTSTRAP_ADMIN_LAST_NAME=Koné \
  migrate pnpm db:bootstrap
```

- `BOOTSTRAP_INSTANCE_SHORT` : identifiant de l'instance dans les URL (minuscules, chiffres,
  tirets).
- Le mot de passe initial est affiché **une seule fois** : le transmettre à l'administrateur,
  qui le change depuis le back-office (menu utilisateur).
- La commande peut être relancée sans risque : elle n'écrase ni l'instance ni un compte.

Les autres utilisateurs sont ensuite invités depuis le back-office (Équipe).

### 1.7 Vérifier la mise en service

```bash
# Tous les services « running » ou « healthy » (migrate : « exited (0) »)
docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml ps

# Disponibilité : base, Redis, stockage, conversion PDF
curl -s https://wasafili.exemple.ci/health
```

Puis, dans un navigateur :

1. Ouvrir `https://wasafili.exemple.ci`, se connecter avec le compte administrateur.
2. Changer le mot de passe initial.
3. Tester l'envoi d'e-mails : « Mot de passe oublié » sur l'écran de connexion, ou inviter
   un utilisateur.
4. Créer un formulaire, saisir une fiche avec une photo : vérifie le stockage
   (`fichiers.…`).

### 1.8 Sauvegardes

Le service `backup` sauvegarde chaque jour à 02:30 UTC dans `BACKUP_DIR` et vérifie chaque
archive en la restaurant. **Copier `BACKUP_DIR` hors du serveur** (autre machine, stockage
objet) : une sauvegarde sur le même disque ne protège pas d'une panne du serveur.
Restauration et détails : [exploitation.md §3](exploitation.md#3-sauvegardes-et-restauration).

### 1.9 Mettre à jour le serveur

```bash
cd /srv/wasafili
COMPOSE="docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml"

# 1. Sauvegarde immédiate et vérifiée
$COMPOSE exec backup backup.sh && $COMPOSE exec backup verify.sh

# 2. Nouvelle version
git fetch --tags && git checkout v1.1.0          # ou : git pull sur main

# 3. Reconstruction et redémarrage (migrations appliquées automatiquement avant l'API)
$COMPOSE up -d --build

# 4. Vérification
$COMPOSE ps && curl -s https://wasafili.exemple.ci/health
```

Les migrations ne se défont pas. En cas de problème après une mise à jour, **revenir à la
version précédente du code et restaurer la sauvegarde de l'étape 1** :

```bash
git checkout v1.0.0
$COMPOSE stop api worker web
$COMPOSE exec backup restore.sh --yes            # dernière archive
$COMPOSE up -d --build
```

### 1.10 Variante : serveur à adresse IP dynamique (DDNS No-IP)

Pour un serveur installé dans les locaux du client, derrière une box Internet dont l'adresse
publique change. Le service No-IP tient deux noms à jour avec l'adresse courante ; le reste
de la procédure (§ 1.2 à 1.9) est inchangé.

#### Vérifier d'abord que la box est joignable depuis Internet

Comparer l'adresse « WAN » affichée dans l'interface de la box avec celle que voit Internet
(`curl -4 https://ifconfig.me` depuis le serveur) :

- **identiques** : la variante convient ;
- **différentes** (souvent `100.64.x.x` à `100.127.x.x`, `10.x.x.x`) : la box est derrière
  le NAT de l'opérateur (fréquent sur les box 4G/5G). Aucune redirection de port ne
  fonctionnera : demander une IP publique à l'opérateur, ou passer par Tailscale
  ([exploitation.md § 2](exploitation.md#variante--accès-privé-par-tailscale)) ou un VPS.

Certains opérateurs bloquent aussi les ports 80 et 443 entrants : le vérifier au § 1.10.4.

#### 1.10.1 Créer les noms No-IP

Sur [noip.com](https://www.noip.com), créer **deux noms d'hôte** (enregistrements A),
par exemple :

| Nom                          | Variable       | Usage                       |
| ---------------------------- | -------------- | --------------------------- |
| `wasafili.ddns.net`          | `APP_DOMAIN`   | back-office et API          |
| `wasafili-fichiers.ddns.net` | `FILES_DOMAIN` | stockage (photos, fichiers) |

L'offre gratuite ne permet pas de sous-domaine d'un nom (`fichiers.wasafili.ddns.net`) :
créer deux noms distincts. Elle impose aussi de **confirmer chaque nom tous les 30 jours**
(e-mail de No-IP) : un nom non confirmé est supprimé et le service devient injoignable.
En production, prendre une offre payante ou, mieux, utiliser un domaine à soi (encadré
ci-dessous).

Dans **Dynamic DNS → DDNS Keys**, créer une clé et y rattacher les deux noms : elle donne
un identifiant et un mot de passe propres à la mise à jour (pas ceux du compte No-IP).

> **Avec un domaine à soi** (recommandé) : garder un seul nom No-IP (`wasafili.ddns.net`)
> et créer chez le registraire du domaine deux enregistrements **CNAME** vers lui :
> `wasafili.exemple.ci` et `fichiers.wasafili.exemple.ci`. No-IP ne sert plus qu'à suivre
> l'adresse IP ; `APP_DOMAIN` et `FILES_DOMAIN` restent les noms du domaine, et les
> utilisateurs ne voient jamais `ddns.net`. Un CNAME n'est pas possible sur le domaine nu
> (`exemple.ci`) : utiliser des sous-domaines.

#### 1.10.2 Tenir l'adresse à jour

Une seule des deux méthodes :

- **Par la box** (le plus simple) : la plupart des box et routeurs ont un menu « DNS
  dynamique » / « DynDNS » avec No-IP comme fournisseur. Y saisir l'identifiant et le mot de
  passe de la clé DDNS et l'un des noms (la clé met à jour tous ceux qui lui sont rattachés).
- **Par le serveur** : installer le client officiel No-IP (DUC 3, paquet `.deb` téléchargé
  sur [noip.com/download?page=linux](https://www.noip.com/download?page=linux)) :

  ```bash
  sudo apt install ./noip-duc_3.*_amd64.deb      # arm64 : noip-duc_3.*_arm64.deb
  noip-duc -g all.ddnskey.com -u '<identifiant de la clé>' -p '<mot de passe de la clé>'
  ```

  `all.ddnskey.com` met à jour tous les noms rattachés à la clé ; le client vérifie
  l'adresse toutes les 5 minutes. Le lancer comme service au démarrage (unité systemd
  fournie dans l'archive, voir sa documentation) et vérifier `noip-duc --help` pour la
  version installée.

Lors d'un changement d'adresse, le service est injoignable quelques minutes (détection,
puis propagation DNS). L'application mobile, hors ligne par conception, synchronise au
retour ; le back-office affiche une erreur réseau le temps de la bascule.

#### 1.10.3 Configurer la box

1. Donner au serveur une **adresse locale fixe** (réservation DHCP dans la box, par
   exemple `192.168.1.10`).
2. **Rediriger les ports TCP 80 et 443** de la box vers cette adresse (menu « NAT / PAT »,
   « Redirection de ports » ou « Serveur virtuel »). Aucun autre port : base, Redis et
   stockage restent internes au serveur.
3. Si l'interface d'administration de la box écoute sur le port 443 ou 80 depuis
   Internet, la désactiver ou la déplacer : elle prendrait la place de Wasafili.

#### 1.10.4 Configurer et démarrer

Dans `infra/.env` (§ 1.3), mettre les noms No-IP (ou ceux du domaine à soi) :

```ini
APP_DOMAIN=wasafili.ddns.net
FILES_DOMAIN=wasafili-fichiers.ddns.net
```

Puis démarrer comme au § 1.5. Let's Encrypt valide chaque nom en se connectant au port 443
de la box : un échec de certificat au premier accès signale en général une redirection de
port absente ou un port bloqué par l'opérateur (`docker compose … logs traefik`). Faire le
premier essai avec `ACME_CA_SERVER` (staging, § 1.5) pour ne pas épuiser le quota.

Vérifier **depuis l'extérieur** (téléphone en 4G, Wi-Fi coupé) :
`https://wasafili.ddns.net/health`.

#### 1.10.5 Accès depuis le réseau local

Beaucoup de box ne savent pas renvoyer vers le réseau local une connexion à leur propre
adresse publique (« NAT loopback » ou « hairpinning ») : depuis le Wi-Fi des locaux,
`https://wasafili.ddns.net` ne répond pas, alors qu'il fonctionne en 4G. Le vérifier avec un
téléphone sur le Wi-Fi. Si c'est le cas :

- activer l'option dans la box si elle existe (« NAT loopback », « hairpin ») ;
- sinon, faire résoudre les deux noms vers l'adresse locale du serveur sur le réseau local
  (DNS local de la box, ou serveur DNS interne : `wasafili.ddns.net → 192.168.1.10`).

Ne pas utiliser l'adresse locale (`https://192.168.1.10`) dans l'application ou le
navigateur : le certificat et les URL signées des fichiers portent les noms de domaine.

#### 1.10.6 Points d'attention

- **Disponibilité** : coupures de courant et d'Internet arrêtent le service. Onduleur pour
  le serveur et la box ; Docker redémarre les conteneurs au retour du courant.
- **Sauvegardes** : copier `BACKUP_DIR` hors des locaux (§ 1.8) est ici indispensable
  (vol, incendie, panne de disque).
- **Application mobile** : fixer `EXPO_PUBLIC_API_URL` sur le nom public
  (`https://wasafili.ddns.net` ou le domaine à soi), jamais sur l'adresse IP.
- **Changement de nom** : un nouveau `APP_DOMAIN` impose de reconfigurer les appareils
  (réglage « Serveur… ») ou de reconstruire l'application. Choisir le nom définitif avant
  la mise en service ; le domaine à soi permet de changer de fournisseur DDNS sans toucher
  aux appareils.

---

## Partie 2 — Application mobile

L'application est construite avec Expo. Elle fonctionne hors ligne et se synchronise avec
le serveur de la partie 1.

**Adresse du serveur** : l'application la prend, dans cet ordre, dans le réglage
« Serveur… » de l'écran de connexion (choisi par l'utilisateur), sinon dans la variable
`EXPO_PUBLIC_API_URL` fixée **au moment du build**. Fixer cette variable évite aux agents
de la saisir.

Trois variantes s'installent côte à côte sur un même appareil (variable `APP_VARIANT`) :

| Variante      | Usage                    | Identifiant                | Nom affiché     |
| ------------- | ------------------------ | -------------------------- | --------------- |
| `production`  | stores, parc d'appareils | `com.wasafili.app`         | Wasafili        |
| `preview`     | test interne             | `com.wasafili.app.preview` | Wasafili (test) |
| `development` | client de développement  | `com.wasafili.app.dev`     | Wasafili (dev)  |

### 2.1 Avant chaque build de production

1. Le serveur de production est déployé et à jour (partie 1).
2. Augmenter la version dans `apps/mobile/app.json` : `expo.version` (affichée, par exemple
   `0.2.0`). Les stores exigent aussi un numéro de build croissant : géré automatiquement
   par EAS (option A) ; sinon, ajouter `android.versionCode` et `ios.buildNumber` dans
   `app.json` et les augmenter à chaque envoi (option B).
3. Préparer le dépôt :

   ```bash
   pnpm install
   pnpm --filter "@wasafili/mobile^..." build     # paquets partagés utilisés par l'app
   ```

Deux façons de construire : **A. EAS** (service Expo, le plus simple ; signatures gérées
pour vous) ou **B. outils natifs** (Gradle, Xcode ; aucun compte Expo).

### 2.2 Option A — avec EAS (recommandé)

Prérequis : un compte Expo, `npm install -g eas-cli`, puis `eas login`. Pour les stores :
un compte Google Play Console et un compte Apple Developer.

```bash
cd apps/mobile

# Une seule fois : lie le projet à EAS (ajoute extra.eas.projectId, requis pour le push)
eas init

# Adresse du serveur, figée dans les builds de production
eas env:create --name EXPO_PUBLIC_API_URL --value https://wasafili.exemple.ci \
  --environment production

# Build de test interne : APK Android installable directement, iOS ad hoc
eas build --profile preview --platform android

# Builds stores (AAB Android, IPA iOS), numéro de build incrémenté par EAS
eas build --profile production --platform all

# Envoi vers Google Play (piste interne) et App Store Connect (TestFlight)
eas submit --platform all
```

Au premier build, EAS propose de générer et conserver le keystore Android et les
certificats Apple : accepter.

**Notifications push** : elles passent par le service push d'Expo et exigent le projet EAS
(`eas init`). Pour Android, ajouter la clé de compte de service Firebase (FCM) dans les
identifiants du projet (`eas credentials`) ; pour iOS, EAS crée la clé APNs. Sans push,
l'application fonctionne : les notifications arrivent à la synchronisation.

### 2.3 Option B — sans compte Expo (Gradle et Xcode)

Les projets natifs `android/` et `ios/` sont **générés** par `expo prebuild` (non
versionnés). Toute modification faite à la main y est perdue au prochain
`expo prebuild --clean`.

#### Android (APK ou AAB)

Prérequis : JDK 17, Android SDK (Android Studio), Node 24.

1. **Créer la clé de signature** (une seule fois ; la conserver avec son mot de passe dans
   un coffre-fort : sans elle, plus aucune mise à jour possible sur le Play Store) :

   ```bash
   keytool -genkeypair -v -storetype PKCS12 -keystore wasafili-release.keystore \
     -alias wasafili -keyalg RSA -keysize 2048 -validity 10000
   ```

2. **Générer le projet natif** :

   ```bash
   cd apps/mobile
   export APP_VARIANT=production
   export EXPO_PUBLIC_API_URL=https://wasafili.exemple.ci
   npx expo prebuild --platform android
   ```

3. **Brancher la signature** : copier le keystore dans `android/app/`, puis dans
   `android/app/build.gradle`, ajouter dans `signingConfigs` :

   ```groovy
   release {
       storeFile file('wasafili-release.keystore')
       storePassword System.getenv('WASAFILI_KEYSTORE_PASSWORD')
       keyAlias 'wasafili'
       keyPassword System.getenv('WASAFILI_KEY_PASSWORD')
   }
   ```

   et, dans `buildTypes { release { … } }`, remplacer `signingConfig signingConfigs.debug`
   par `signingConfig signingConfigs.release`. (Par défaut, le build « release » est signé
   avec la clé de débogage : utilisable pour un essai, refusé par le Play Store.)

4. **Compiler** (dans le même terminal : `EXPO_PUBLIC_API_URL` est intégrée à ce moment) :

   ```bash
   cd android
   export WASAFILI_KEYSTORE_PASSWORD=… WASAFILI_KEY_PASSWORD=…
   ./gradlew assembleRelease    # APK : app/build/outputs/apk/release/app-release.apk
   ./gradlew bundleRelease      # AAB pour le Play Store : app/build/outputs/bundle/release/
   ```

5. **Diffuser** :
   - **APK** : installation directe sur les appareils (MDM, lien de téléchargement, câble ;
     autoriser « sources inconnues ») ;
   - **AAB** : Google Play Console → piste de test interne, puis production.

#### iOS

Prérequis : un Mac avec Xcode, CocoaPods, un compte Apple Developer (99 USD/an).

```bash
cd apps/mobile
export APP_VARIANT=production
export EXPO_PUBLIC_API_URL=https://wasafili.exemple.ci
npx expo prebuild --platform ios
open ios/*.xcworkspace
```

Dans Xcode :

1. Cible de l'application → **Signing & Capabilities** : choisir l'équipe Apple
   (signature automatique) ; vérifier l'identifiant `com.wasafili.app` et la capacité
   **Push Notifications**.
2. Choisir l'appareil **Any iOS Device (arm64)**, puis **Product → Archive**.
3. Dans l'organiseur : **Distribute App** → **App Store Connect** (TestFlight, puis
   publication) ou **Ad Hoc** (appareils enregistrés).

Lancer le build depuis un terminal où `EXPO_PUBLIC_API_URL` est définie, ou ouvrir Xcode
depuis ce terminal (`open …` ci-dessus) pour qu'elle soit prise en compte.

#### Builds de la CI

À chaque push sur `main`, la CI GitHub compile l'application Android et iOS (variante
`preview`). L'APK Android est téléchargeable dans l'onglet **Actions** du dépôt (artefact
`wasafili-android-preview`) : signé avec la clé de débogage et sans adresse de serveur
fixée, il sert aux tests internes, pas à la diffusion.

### 2.4 Mise en service sur les appareils

Pour chaque agent de terrain :

1. Installer l'application (store, TestFlight, APK ou MDM).
2. Si l'adresse n'a pas été fixée au build : écran de connexion → **Serveur…** →
   `https://wasafili.exemple.ci`.
3. Se connecter avec le compte reçu par invitation, choisir l'instance.
4. Laisser la **première synchronisation** se terminer en Wi-Fi : formulaires, fiches,
   listes, puis fond de carte hors ligne (environ 45 Mo, téléchargé seul en Wi-Fi ; sinon
   écran **Synchronisation** → « Télécharger le fond de carte »).
5. Accepter les autorisations : caméra (photos, QR codes), localisation, notifications.

### 2.5 Mettre à jour l'application

1. Mettre à jour le serveur d'abord (§ 1.9).
2. Augmenter la version (§ 2.1), reconstruire (option A ou B), diffuser par le même canal.
3. Les fiches saisies hors ligne et non encore envoyées sont conservées lors d'une mise à
   jour de l'application. **Ne pas désinstaller** l'application pour la réinstaller : la
   base locale, et donc les fiches non synchronisées, serait perdue.

---

## Récapitulatif

| Étape                          | Commande / lieu                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| Configurer                     | `infra/.env`                                                                                |
| Fond de carte                  | `infra/maps/fetch-basemap.sh`                                                               |
| Démarrer / mettre à jour       | `docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml up -d --build` |
| Première instance              | `… run --rm -e BOOTSTRAP_… migrate pnpm db:bootstrap`                                       |
| Santé                          | `https://<APP_DOMAIN>/health`                                                               |
| App mobile (EAS)               | `eas build --profile production --platform all && eas submit --platform all`                |
| App mobile (Android sans Expo) | `expo prebuild` → signature → `./gradlew bundleRelease`                                     |
| App mobile (iOS sans Expo)     | `expo prebuild` → Xcode → Archive                                                           |
