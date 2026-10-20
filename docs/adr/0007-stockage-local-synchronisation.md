# ADR 0007 — Stockage local et protocole de synchronisation hors ligne

- Statut : accepté (Phase 3)
- Décisions liées : D8, D9, D10 de [TASKS.md](../../TASKS.md)

## Contexte

Les techniciens saisissent sur des chantiers sans réseau. Critère : 10 fiches avec photos en
mode avion, puis tout se synchronise **sans doublon ni perte**. La sync est maison (conflits par champ).

## Décision

### Serveur

- **Curseur par identifiant de transaction** plutôt que par date : chaque écriture renseigne
  `sync_txid = pg_current_xact_id()` (`xid8`, trigger). Le pull lit `sync_txid >= plancher`, où
  le plancher est le `xmin` du snapshot au début de la passe précédente. Une transaction encore
  en cours pendant un pull a forcément un `sync_txid ≥ xmin` : elle est renvoyée à la passe
  suivante. Un curseur `updated_at` la perdrait (horodatage pris au début de la transaction,
  visible seulement à la validation). Prix à payer : quelques lignes renvoyées en double, que le
  client absorbe car il applique les lignes reçues sans effet en double.
- Pagination par `(sync_txid, id)`, curseur opaque (base64url). Tombstones : fiches supprimées
  et éléments archivés. Formulaires : liste complète à chaque pull (petite), définitions des
  versions modifiées et des versions des fiches reçues.
- **Push** : lot de mutations rejouables (`create`, `update`, `delete`), appliquées dans
  l'ordre avec les mêmes règles que l'API (droits, validation, champs serveur). Résultat par
  mutation : `applied`, `duplicate` ou `rejected`. Une erreur serveur interrompt le lot ; le
  client le renvoie, sans effet en double grâce à `client_mutation_id`.
- **Conflits (D9)** : écritures sérialisées par `SELECT … FOR UPDATE`. Une mise à jour porte
  ses seuls champs modifiés et sa `baseRevision` ; un champ également modifié depuis cette
  révision est un conflit : la dernière écriture reçue gagne, la valeur écrasée est conservée
  (`SubmissionConflict`) et visible dans le back-office, qui permet de la rétablir.
- **Historique hors ligne** (spécification §1.4) : chaque fiche reçue porte ses 20 dernières
  révisions (`history`, auteurs et automatisations nommés) et leur nombre (`historyTotal`).
  Toute écriture crée une révision **et** modifie la fiche, qui revient donc au pull suivant :
  ni ressource ni curseur de plus, et les droits de lecture sont ceux de la fiche.
- **Perte de droits** : le curseur porte une empreinte (SHA-256) de ce que l'appelant peut
  lire — conditions de lecture par formulaire (règles, filtres de visibilité, attributs),
  référentiels, groupes (tâches). Si elle diffère, le pull repart de zéro avec `reset: true` :
  rôle changé, règle restreinte, groupe quitté ou attribut modifié retirent les données de
  l'appareil dès la synchronisation suivante, sans liste de suppressions à calculer. Un curseur
  sans empreinte (antérieur) provoque une synchronisation complète, une seule fois.
- API sans ETag : aucune réponse 304 servie depuis un cache sur la synchronisation.

### Client (`packages/sync`)

- **SQLite derrière une interface synchrone minimale** (`exec`, `run`, `all`, `get`,
  `transaction`), implémentée par `expo-sqlite` sur mobile et `node:sqlite` dans les tests :
  toute la logique est testée sans téléphone, avec le même moteur SQLite (FTS5 compris).
- **Écart par rapport à D8 : pas de Drizzle.** Ses migrations nécessitent sous Expo un plugin
  Babel d'import de fichiers SQL. Des migrations SQL versionnées (`PRAGMA user_version`), jamais
  modifiées et seulement ajoutées, suffisent pour une dizaine de tables.
- Fiche locale = copie serveur (`server_data`, base des mutations) + vue locale (`local_data`).
  Au pull, les modifications encore en attente sont **réappliquées** par-dessus l'état serveur
  (rebasage) : elles ne sont jamais écrasées.
- Historique dans `submission_history`, à part des fiches (les listes ne le chargent pas) ; un
  résultat de push, qui n'en porte pas, garde celui du dernier pull. La migration qui l'a
  introduit efface le curseur : une synchronisation complète, unique, récupère l'historique
  des fiches déjà présentes (modifications en attente réappliquées).
- Page `reset` : dans la même transaction, le client efface ses copies serveur (fiches
  synchronisées et leur historique, tâches sans fiche en cours, éléments de référentiel) puis
  applique la page. Restent les brouillons et les fiches dont un envoi est en attente ou refusé :
  l'utilisateur garde la main, le serveur tranchera (refus expliqué s'il n'a plus le droit).
- File de mutations persistée. Une modification est fusionnée dans la précédente **seulement si
  celle-ci n'a jamais été tentée** : une mutation qui a pu atteindre le serveur n'est jamais
  modifiée, car son identifiant y est connu. Une page de pull et son curseur sont appliqués dans
  la même transaction.
- Moteur : une seule passe à la fois (envoi, fichiers, réception), backoff exponentiel (5 s à
  5 min), reprise après arrêt brutal (`sending` → `pending` au démarrage). Déclencheurs : réseau
  retrouvé, retour au premier plan, toutes les 10 minutes, bouton.
- **Fichiers (D10)** : copiés dans le dossier de l'application, envoyés indépendamment des
  fiches par URL signée (`File.upload`, session d'arrière-plan sur iOS). Une erreur 4xx est
  définitive (signalée), une erreur réseau ou 5xx est retentée.

## Vérification

- `packages/sync` : 19 tests avec un faux serveur (réseau coupé, réponse perdue après
  application, arrêt pendant l'envoi, coupure en plein upload, rebasage, refus).
- `apps/api/test/offline-sync.e2e.test.ts` : moteur réel contre l'API, PostgreSQL et MinIO
  réels. 10 fiches avec photos en mode avion, une coupure pendant un upload : 10 fiches,
  10 fichiers, aucun doublon. Plus une fusion terrain/bureau avec conflits tracés.
- `apps/api/test/sync.e2e.test.ts` : pagination, tombstones, transaction en cours pendant un
  pull, rejeu, réordonnancement, écritures concurrentes.
- Application réelle sur simulateur iOS (Maestro) : `apps/mobile/e2e/hors-ligne.sh`, serveur
  coupé, 3 fiches signées, retour du serveur, exactement +3 fiches.

## Limites

- Sur simulateur iOS, Maestro ne peut pas activer le mode avion : la coupure est simulée en
  arrêtant le serveur, ce qui emprunte le même chemin d'erreur réseau côté application.
- Une perte de droits n'est appliquée qu'à la synchronisation suivante (appareil resté hors
  ligne : les données y restent jusque-là). Une fiche dont l'envoi est refusé puis abandonné
  redevient une copie serveur, effacée au prochain changement de droits seulement.
