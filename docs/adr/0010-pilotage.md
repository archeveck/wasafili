# ADR 0010 — Pilotage : cartes, tableaux de bord, journal d'audit, export ZIP des photos

- Statut : accepté (Phase 6)
- Décisions liées : D11 de [TASKS.md](../../TASKS.md) ; ADR [0001](0001-multi-tenant.md),
  [0004](0004-filtrage-des-fiches.md), [0006](0006-stockage-fichiers.md)

## Contexte

Le superviseur veut voir où et quand le terrain travaille, suivre quelques indicateurs sans
exporter vers un tableur, retrouver qui a changé quoi dans l'administration, et récupérer les
photos d'une sélection de fiches. Toutes ces vues portent sur des fiches : elles doivent
respecter exactement les mêmes droits que le tableau des fiches (règles par structure, filtres
de visibilité, RLS), sans dépendance SaaS.

## Décision

### Une seule sélection de fiches

`SubmissionsService.query()` (périmètre, visibilité, filtres `filter[cle][op]`, état, période)
alimente désormais la liste, l'export tableur, la carte, les widgets et l'export ZIP. Aucune de
ces vues ne recode un filtre ou un droit ; un même tableau de bord montre à chacun les chiffres
des seules fiches qu'il peut lire.

### Cartes

1. **Point d'une fiche** : premier champ géolocalisation renseigné, sinon la position de
   l'appareil à la saisie. Même règle côté API (SQL) et mobile (base locale).
2. **Web : MapLibre GL + PMTiles auto-hébergé.** `infra/maps/fetch-basemap.sh` extrait une zone
   du build OpenStreetMap quotidien de Protomaps (Côte d'Ivoire, zoom 14 : ≈ 100 Mo) ; le
   fichier est servi sous `/tiles/` (nginx en conteneur, middleware Vite en développement,
   lecture par plages). Les polices Noto (SIL OFL) sont embarquées ; les icônes du fond ne le
   sont pas (licence distincte) et restent vides. Sans fichier, la carte fonctionne sur un fond
   neutre. MapLibre est chargé à la demande ; son worker est construit par Vite.
3. **Regroupement** natif (source GeoJSON en clusters), 10 000 points au plus par requête
   (`meta.truncated` invite à filtrer).
4. **Suivi des équipes** : dernière position connue de chaque membre, issue de la position de
   l'appareil sur ses fiches lisibles par l'appelant, ou du lieu d'une tâche terminée (avec
   `task:manage`). Une position saisie dans un champ décrit l'équipement, pas l'agent : elle
   n'est pas retenue. Pas de suivi GPS en continu (vie privée, batterie).
5. **Mobile : `react-native-maps`** (spécification), Apple Maps / Google Maps, utilisable dans
   Expo Go sans configuration. Données locales uniquement : la carte marche hors ligne, le fond
   de carte dépend du cache du système. Clé Google Maps requise pour un build Android de
   production (P7).

### Tableaux de bord

6. **Widgets typés et validés** (Zod) : indicateur (`kpi`), histogramme (`bar`, par état,
   auteur ou champ filtrable à valeur unique) ou courbe (`line`, par jour, semaine ou mois dans
   le fuseau de l'instance, périodes vides à zéro). Valeur : nombre de fiches, ou somme,
   moyenne, minimum, maximum d'un champ numérique filtrable. Période glissante, état et filtres
   de champs. 20 catégories, 400 périodes au plus.
7. **Agrégation SQL paramétrée** sur la sélection commune ; un champ non agrégeable est refusé
   (`invalid_widget`) avant toute requête. `POST /dashboards/widget-data` calcule un widget,
   enregistré ou en cours d'édition (aperçu).
8. **Graphiques en SVG/HTML, sans bibliothèque** : une série par graphique, couleur primaire
   de l'instance, vue tableau pour chaque graphique. Lecture pour tous les membres ;
   `dashboard:manage` (administrateur, superviseur) pour créer et modifier.

### Journal d'audit

9. **Table `audit_logs` en ajout seul** : la RLS n'y définit que des policies `SELECT` et
   `INSERT` ; le rôle applicatif ne peut ni modifier ni supprimer une entrée (la suppression en
   cascade d'une instance, exécutée par le propriétaire, reste possible). L'auteur est conservé
   par identifiant et libellé, sans clé étrangère, pour survivre à la suppression du compte.
10. **Déclaration sur les routes** : `@Audit('role.update')` et un intercepteur global écrivent
    l'entrée **après le succès** de l'action (une action refusée n'est pas journalisée comme
    faite), avec l'objet (paramètre de route ou `id` de la réponse), son libellé, les
    paramètres (corps ou filtres d'export) **secrets masqués** et tronqués, l'adresse IP et
    l'agent. Couverture : connexions (réussies, refusées), jetons de clés API, membres, rôles,
    groupes, droits par structure, formulaires, référentiels, rapports, automatisations,
    webhooks, paramètres, tableaux de bord, exports et téléchargements.
11. **Connexion hors instance** : une entrée par instance du compte. Un refus de connexion est
    écrit sans être attendu, pour qu'un compte existant ne se trahisse pas par une réponse
    plus lente.
12. **Écriture hors transaction métier** : un échec d'écriture du journal est consigné dans les
    logs sans annuler une action déjà validée. Accepté : l'historique des fiches, lui, est écrit
    dans la transaction de chaque écriture (D11).
13. **Historique d'une fiche** : chronologie unique des révisions (transitions comprises), des
    conflits (détection, résolution) et des automatisations exécutées sur la fiche.

### Export ZIP des photos

14. **L'API résout, le worker assemble.** L'API applique le droit d'export et la sélection,
    lit chaque fiche avec sa version de structure, trouve les photos (champs racine et
    tableaux répétables ; la version annotée s'ajoute à l'originale) et calcule les chemins.
    L'export (`photo_exports`) porte la liste des entrées ; le job `photos-zip` ne transporte
    que son identifiant.
15. **Nommage configurable** : jetons `{date}`, `{fiche}`, `{id}`, `{etat}`, `{auteur}`,
    `{champ}`, `{libelle}`, `{n}`, `{original}`, `{valeur:cle}` ; `/` crée un dossier. Chaque
    segment est assaini (ni `..`, ni séparateur, ni caractère interdit), les collisions sont
    numérotées, l'extension vient du type MIME. Un modèle invalide est refusé avec la liste
    des erreurs.
16. **Archive en flux** (`yazl`, sans dépendance, ZIP64) : chaque photo n'est demandée au
    stockage qu'au moment d'être écrite, l'archive part en envoi multipart
    (`@aws-sdk/lib-storage`), sans mémoire ni disque proportionnels à sa taille. Les photos,
    déjà compressées, sont stockées telles quelles.
17. **Téléchargement** : l'export n'est visible que de son demandeur (la sélection reflète ses
    droits) ; une URL signée de 15 minutes est émise à la demande, en pièce jointe, tant que
    l'export n'a pas expiré (7 jours). Une purge du worker (toutes les 6 heures) supprime les
    archives expirées ; la trace de l'export reste.
18. **Photos non déposées** (appareil resté hors ligne) : ignorées et comptées (`missing`).

## Conséquences

- Nouvelles dépendances : `maplibre-gl`, `pmtiles`, `@protomaps/basemaps` (web, chargées à la
  demande), `react-native-maps` (mobile), `yazl` et `@aws-sdk/lib-storage` (worker).
- Données de démonstration : tableau de bord « Suivi des inspections » au seed ;
  `node infra/demo/fiches-terrain.mjs` saisit des inspections localisées par l'API.
- Limites : pas de regroupement sur la carte mobile ; pas de rétention configurable du journal
  d'audit (P7) ; les clés API n'ont pas encore d'écran de gestion (P7.1.4), seuls leurs usages
  et refus sont journalisés ; un tableau de bord n'a qu'une série par graphique.
