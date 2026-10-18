import { describe, expect, it } from 'vitest';
import { buildDataSchema, type Field, fieldValueSchema, inspectionEquipement } from './index.js';

const definition = inspectionEquipement({ listId: 'l' });
const schema = buildDataSchema(definition);
const fileId = '0b6f3f7e-1a7b-4c1e-9f55-6f1f2d3a4b5c';

describe('schéma dynamique des données', () => {
  it('accepte des données valides, partielles ou nulles', () => {
    expect(
      schema.safeParse({
        site: 'id-site',
        date_inspection: '2026-10-18',
        etat: 'degrade',
        photos: [{ fileId, annotatedFileId: fileId }],
        position: { lat: 5.35, lng: -4.0, accuracy: 8, source: 'gps' },
        pieces: [{ _id: 'r1', reference: 'P-1', quantite: 2, prix_unitaire: 1500, montant: 3000 }],
        signature: { fileId },
        cree_le: '2026-10-18T09:00:00Z',
        description_defaut: null,
      }).success,
    ).toBe(true);
    expect(schema.safeParse({}).success).toBe(true);
  });

  it('refuse les clés inconnues, y compris dans les lignes', () => {
    expect(schema.safeParse({ inconnu: 1 }).success).toBe(false);
    expect(schema.safeParse({ pieces: [{ _id: 'r', intrus: 1 }] }).success).toBe(false);
    expect(schema.safeParse({ pieces: [{ reference: 'sans id' }] }).success).toBe(false);
  });

  it('contrôle la forme de chaque type', () => {
    for (const [key, value] of [
      ['date_inspection', '18/10/2026'],
      ['photos', [{ fileId: 'pas-un-uuid' }]],
      ['position', { lat: 95, lng: 0, source: 'gps' }],
      ['cree_le', '2026-10-18'],
      ['etat', 3],
    ] as const) {
      expect(schema.safeParse({ [key]: value }).success, key).toBe(false);
    }
  });

  it.each([
    [{ type: 'text' }, 'a', 1],
    [{ type: 'textarea' }, 'a', 1],
    [{ type: 'email' }, 'a@b.ci', 1],
    [{ type: 'phone' }, '+225', 1],
    [{ type: 'barcode' }, 'X', 1],
    [{ type: 'number' }, 1.5, Number.POSITIVE_INFINITY],
    [{ type: 'rating' }, 3, '3'],
    [{ type: 'slider', min: 0, max: 1 }, 1, '1'],
    [{ type: 'time' }, '08:30', '25:00'],
    [{ type: 'datetime' }, '2026-10-18T08:30:00+00:00', '2026-10-18'],
    [{ type: 'boolean' }, false, 'false'],
    [{ type: 'multiselect', options: [{ value: 'a', label: 'A' }] }, ['a'], 'a'],
    [{ type: 'relation', structureId: 's' }, 'id', ['id']],
    [{ type: 'relation', structureId: 's', multiple: true }, ['id'], 'id'],
    [{ type: 'user' }, 'u', 2],
    [{ type: 'file' }, [{ fileId }], { fileId }],
    [{ type: 'calculated', formula: '1', resultType: 'number' }, 2, {}],
    [{ type: 'hidden' }, true, []],
  ])('valeur de %o', (partial, valid, invalid) => {
    const field = { id: 'x', key: 'x', label: 'X', ...partial } as Field;
    const valueSchema = fieldValueSchema(field)!;
    expect(valueSchema.safeParse(valid).success).toBe(true);
    expect(valueSchema.safeParse(invalid).success).toBe(false);
  });

  it('n a pas de valeur pour les sections et textes informatifs', () => {
    expect(fieldValueSchema({ id: 's', key: 's', type: 'section', label: 'S', fields: [] })).toBe(
      undefined,
    );
    expect(fieldValueSchema({ id: 'i', key: 'i', type: 'info', label: 'I', content: '' })).toBe(
      undefined,
    );
  });

  it('ignore les textes informatifs dans les lignes de tableau', () => {
    const table = {
      id: 't',
      key: 't',
      type: 'table',
      label: 'T',
      fields: [
        { id: 'i', key: 'i', type: 'info', label: 'I', content: 'aide' },
        { id: 'c', key: 'c', type: 'text', label: 'C' },
      ],
    } as Field;
    const rows = fieldValueSchema(table)!;
    expect(rows.safeParse([{ _id: '1', c: 'ok' }]).success).toBe(true);
    expect(rows.safeParse([{ _id: '1', i: 'x' }]).success).toBe(false);
  });
});
