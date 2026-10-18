import { type StructureDefinition } from '../definition.js';
import { type Workflow } from '../workflow.js';

/**
 * Structure de démonstration « Inspection équipement » (P1.2.7) : référentiel en cascade
 * Site > Bâtiment > Équipement, champs conditionnels, photos, tableau répétable avec calcul
 * par ligne et total, signature. Partagée par l'API (seed), le web et le mobile.
 */
export function inspectionEquipement(options: { listId: string }): StructureDefinition {
  const { listId } = options;
  return {
    schemaVersion: 1,
    fields: [
      {
        id: 'f-identification',
        key: 'identification',
        type: 'section',
        label: 'Identification',
        fields: [
          {
            id: 'f-site',
            key: 'site',
            type: 'list',
            label: 'Site',
            listId,
            level: 0,
            required: true,
          },
          {
            id: 'f-batiment',
            key: 'batiment',
            type: 'list',
            label: 'Bâtiment',
            listId,
            level: 1,
            parentField: 'site',
            required: true,
          },
          {
            id: 'f-equipement',
            key: 'equipement',
            type: 'list',
            label: 'Équipement',
            listId,
            level: 2,
            parentField: 'batiment',
            required: true,
            filterable: true,
          },
          {
            id: 'f-date',
            key: 'date_inspection',
            type: 'date',
            label: "Date d'inspection",
            defaultNow: true,
            required: true,
            filterable: true,
          },
          { id: 'f-inspecteur', key: 'inspecteur', type: 'author', label: 'Inspecteur' },
        ],
      },
      {
        id: 'f-constat',
        key: 'constat',
        type: 'section',
        label: 'Constat',
        fields: [
          {
            id: 'f-etat',
            key: 'etat',
            type: 'select',
            label: 'État général',
            required: true,
            display: 'buttons',
            filterable: true,
            options: [
              { value: 'bon', label: 'Bon', color: '#2E8B57' },
              { value: 'degrade', label: 'Dégradé', color: '#D98A1B' },
              { value: 'hors_service', label: 'Hors service', color: '#C4372D' },
            ],
          },
          {
            id: 'f-defaut',
            key: 'description_defaut',
            type: 'textarea',
            label: 'Description du défaut',
            maxLength: 2000,
            visibleIf: { in: [{ var: 'etat' }, ['degrade', 'hors_service']] },
            requiredIf: { '==': [{ var: 'etat' }, 'hors_service'] },
          },
          {
            id: 'f-photos',
            key: 'photos',
            type: 'photo',
            label: 'Photos',
            maxCount: 5,
            quality: 0.7,
            allowAnnotation: true,
            requiredIf: { in: [{ var: 'etat' }, ['degrade', 'hors_service']] },
          },
          {
            id: 'f-position',
            key: 'position',
            type: 'geolocation',
            label: 'Position',
            allowManual: true,
          },
        ],
      },
      {
        id: 'f-pieces',
        key: 'pieces',
        type: 'table',
        label: 'Pièces à remplacer',
        visibleIf: { in: [{ var: 'etat' }, ['degrade', 'hors_service']] },
        maxRows: 20,
        fields: [
          { id: 'f-piece-ref', key: 'reference', type: 'text', label: 'Référence', required: true },
          {
            id: 'f-piece-qte',
            key: 'quantite',
            type: 'number',
            label: 'Quantité',
            min: 1,
            decimals: 0,
            defaultValue: 1,
          },
          {
            id: 'f-piece-pu',
            key: 'prix_unitaire',
            type: 'number',
            label: 'Prix unitaire',
            min: 0,
            unit: 'FCFA',
          },
          {
            id: 'f-piece-montant',
            key: 'montant',
            type: 'calculated',
            label: 'Montant',
            formula: '{quantite} * {prix_unitaire}',
            resultType: 'number',
            decimals: 0,
          },
        ],
      },
      {
        id: 'f-total',
        key: 'total_pieces',
        type: 'calculated',
        label: 'Total pièces (FCFA)',
        formula: 'SOMME({pieces.montant})',
        resultType: 'number',
        decimals: 0,
        visibleIf: { in: [{ var: 'etat' }, ['degrade', 'hors_service']] },
      },
      {
        id: 'f-signature',
        key: 'signature',
        type: 'signature',
        label: 'Signature',
        required: true,
      },
      { id: 'f-cree', key: 'cree_le', type: 'timestamp', label: 'Créée le', mode: 'created' },
    ],
  };
}

/** Workflow Brouillon → Soumis → Validé / Rejeté (démo de la Phase 4). */
export const inspectionWorkflow: Workflow = {
  states: [
    { key: 'brouillon', label: 'Brouillon', color: '#5B6470', initial: true },
    { key: 'soumis', label: 'Soumis', color: '#1F6F5C' },
    { key: 'valide', label: 'Validé', color: '#2E8B57', final: true },
    { key: 'rejete', label: 'Rejeté', color: '#C4372D' },
  ],
  transitions: [
    { key: 'soumettre', label: 'Soumettre', from: ['brouillon', 'rejete'], to: 'soumis' },
    {
      key: 'valider',
      label: 'Valider',
      from: ['soumis'],
      to: 'valide',
      roles: ['admin', 'superviseur'],
      color: '#2E8B57',
    },
    {
      key: 'rejeter',
      label: 'Rejeter',
      from: ['soumis'],
      to: 'rejete',
      roles: ['admin', 'superviseur'],
      color: '#C4372D',
      confirm: 'Rejeter cette inspection ?',
    },
  ],
};
