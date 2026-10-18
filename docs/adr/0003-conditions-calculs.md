# ADR 0003 — Conditions et calculs : un seul évaluateur json-logic

- Statut : accepté (Phase 1)
- Décision liée : D7 de [TASKS.md](../../TASKS.md)

## Contexte

Visibilité conditionnelle, requis conditionnel et champs calculés doivent donner **exactement**
le même résultat sur le serveur, le web et le mobile hors ligne (Hermes). L'administrateur
no-code doit pouvoir écrire une formule lisible sans connaître json-logic.

## Décision

1. **Évaluateur unique : `json-logic-js`** (pur JS, aucune dépendance), dans
   `packages/form-engine`, sans dépendance Node ni DOM (vérifié sur le build).
2. **Conditions** (`visibleIf`, `requiredIf`) stockées en json-logic, produites par l'éditeur
   visuel (P2.3.3). Variables : clés des champs, `$row.<colonne>` (ligne courante d'un tableau),
   `$state`, `$user.id`, `$user.roles`, `$today`, `$now`.
3. **Formules** stockées en **texte lisible** (`{prix} * {quantite}`, `SOMME({lignes.montant})`,
   `SI({etat} = "bon"; 0; 1)`), compilées en json-logic par un petit parseur maison
   ([formula/](../../packages/form-engine/src/formula/)) à la construction du moteur.
   - Écart assumé par rapport à D7, qui prévoyait de stocker la version compilée : garder la
     seule source texte évite deux représentations à synchroniser. La compilation est
     déterministe, rapide et identique partout. `analyzeDefinition` la vérifie à l'enregistrement.
   - Fonctions en français, avec alias anglais : `SI`, `ET`, `OU`, `NON`, `SOMME`, `MOYENNE`,
     `MIN`, `MAX`, `NB`/`NB_LIGNES`, `ARRONDI`, `ABS`, `CONCAT`, `VIDE`, `DANS`, `JOURS_ENTRE`,
     `AJOUTER_JOURS`, `AUJOURDHUI`, `MAINTENANT`, `UTILISATEUR`, `ETAT`. Séparateur `;` ou `,`.
4. **Opérations ajoutées** à json-logic : `empty`, `in_list`, `pluck`, `sum`, `avg`, `min_of`,
   `max_of`, `count`, `round`, `abs`, `concat`, `days_between`, `add_days`. Les opérateurs à
   portée locale (`map`, `filter`, `reduce`, `all`, `some`, `none`) et `log` sont refusés à
   l'analyse : ils changent le sens de `var`.
5. **Clés uniques sur toute la structure**, colonnes de tableaux comprises : `{x}` dans une
   formule de colonne désigne la colonne de la ligne courante si elle appartient au même tableau,
   sinon un champ racine. Une colonne lue hors de son tableau doit passer par un agrégat.
6. **Graphe de dépendances** : tri topologique des champs calculés (racine et colonnes). Les
   cycles sont détectés et signalés, et leurs champs valent `null`. Le recalcul incrémental
   (`changed`) ne refait que les calculs qui dépendent des clés modifiées.
7. **Déterminisme** : l'horloge (`now`) et le fuseau (`Africa/Abidjan` par défaut) sont passés
   dans le contexte. Un calcul dont une entrée manque, ou qui divise par zéro, vaut `null`.
8. Un champ masqué n'est ni requis ni validé. Ses données sont conservées (fusion hors ligne).
   Les erreurs de validation sont des **codes** avec paramètres (`min`, `pattern`…), traduits
   par l'interface.

## Conséquences

- Le parseur fait partie du paquet partagé : le mobile compile les formules localement, sans
  appel réseau.
- Ajouter une fonction se fait en un seul endroit (`SPECS` + opération json-logic), avec ses tests.
  La couverture de 100 % est imposée par la configuration Vitest du paquet.
- L'enregistrement global des opérations dans `json-logic-js` est un effet de bord du module.
  Tous les consommateurs veulent les mêmes opérations, donc c'est acceptable.
