import { type StructureDefinition } from '@wasafili/form-schema';
import { describe, expect, it } from 'vitest';
import { filterableFields, filterSql, orderSql, parseFilters } from './query';

const definition = {
  schemaVersion: 1,
  fields: [
    {
      id: '1',
      key: 'etat',
      type: 'select',
      label: 'É',
      filterable: true,
      options: [{ value: 'a', label: 'A' }],
    },
    { id: '2', key: 'cout', type: 'number', label: 'C', filterable: true },
    { id: '3', key: 'ok', type: 'boolean', label: 'O', filterable: true },
    {
      id: '4',
      key: 'tags',
      type: 'multiselect',
      label: 'T',
      filterable: true,
      options: [{ value: 'x', label: 'X' }],
    },
    { id: '5', key: 'photos', type: 'photo', label: 'P', filterable: true },
    { id: '6', key: 'note', type: 'text', label: 'N' },
    {
      id: '7',
      key: 'total',
      type: 'calculated',
      label: 'T',
      formula: '1',
      resultType: 'number',
      filterable: true,
    },
  ],
} as StructureDefinition;
const fields = filterableFields(definition);

describe('parseFilters', () => {
  it('lit les formes à plat et imbriquée', () => {
    expect(parseFilters({ 'filter[etat]': 'a', 'filter[cout][gte]': '10', page: '1' })).toEqual([
      { key: 'etat', operator: 'eq', value: 'a' },
      { key: 'cout', operator: 'gte', value: '10' },
    ]);
    expect(parseFilters({ filter: { etat: 'a', cout: { lt: '5' } } })).toEqual([
      { key: 'etat', operator: 'eq', value: 'a' },
      { key: 'cout', operator: 'lt', value: '5' },
    ]);
  });

  it('refuse un opérateur inconnu ou une valeur répétée', () => {
    expect(() => parseFilters({ 'filter[etat][like]': 'a' })).toThrow(
      'Opérateur de filtre inconnu',
    );
    expect(() => parseFilters({ 'filter[etat]': ['a', 'b'] })).toThrow('Valeur de filtre invalide');
  });
});

describe('filterableFields', () => {
  it('ne retient que les champs marqués filtrables et de type compatible', () => {
    expect([...fields]).toEqual([
      ['etat', 'text'],
      ['cout', 'number'],
      ['ok', 'boolean'],
      ['tags', 'array'],
      ['total', 'number'],
    ]);
    expect(filterableFields(undefined).size).toBe(0);
  });
});

describe('filterSql', () => {
  const sql = (key: string, operator: string, value: string) =>
    filterSql({ key, operator: operator as never, value }, fields);

  it('utilise le containment (index GIN) pour l égalité', () => {
    expect(sql('etat', 'eq', 'a').sql).toContain('s.data @> jsonb_build_object');
    expect(sql('cout', 'eq', '3').values).toEqual(['cout', 3]);
    expect(sql('ok', 'eq', 'true').values).toEqual(['ok', true]);
    expect(sql('tags', 'contains', 'x').sql).toContain('jsonb_build_array');
  });

  it('gère comparaisons, listes et recherche textuelle', () => {
    expect(sql('cout', 'gte', '10').sql).toContain('>=');
    expect(sql('cout', 'in', '1, 2').values).toEqual(['cout', 'cout', [1, 2]]);
    expect(sql('cout', 'ne', '1').sql).toContain('IS DISTINCT FROM');
    expect(sql('etat', 'in', 'a,b').values).toEqual(['etat', ['a', 'b']]);
    expect(sql('etat', 'ne', 'a').sql).toContain('IS DISTINCT FROM');
    expect(sql('etat', 'lt', 'm').sql).toContain('<');
    expect(sql('etat', 'contains', '50%_x').values).toEqual(['etat', '%50\\%\\_x%']);
    expect(sql('tags', 'in', 'x,y').sql).toContain('jsonb_exists_any');
    expect(sql('ok', 'ne', 'false').sql).toContain('NOT');
  });

  it('refuse les champs non filtrables et les valeurs ou opérateurs incompatibles', () => {
    expect(() => sql('note', 'eq', 'x')).toThrow('Champ non filtrable : note');
    expect(() => sql('photos', 'eq', 'x')).toThrow('Champ non filtrable');
    expect(() => sql('cout', 'gt', 'abc')).toThrow('Nombre attendu pour cout');
    expect(() => sql('cout', 'eq', ' ')).toThrow('Nombre attendu');
    expect(() => sql('ok', 'eq', 'oui')).toThrow('Booléen attendu');
    expect(() => sql('ok', 'gt', 'true')).toThrow('Opérateur gt non applicable au champ ok');
    expect(() => sql('tags', 'gt', 'x')).toThrow('non applicable');
    expect(() => sql('cout', 'contains', '1')).toThrow('non applicable');
  });
});

describe('orderSql', () => {
  it('trie par défaut du plus récent au plus ancien', () => {
    expect(orderSql(undefined, fields).sql).toBe('s.created_at DESC NULLS LAST');
    expect(orderSql('updatedAt', fields).sql).toBe('s.updated_at ASC NULLS LAST');
  });

  it('trie sur un champ filtrable, numérique ou texte', () => {
    expect(orderSql('-cout', fields).sql).toContain('::numeric');
    expect(orderSql('etat', fields).values).toEqual(['etat']);
    expect(() => orderSql('note', fields)).toThrow('Tri impossible sur : note');
    expect(() => orderSql('tags', fields)).toThrow('Tri impossible');
  });
});
