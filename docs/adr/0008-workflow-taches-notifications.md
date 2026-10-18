# ADR 0008 — Workflow, tâches et notifications

- Statut : accepté (Phase 4)
- Décisions liées : D1, D9 de [TASKS.md](../../TASKS.md) ; ADR [0003](0003-conditions-calculs.md), [0007](0007-stockage-local-synchronisation.md)

## Contexte

Une fiche suit un workflow (Brouillon → Soumis → Validé / Rejeté) dont les transitions sont
des boutons d'enregistrement, sur le web comme sur le mobile hors ligne. Les techniciens
reçoivent des tâches planifiées au back-office et sont prévenus des changements qui les
concernent. Ce qui se passe hors ligne doit rester cohérent avec ce que le serveur accepte.

## Décision

### Workflow

1. **Défini dans la version de structure**, comme les champs : une fiche reste liée au
   workflow de sa version. Les fiches antérieures à l'ajout d'un workflow restent sans état.
2. **Une seule évaluation, dans `form-engine`** : `availableTransitions` (boutons proposés
   selon l'état et les rôles) et `checkTransition` (état de départ, rôle, données). La
   visibilité et la lecture seule par état et par rôle étaient déjà évaluées par le moteur.
3. **Données vérifiées dans l'état courant**, celui où l'utilisateur les a saisies, et non
   dans l'état cible : un champ visible seulement après la transition ne peut pas la bloquer.
   Les champs exigés par une transition doivent en plus être renseignés. Ce sont des champs
   racines porteurs de valeur, car exiger une colonne de tableau serait ambigu.
4. **API** : `POST /{app}/submissions/{id}/transition` et mutation de synchronisation
   `transition`, rejouable par `clientMutationId`. La transition enregistre aussi les
   modifications fournies, sous le même verrou de ligne que les modifications (D9). Une
   seule révision `transition` porte les champs modifiés et le changement d'état, sous le
   pseudo-champ `$state`.
5. **L'historique des révisions sert de journal d'événements.** Les automatisations de la
   Phase 5 (« changement d'état », « champ modifié ») le liront ; pas de bus d'événements
   tant qu'aucun consommateur n'existe.
6. **Hors ligne** : l'état cible s'affiche aussitôt. L'état local est la cible de la
   dernière transition en attente, sinon l'état serveur. Si le serveur refuse (fiche passée
   entre-temps à un autre état, rôle retiré…), la réponse explique pourquoi
   (`409 invalid_state` : « La fiche est à l'état « Validé » : « Soumettre » n'est plus
   possible »). La fiche revient à l'état serveur et l'erreur s'affiche dans l'écran
   Synchronisation.

### Tâches

7. Une tâche est assignée **à un utilisateur ou à un groupe**, jamais aux deux. Elle porte
   un créneau, une échéance facultative, un lieu et des valeurs de pré-remplissage de la fiche.
   `task:manage` voit et planifie tout ; `task:read` ne voit que ses tâches.
8. **Synchronisation** : toute tâche modifiée est renvoyée au pull. Celles qui ne sont pas,
   ou plus, assignées à l'appelant partent comme _tombstones_ : une réassignation retire la
   tâche de l'ancien appareil. Seuls les identifiants fuient, pas le contenu.
9. **Clôture par la fiche** : une création portant `taskId` clôt la tâche dans la même
   transaction. Si la tâche a disparu, été annulée, est déjà close ou n'est pas visible par
   l'appelant, la fiche est **enregistrée quand même**, sans lien : une saisie faite hors
   ligne n'est jamais perdue. Sur l'appareil, la tâche apparaît close dès la saisie et se
   rouvre si la fiche est abandonnée.

### Notifications (D1)

10. Une notification est une ligne de base de données, écrite **dans la transaction de
    l'événement** : assignation d'une tâche, changement d'état d'une fiche dont on est
    l'auteur. L'auteur de l'action n'est pas notifié. Elle arrive sur le mobile **par la
    synchronisation**, qui fait foi.
11. **Le push Expo n'est qu'un relais**, envoyé par le worker après validation de la
    transaction et désactivable par configuration (`PUSH_ENABLED`, faux par défaut).
    L'utilisateur peut aussi le couper pour son appareil, ce qui supprime le jeton. Un jeton
    refusé par Expo (`DeviceNotRegistered`) est supprimé. Une panne d'Expo ne perd aucune
    notification.
12. Dépendance ajoutée : `@xyflow/react` (React Flow) pour l'éditeur visuel. C'est le choix
    prévu au plan (P4.2) ; il ne sert qu'au back-office.

## Conséquences et limites connues

- **Changements de groupe** : un utilisateur retiré d'un groupe garde les tâches du groupe sur
  son appareil jusqu'à la prochaine modification de ces tâches.
- **État « lu » des notifications** : il reste sur l'appareil mobile et n'est pas renvoyé au
  serveur. La cloche du back-office a son propre état « lu », côté serveur.
- **Push** : il faut un `projectId` EAS, donc un build de l'application. Expo Go sur Android
  ne reçoit plus de push. Sans projet configuré, l'enregistrement échoue proprement et le
  centre de notifications fonctionne seul.
- **Migrations Prisma** : les index `*_sync` sur `xid8` ne sont pas déclarables dans le schéma.
  Une migration générée propose de les supprimer : retirer ces `DROP INDEX`, et appliquer
  avec `prisma migrate deploy` (non interactif).
