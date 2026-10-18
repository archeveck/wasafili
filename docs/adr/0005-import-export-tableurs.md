# ADR 0005 — Import / export CSV et XLSX des référentiels

- Statut : accepté (Phase 1)
- Tâches liées : P1.5.3, P1.5.4

## Contexte

Les référentiels (Site > Bâtiment > Équipement) sont tenus dans des tableurs par les clients.
Il faut importer et exporter du CSV et du XLSX, avec prévisualisation et rapport d'erreurs.

## Décision

- **Bibliothèques** : `read-excel-file` et `write-excel-file` (XLSX), `csv-parse` et
  `csv-stringify` (CSV). Elles sont maintenues et légères : leur seule dépendance notable est
  `fflate`. **Écartées** : `exceljs`, qui n'est plus maintenu depuis 2024 et a des dépendances
  anciennes, et `xlsx` (SheetJS), qui n'est plus publié sur le registre npm.
- **Format symétrique** : pour un niveau « Site », colonnes `Site code`, `Site` et `Site.<attribut>`.
  Un export se réimporte sans aucun changement (test d'aller-retour CSV et XLSX). Une
  correspondance de colonnes explicite (`mapping`) permet d'importer un fichier client tel quel.
- **CSV** : séparateur `;` et BOM UTF-8 à l'export, pour l'ouverture directe dans Excel en
  français. À l'import, détection automatique de `;` ou `,`.
- **Planification pure** (`planImport`) puis application en une transaction : un élément est
  reconnu par son code, sinon par son libellé sous le même parent. Mode `merge` ou `replace`
  (archive les absents). `dry_run` pour prévisualiser. **Tout ou rien** : une seule ligne en
  erreur, et rien n'est écrit. Le rapport donne le numéro de ligne du fichier.
- Déplacer un élément vers un autre parent n'est pas pris en charge par l'import : c'est
  signalé comme erreur. Les éléments sont **archivés**, jamais supprimés, car des fiches les
  référencent.

## Conséquences

- Limite de 10 Mo et de 20 000 lignes par import, traité de façon synchrone. Au-delà, il faudra
  passer par un job du worker.
