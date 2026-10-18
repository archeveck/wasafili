import { describe, expect, it } from 'vitest';
import {
  emptyDefinition,
  type Field,
  FIELD_TYPES,
  inspectionEquipement,
  inspectionWorkflow,
  initialState,
  rootValueFields,
  structureDefinitionJsonSchema,
  structureDefinitionSchema,
  walkFields,
  workflowSchema,
} from './index.js';

const text = (key: string, extra: Partial<Field> = {}) =>
  ({ id: `id-${key}`, key, type: 'text', label: key, ...extra }) as Field;

const parse = (fields: unknown[], extra: Record<string, unknown> = {}) =>
  structureDefinitionSchema.safeParse({ schemaVersion: 1, fields, ...extra });

const messages = (result: ReturnType<typeof parse>) =>
  result.success ? [] : result.error.issues.map((issue) => issue.message);

describe('types de champs', () => {
  it('couvre au moins 25 types', () => {
    expect(FIELD_TYPES.length).toBeGreaterThanOrEqual(25);
    expect(new Set(FIELD_TYPES).size).toBe(FIELD_TYPES.length);
  });

  it('accepte la structure de démonstration complète', () => {
    const result = structureDefinitionSchema.safeParse({
      ...inspectionEquipement({ listId: 'liste' }),
      workflow: inspectionWorkflow,
    });
    expect(messages(result as never)).toEqual([]);
  });

  it('accepte une structure vide', () => {
    expect(structureDefinitionSchema.parse(emptyDefinition()).fields).toEqual([]);
  });

  it('refuse un type inconnu, une clé invalide et une condition à plusieurs opérateurs', () => {
    expect(parse([{ id: '1', key: 'a', type: 'inconnu', label: 'A' }]).success).toBe(false);
    expect(parse([text('Majuscule')]).success).toBe(false);
    expect(parse([text('a', { visibleIf: { '==': [1, 1], '!=': [1, 2] } } as never)]).success).toBe(
      false,
    );
  });

  it('interdit un tableau dans un tableau et une section dans une section', () => {
    const table = { id: 't', key: 't', type: 'table', label: 'T', fields: [text('x')] };
    expect(parse([{ ...table, fields: [{ ...table, id: 't2', key: 't2' }] }]).success).toBe(false);
    const section = { id: 's', key: 's', type: 'section', label: 'S', fields: [] };
    expect(parse([{ ...section, fields: [{ ...section, id: 's2', key: 's2' }] }]).success).toBe(
      false,
    );
    expect(parse([{ ...section, fields: [table] }]).success).toBe(true);
  });
});

describe('contrôles structurels', () => {
  it('impose des clés et identifiants uniques, y compris dans les tableaux', () => {
    const table = {
      id: 't',
      key: 't',
      type: 'table',
      label: 'T',
      fields: [text('a', { id: 'x' })],
    };
    expect(messages(parse([text('a'), table]))).toEqual(['a : clé déjà utilisée']);
    expect(messages(parse([text('a', { id: 'x' }), text('b', { id: 'x' })]))).toEqual([
      'b : identifiant déjà utilisé (x)',
    ]);
  });

  it('refuse des options en double, des bornes inversées et une regex invalide', () => {
    const select = {
      id: 's',
      key: 's',
      type: 'select',
      label: 'S',
      options: [
        { value: 'a', label: 'A' },
        { value: 'a', label: 'A bis' },
      ],
    };
    expect(messages(parse([select]))).toEqual(['s : valeurs d option en double']);
    expect(
      messages(parse([{ id: 'n', key: 'n', type: 'number', label: 'N', min: 5, max: 1 }])),
    ).toEqual(['n : minimum supérieur au maximum']);
    expect(messages(parse([text('t', { minLength: 9, maxLength: 2 } as never)]))).toEqual([
      't : minimum supérieur au maximum',
    ]);
    expect(messages(parse([text('t', { pattern: '([' } as never)]))).toEqual([
      't : expression régulière invalide',
    ]);
  });

  it('vérifie les états référencés par les champs et les champs requis des transitions', () => {
    expect(messages(parse([text('a', { visibleInStates: ['soumis'] })]))).toEqual([
      'a : état « soumis » référencé sans workflow',
    ]);
    const workflow = {
      ...inspectionWorkflow,
      transitions: [
        { key: 'go', label: 'Go', from: ['brouillon'], to: 'soumis', requiredFields: ['zz'] },
      ],
    };
    expect(messages(parse([text('a', { editableInStates: ['inconnu'] })], { workflow }))).toEqual([
      'a : état inconnu « inconnu »',
      'Transition go : champ inconnu « zz »',
    ]);
  });
});

describe('workflow', () => {
  const state = (key: string, extra = {}) => ({ key, label: key, ...extra });

  it('exige exactement un état initial et des états uniques', () => {
    const result = workflowSchema.safeParse({
      states: [state('a'), state('a')],
      transitions: [],
    });
    expect(result.success ? [] : result.error.issues.map((i) => i.message)).toEqual([
      'État en double : a',
      'Le workflow doit avoir exactement un état initial',
    ]);
  });

  it('refuse les transitions en double, vers un état inconnu ou depuis un état final', () => {
    const result = workflowSchema.safeParse({
      states: [state('a', { initial: true }), state('z', { final: true })],
      transitions: [
        { key: 't', label: 'T', from: ['a'], to: 'x' },
        { key: 't', label: 'T', from: ['z'], to: 'a' },
      ],
    });
    expect(result.success ? [] : result.error.issues.map((i) => i.message)).toEqual([
      'État inconnu : x',
      'Transition en double : t',
      "Aucune transition ne peut partir de l'état final z",
    ]);
  });

  it('donne l état initial', () => {
    expect(initialState(inspectionWorkflow)).toBe('brouillon');
    expect(initialState(undefined)).toBeNull();
  });
});

describe('parcours des champs', () => {
  it('aplatit les sections et isole les colonnes de tableau', () => {
    const definition = inspectionEquipement({ listId: 'l' });
    const entries = [...walkFields(definition.fields)];
    expect(entries.find((e) => e.field.key === 'montant')?.table?.key).toBe('pieces');
    expect(entries.find((e) => e.field.key === 'etat')?.section?.key).toBe('constat');
    expect(rootValueFields(definition.fields).map((f) => f.key)).toEqual([
      'site',
      'batiment',
      'equipement',
      'date_inspection',
      'inspecteur',
      'etat',
      'description_defaut',
      'photos',
      'position',
      'pieces',
      'total_pieces',
      'signature',
      'cree_le',
    ]);
  });

  it('parcourt les tableaux placés dans une section', () => {
    const fields = [
      {
        id: 's',
        key: 's',
        type: 'section',
        label: 'S',
        fields: [{ id: 't', key: 't', type: 'table', label: 'T', fields: [text('c')] }],
      },
    ] as Field[];
    const cell = [...walkFields(fields)].find((entry) => entry.field.key === 'c');
    expect(cell?.table?.key).toBe('t');
    expect(cell?.section?.key).toBe('s');
  });
});

describe('JSON Schema', () => {
  it('exporte la définition', () => {
    const schema = structureDefinitionJsonSchema();
    expect(schema).toMatchObject({ type: 'object' });
    expect(JSON.stringify(schema)).toContain('"calculated"');
  });
});
