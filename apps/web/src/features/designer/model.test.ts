import { analyzeDefinition } from '@wasafili/form-engine';
import { type Field, inspectionEquipement, type StructureDefinition } from '@wasafili/form-schema';
import { describe, expect, it } from 'vitest';
import {
  canContain,
  conditionToLogic,
  createField,
  diffDefinitions,
  findField,
  followLabel,
  insertField,
  logicToCondition,
  moveField,
  PALETTE,
  removeField,
  ROOT,
  updateField,
} from './model';

let n = 0;
const newId = () => `id${++n}`;
const empty = (): StructureDefinition => ({ schemaVersion: 1, fields: [] });

describe('création de champs', () => {
  it('produit pour chaque type de la palette une définition valide', () => {
    let definition = empty();
    for (const { type } of PALETTE) {
      definition = insertField(definition, createField(type, definition, newId), ROOT);
    }
    // Seuls le référentiel et la relation attendent d'être configurés (identifiant vide).
    const analysis = analyzeDefinition(definition);
    const paths = analysis.ok ? [] : analysis.issues.map((i) => i.path.join('.'));
    expect(paths).toHaveLength(2);
    expect(paths.every((path) => /^fields\.\d+\.(listId|structureId)$/.test(path))).toBe(true);
    expect(definition.fields).toHaveLength(PALETTE.length);
  });

  it('dérive des clés uniques des libellés', () => {
    let definition = empty();
    const a = createField('text', definition, newId);
    definition = insertField(definition, a, ROOT);
    const b = createField('text', definition, newId);
    expect([a.key, b.key]).toEqual(['texte_court', 'texte_court_2']);
  });

  it('fait suivre le libellé à une clé jamais retouchée', () => {
    const taken = new Set(['texte_court', 'texte_court_2', 'etat']);
    // Frappe lettre à lettre : la clé suit, y compris un suffixe d'unicité.
    expect(followLabel('texte_court_2', 'Texte court', 'É', taken)).toBe('e');
    expect(followLabel('e', 'É', 'État', new Set([...taken, 'e']))).toBe('etat_2');
    expect(followLabel('etat_2', 'État', 'État général', new Set([...taken, 'etat_2']))).toBe(
      'etat_general',
    );
    // Clé saisie à la main : elle ne bouge plus.
    expect(followLabel('etat', 'État général', 'État', taken)).toBe('etat');
    // Colonne d'un nouveau tableau : clé tirée de son libellé, donc suivie elle aussi.
    const table = createField('table', empty(), newId) as Field & { fields: Field[] };
    expect(table.fields[0]).toMatchObject({ key: 'colonne_1', label: 'Colonne 1' });
  });
});

describe('arbre des champs', () => {
  const base = () => {
    let definition = empty();
    const section = createField('section', definition, newId);
    definition = insertField(definition, section, ROOT);
    const table = createField('table', definition, newId);
    definition = insertField(definition, table, ROOT);
    const text = createField('text', definition, newId);
    definition = insertField(definition, text, ROOT);
    return { definition, section, table, text };
  };

  it('respecte les règles d imbrication', () => {
    const { definition, section, table } = base();
    expect(canContain(definition, section.id, 'table')).toBe(true);
    expect(canContain(definition, section.id, 'section')).toBe(false);
    expect(canContain(definition, table.id, 'table')).toBe(false);
    expect(canContain(definition, table.id, 'photo')).toBe(true);
    expect(canContain(definition, 'inconnu', 'text')).toBe(false);
  });

  it('déplace entre conteneurs et réordonne', () => {
    const { definition, section, table, text } = base();
    const inSection = moveField(definition, text.id, section.id, 0);
    expect(findField(inSection, text.id)?.container).toBe(section.id);
    const tableInSection = moveField(inSection, table.id, section.id, 1);
    expect(
      (tableInSection.fields[0] as Field & { fields: Field[] }).fields.map((f) => f.id),
    ).toEqual([text.id, table.id]);
    // Une section ne peut pas entrer dans un tableau.
    expect(moveField(definition, section.id, table.id, 0)).toBe(definition);
    // Réordonnancement à la racine : la section passe en dernier.
    expect(moveField(definition, section.id, ROOT, 3).fields.map((f) => f.id)).toEqual([
      table.id,
      text.id,
      section.id,
    ]);
  });

  it('modifie et supprime n importe où dans l arbre', () => {
    const { definition, table } = base();
    const cell = (table as Field & { fields: Field[] }).fields[0]!;
    const renamed = updateField(definition, cell.id, { label: 'Référence' });
    expect(findField(renamed, cell.id)?.field.label).toBe('Référence');
    expect(findField(removeField(renamed, cell.id), cell.id)).toBeUndefined();
    expect(removeField(definition, 'absent')).toBe(definition);
    expect(updateField(definition, 'absent', { label: 'x' })).toBe(definition);
  });
});

describe('conditions visuelles', () => {
  it('convertit dans les deux sens les conditions simples', () => {
    const model = {
      combinator: 'or' as const,
      rules: [
        { variable: 'etat', operator: '==' as const, value: 'bon' },
        { variable: 'cout', operator: '>=' as const, value: '100' },
        { variable: 'photos', operator: 'empty' as const, value: '' },
        { variable: 'motif', operator: 'filled' as const, value: '' },
        { variable: 'etat', operator: 'in' as const, value: 'degrade, hors_service' },
      ],
    };
    const logic = conditionToLogic(model)!;
    expect(logic).toEqual({
      or: [
        { '==': [{ var: 'etat' }, 'bon'] },
        { '>=': [{ var: 'cout' }, 100] },
        { empty: [{ var: 'photos' }] },
        { '!': [{ empty: [{ var: 'motif' }] }] },
        { in_list: [{ var: 'etat' }, ['degrade', 'hors_service']] },
      ],
    });
    expect(logicToCondition(logic)).toEqual(model);
    expect(
      conditionToLogic({
        combinator: 'and',
        rules: [{ variable: 'ok', operator: '==', value: 'true' }],
      }),
    ).toEqual({
      '==': [{ var: 'ok' }, true],
    });
    expect(conditionToLogic({ combinator: 'and', rules: [] })).toBeUndefined();
  });

  it('signale une expression trop complexe pour l éditeur visuel', () => {
    expect(logicToCondition({ in: [{ var: 'etat' }, ['a', 'b']] })).toBeUndefined();
    expect(logicToCondition({ and: [{ '==': [{ var: 'a' }, { var: 'b' }] }] })).toBeUndefined();
    expect(logicToCondition(undefined)).toEqual({ combinator: 'and', rules: [] });
  });
});

describe('diff de versions', () => {
  it('compare par clé de champ', () => {
    const before = inspectionEquipement({ listId: 'l' });
    let after = updateField(before, 'f-etat', { label: 'État' });
    after = removeField(after, 'f-position');
    after = insertField(after, { id: 'n', key: 'nouveau', label: 'Nouveau', type: 'text' }, ROOT);
    const diff = diffDefinitions(before, after);
    expect(diff.added.map((f) => f.key)).toEqual(['nouveau']);
    expect(diff.removed.map((f) => f.key)).toEqual(['position']);
    expect(diff.changed.map((c) => c.after.key)).toEqual(['etat']);
    expect(diff.workflowChanged).toBe(false);
    expect(diffDefinitions(undefined, before).added.length).toBeGreaterThan(10);
  });
});
