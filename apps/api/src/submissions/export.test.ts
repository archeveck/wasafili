import { type Field, inspectionEquipement } from '@tesserax/form-schema';
import { describe, expect, it } from 'vitest';
import { exportColumns, formatCell, referencedIds } from './export';

const labels = { items: new Map([['i1', 'Plateau']]), users: new Map([['u1', 'awa@ci']]) };
const field = (partial: Record<string, unknown>) =>
  ({ id: 'x', key: 'x', label: 'X', ...partial }) as Field;
const options = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Bêta' },
];

describe('formatCell', () => {
  it.each([
    [{ type: 'select', options }, 'a', 'Alpha'],
    [{ type: 'select', options }, 'z', 'z'],
    [{ type: 'multiselect', options }, ['a', 'b', 'z'], 'Alpha, Bêta, z'],
    [{ type: 'list', listId: 'l' }, 'i1', 'Plateau'],
    [{ type: 'list', listId: 'l' }, 'i9', 'i9'],
    [{ type: 'user', multiple: true }, ['u1', 'u2'], 'awa@ci, u2'],
    [{ type: 'author' }, 'u1', 'awa@ci'],
    [{ type: 'boolean' }, true, 'Oui'],
    [{ type: 'boolean' }, false, 'Non'],
    [{ type: 'geolocation' }, { lat: 5.3, lng: -4, source: 'gps' }, '5.3, -4'],
    [{ type: 'photo' }, [{}, {}], '2'],
    [{ type: 'signature' }, { fileId: 'f' }, 'Signée'],
    [{ type: 'calculated', formula: '1', resultType: 'boolean' }, false, 'Non'],
    [{ type: 'calculated', formula: '1', resultType: 'number' }, 12, '12'],
    [{ type: 'number' }, 3.5, '3.5'],
    [{ type: 'text' }, null, ''],
  ])('%o / %j → %s', (partial, value, expected) => {
    expect(formatCell(field(partial), value, labels)).toBe(expected);
  });
});

describe('colonnes et références', () => {
  it('exporte les champs racine et collecte les identifiants à résoudre', () => {
    const fields = exportColumns(inspectionEquipement({ listId: 'l' }));
    expect(fields.map((f) => f.key)).toContain('total_pieces');
    expect(
      referencedIds(fields, [
        { site: 's1', batiment: null, inspecteur: 'u1' },
        { site: 's1', equipement: 'e1' },
      ]),
    ).toEqual({ items: ['s1', 'e1'], users: ['u1'] });
  });
});
