import { inspectionEquipement } from '@wasafili/form-schema';
import { describe, expect, it } from 'vitest';
import { createFormEngine } from './engine.js';
import { definition, field } from './test-utils.js';

const fileId = '0b6f3f7e-1a7b-4c1e-9f55-6f1f2d3a4b5c';

describe('validation de la fiche de démonstration', () => {
  const engine = createFormEngine(inspectionEquipement({ listId: 'l' }));
  const complete = {
    site: 's',
    batiment: 'b',
    equipement: 'e',
    date_inspection: '2026-10-18',
    etat: 'bon',
    signature: { fileId },
  };

  it('accepte une fiche complète', () => {
    expect(engine.validate(complete)).toMatchObject({ valid: true, errors: [] });
  });

  it('exige les champs requis, y compris conditionnels', () => {
    const { errors } = engine.validate({ ...complete, etat: 'hors_service', signature: null });
    expect(errors.map((e) => [e.field, e.code])).toEqual([
      ['description_defaut', 'required'],
      ['photos', 'required'],
      ['signature', 'required'],
    ]);
  });

  it('ne valide pas un champ masqué, même invalide', () => {
    expect(engine.validate({ ...complete, description_defaut: 42 }).valid).toBe(true);
  });

  it('valide les lignes de tableau et ignore les colonnes calculées', () => {
    const { errors } = engine.validate({
      ...complete,
      etat: 'degrade',
      photos: [{ fileId }],
      pieces: [
        { _id: 'a', quantite: 0, montant: 'ignoré' },
        { _id: 'b', reference: 'R', intrus: 1 },
        { reference: 'sans id' },
        'texte',
      ],
    });
    expect(errors).toEqual([
      { path: ['pieces', 0, 'reference'], field: 'reference', code: 'required' },
      { path: ['pieces', 0, 'quantite'], field: 'quantite', code: 'min', params: { min: 1 } },
      { path: ['pieces', 1, 'intrus'], field: 'intrus', code: 'unknown_field' },
      { path: ['pieces', 2], field: 'pieces', code: 'type' },
      { path: ['pieces', 3], field: 'pieces', code: 'type' },
    ]);
  });

  it('refuse les clés inconnues', () => {
    expect(engine.validate({ ...complete, intrus: 1 }).errors).toEqual([
      { path: ['intrus'], field: 'intrus', code: 'unknown_field' },
    ]);
  });
});

describe('contraintes par type', () => {
  const options = [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
  ];
  const engine = createFormEngine(
    definition([
      field('text', 'texte', {
        minLength: 2,
        maxLength: 4,
        pattern: '^[A-Z]+$',
        patternMessage: 'Majuscules',
      }),
      field('textarea', 'long', { maxLength: 3 }),
      field('barcode', 'code', { pattern: '^EQ-' }),
      field('email', 'mail'),
      field('phone', 'tel'),
      field('number', 'nombre', { min: 0, max: 10, decimals: 1 }),
      field('number', 'libre'),
      field('slider', 'curseur', { min: 0, max: 100, step: 5 }),
      field('slider', 'continu', { min: 0, max: 1 }),
      field('rating', 'note'),
      field('rating', 'note10', { max: 10 }),
      field('date', 'jour', { min: '2026-01-01', max: '2026-12-31' }),
      field('select', 'choix', { options }),
      field('multiselect', 'multi', { options, minItems: 2, maxItems: 2 }),
      field('photo', 'photos', { maxCount: 1 }),
      field('file', 'docs'),
      field('geolocation', 'pos', { maxAccuracy: 20 }),
      field('geolocation', 'pos_libre'),
      field('signature', 'sig'),
      field('table', 'lignes', { minRows: 1, maxRows: 1, fields: [field('text', 'c')] }),
      field('table', 'facultatif', { fields: [field('text', 'd')] }),
      field('calculated', 'calc', { formula: '1', resultType: 'number' }),
    ]),
  );
  const codes = (values: Record<string, unknown>) =>
    engine.validate(values).errors.map((e) => `${e.field}:${e.code}`);

  it('signale chaque contrainte non respectée', () => {
    expect(
      codes({
        texte: 'a',
        long: 'abcd',
        code: 'X',
        mail: 'pas-un-mail',
        tel: 'abc',
        nombre: 10.25,
        curseur: 101,
        note: 2.5,
        note10: 11,
        jour: '2025-12-31',
        choix: 'z',
        multi: ['a', 'z', 'b'],
        photos: [{ fileId }, { fileId }],
        pos: { lat: 1, lng: 1, source: 'gps' },
        lignes: [{ _id: '1' }, { _id: '2' }],
      }),
    ).toEqual([
      'texte:min_length',
      'texte:pattern',
      'long:max_length',
      'code:pattern',
      'mail:email',
      'tel:phone',
      'nombre:max',
      'nombre:decimals',
      'curseur:max',
      'curseur:step',
      'note:integer',
      'note10:max',
      'jour:min',
      'choix:option',
      'multi:option',
      'multi:max_items',
      'photos:max_items',
      'pos:accuracy',
      'lignes:max_rows',
    ]);
  });

  it('signale les bornes basses et les types invalides', () => {
    expect(
      codes({
        texte: 'ABCDE',
        nombre: -1,
        curseur: -5,
        note: 0,
        jour: '2027-01-01',
        multi: ['a'],
        pos: { lat: 1, lng: 1, accuracy: 50, source: 'gps' },
        sig: 'pas un fichier',
        lignes: 'pas un tableau',
      }),
    ).toEqual([
      'texte:max_length',
      'nombre:min',
      'curseur:min',
      'note:min',
      'jour:max',
      'multi:min_items',
      'pos:accuracy',
      'sig:type',
      'lignes:type',
    ]);
  });

  it('accepte des valeurs conformes', () => {
    expect(
      codes({
        texte: 'AB',
        long: 'abc',
        code: 'EQ-1',
        mail: 'a@b.ci',
        tel: '+225 07 00 00 00',
        nombre: 9.5,
        libre: 1e6,
        curseur: 55,
        continu: 0.37,
        note: 5,
        jour: '2026-06-01',
        choix: 'a',
        multi: ['a', 'b'],
        photos: [{ fileId }],
        docs: [{ fileId }, { fileId }],
        pos: { lat: 1, lng: 1, accuracy: 5, source: 'gps' },
        pos_libre: { lat: 1, lng: 1, source: 'manual' },
        sig: { fileId },
        lignes: [{ _id: '1', c: 'x' }],
        facultatif: [],
      }),
    ).toEqual([]);
  });

  it('exige au moins une ligne quand minRows > 0', () => {
    expect(codes({ lignes: [] })).toContain('lignes:required');
  });

  it('signale un nombre de lignes insuffisant', () => {
    const minimum = createFormEngine(
      definition([field('table', 't', { minRows: 2, fields: [field('text', 'c')] })]),
    );
    expect(minimum.validate({ t: [{ _id: '1' }] }).errors).toEqual([
      { path: ['t'], field: 't', code: 'min_rows', params: { min: 2 } },
    ]);
  });
});
