# ADR 0004 — Filtrage et tri des fiches sur les données JSONB

- Statut : accepté (Phase 1)
- Tâche liée : P1.4.3 (« index GIN + colonnes extraites pour les champs filtrables »)

## Contexte

Les données d'une fiche vivent dans une colonne `JSONB` dont la forme dépend de la version de
structure. Le back-office (P2.5) et l'API doivent filtrer et trier sur certains champs.

## Décision

1. **Index GIN `jsonb_path_ops`** sur `submissions.data`. L'égalité (`filter[cle]=v`) est
   traduite en containment `data @> {"cle": v}`, servi par cet index, avec le bon type JSON
   (texte, nombre, booléen, élément de tableau pour un choix multiple).
2. **Expressions typées** pour les comparaisons et le tri : `(data->>'cle')` pour le texte et
   les dates ISO (ordre lexicographique = chronologique), et pour les nombres
   `CASE WHEN jsonb_typeof(...) = 'number' THEN (...)::numeric END`, qui ne casse jamais sur une
   valeur inattendue. Requêtes paramétrées ; les clés sont validées contre la définition.
3. Seuls les champs marqués **`filterable`** dans la version courante sont filtrables ou triables.
   Les types sans sens pour un filtre (photo, fichier, signature, géolocalisation, tableau) sont
   exclus. Opérateurs : `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `contains`.
4. **Alternative retenue aux « colonnes extraites »** : pas de colonne ni de table annexe
   synchronisée par champ. Au volume visé (dizaines de milliers de fiches par instance,
   filtrées d'abord par `instance_id` et `structure_id`, tous deux indexés), l'index GIN et les
   expressions suffisent. Le coût d'une table de valeurs extraites (écritures doublées,
   resynchronisation à chaque nouvelle version) n'est pas justifié tant qu'aucune mesure ne le
   demande.

## Conséquences

- Si un tri ou une plage sur un champ devient lent, on ajoutera un index d'expression ciblé
  (`((data->>'cle'))` filtré par `structure_id`) par migration, ou une table de valeurs
  extraites (`submission_values`), sans changer l'API.
- Les filtres portent sur la définition de la version **courante** : un champ retiré d'une
  nouvelle version n'est plus filtrable, même si d'anciennes fiches le contiennent.
