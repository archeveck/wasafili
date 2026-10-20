import {
  inspectionEquipement,
  inspectionWorkflow,
  type StructureDefinition,
} from '@wasafili/form-schema';
import { describe, expect, it } from 'vitest';
import { imageFileIds, reportData, sampleSubmission } from './report-data';

const definition: StructureDefinition = {
  ...inspectionEquipement({ listId: 'liste' }),
  workflow: inspectionWorkflow,
};
const labels = {
  items: new Map([['eq-1', 'Ascenseur n°1']]),
  users: new Map([['u-1', 'Awa Koné']]),
};
const context = {
  structureName: 'Inspection',
  instanceName: 'Démo',
  timeZone: 'Africa/Abidjan',
  labels,
};

describe('reportData', () => {
  const data = reportData(
    definition,
    {
      id: 'f-1',
      state: 'valide',
      authorId: 'u-1',
      createdAt: new Date('2026-10-18T08:05:00Z'),
      updatedAt: new Date('2026-10-18T09:00:00Z'),
      data: {
        equipement: 'eq-1',
        date_inspection: '2026-10-18',
        inspecteur: 'u-1',
        etat: 'degrade',
        position: { lat: 5.3, lng: -4.01, accuracy: 4.6, source: 'gps' },
        photos: [{ fileId: 'p-1', annotatedFileId: 'p-1-annotee' }, { fileId: 'p-2' }],
        pieces: [
          { _id: 'l1', reference: 'CAB', quantite: 2, prix_unitaire: 1500.5, montant: 3001 },
        ],
        total_pieces: 3001,
        signature: { fileId: 's-1' },
      },
    },
    { ...context, now: new Date('2026-10-18T10:00:00Z') },
  );

  it('rend des valeurs lisibles : libellés, dates locales, nombres français', () => {
    expect(data).toMatchObject({
      equipement: 'Ascenseur n°1',
      date_inspection: '18/10/2026',
      inspecteur: 'Awa Koné',
      etat: 'Dégradé',
      position: '5.300000, -4.010000 (± 5 m)',
      _etat: 'Validé',
      _auteur: 'Awa Koné',
      _creee_le: '18/10/2026 08:05',
      _genere_le: '18/10/2026 10:00',
      site: '',
    });
    expect(data['pieces']).toEqual([
      expect.objectContaining({
        _numero: 1,
        reference: 'CAB',
        quantite: '2',
        prix_unitaire: '1 500,5 FCFA',
        montant: '3 001',
      }),
    ]);
  });

  it('prend la version annotée des photos ; charge seulement les images du modèle', () => {
    expect(data['photos']).toEqual({ kind: 'image', fileIds: ['p-1-annotee', 'p-2'], width: 12 });
    expect(imageFileIds(data, [{ name: 'signature', kind: 'image' }])).toEqual(['s-1']);
    expect(imageFileIds(data, [{ name: 'photos', kind: 'value' }])).toEqual([]);
  });
});

describe('sampleSubmission', () => {
  it('produit une fiche d’exemple conforme à la structure', () => {
    const sample = sampleSubmission(definition, new Date('2026-10-18T10:00:00Z'));
    expect(sample.state).toBe('brouillon');
    expect(sample.data['date_inspection']).toBe('2026-10-18');
    expect(sample.data['pieces']).toHaveLength(2);
    expect(reportData(definition, sample, context)['etat']).toBe('Bon');
  });
});
