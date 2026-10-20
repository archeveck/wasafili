import { inspectionEquipement, inspectionWorkflow } from '@wasafili/form-schema';
import { describe, expect, it } from 'vitest';
import { analyzeDefinition } from './analyze.js';
import { createResolver, buildModel } from './model.js';
import { definition, field } from './test-utils.js';

const issuesOf = (fields: ReturnType<typeof field>[]) => {
  const result = analyzeDefinition(definition(fields));
  return result.ok ? [] : result.issues.map((issue) => [issue.code, issue.message]);
};

describe('analyse de définition', () => {
  it('accepte la structure de démonstration, avec ou sans workflow', () => {
    const base = inspectionEquipement({ listId: 'l' });
    expect(analyzeDefinition(base)).toMatchObject({ ok: true, issues: [] });
    expect(analyzeDefinition({ ...base, workflow: inspectionWorkflow }).ok).toBe(true);
  });

  it('rapporte les erreurs de schéma', () => {
    const result = analyzeDefinition({ schemaVersion: 2, fields: [] });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.issues[0]).toMatchObject({
      code: 'schema',
      path: ['schemaVersion'],
    });
  });

  it('rapporte les formules invalides avec leur position et les cycles', () => {
    const result = analyzeDefinition(
      definition([
        field('calculated', 'a', { formula: '{b} *', resultType: 'number' }),
        field('calculated', 'b', { formula: '{c} + 1', resultType: 'number' }),
        field('calculated', 'c', { formula: '{b} + 1', resultType: 'number' }),
      ]),
    );
    expect(result.ok ? [] : result.issues).toEqual([
      {
        code: 'formula',
        message: 'a : Formule incomplète',
        path: ['fields'],
        field: 'a',
        position: 5,
      },
      {
        code: 'cycle',
        message: 'b : Dépendance circulaire : b → c → b',
        path: ['fields'],
        field: 'b',
      },
      {
        code: 'cycle',
        message: 'c : Dépendance circulaire : b → c → b',
        path: ['fields'],
        field: 'c',
      },
    ]);
  });

  it('vérifie opérateurs et références des conditions', () => {
    expect(
      issuesOf([
        field('text', 'a', { visibleIf: { map: [[1], { var: '' }] } }),
        field('text', 'b', { requiredIf: { '==': [{ var: 'inconnu' }, 1] } }),
        field('text', 'c', { visibleIf: { '==': [{ var: '$row.x' }, 1] } }),
        field('text', 'd', { visibleIf: { '==': [{ var: 'titre' }, 1] } }),
        field('section', 'titre', { fields: [] }),
        field('text', 'e', {
          visibleIf: {
            and: [{ var: '$state' }, { var: '$user.roles' }, { var: 'a' }, { var: 'pos.lat' }],
          },
        }),
        field('geolocation', 'pos'),
        field('table', 't', {
          fields: [
            field('boolean', 'ko'),
            field('text', 'motif', { visibleIf: { and: [{ var: '$row.ko' }, { var: 'a' }] } }),
            field('text', 'autre', { visibleIf: { var: '$row.absent' } }),
            field('text', 'cellule_ref', { visibleIf: { var: 'ko' } }),
          ],
        }),
      ]),
    ).toEqual([
      ['unknown_operator', 'a.visibleIf : opérateur non autorisé (map)'],
      ['unknown_reference', 'b.requiredIf : référence inconnue « inconnu »'],
      ['unknown_reference', 'c.visibleIf : référence inconnue « $row.x »'],
      ['unknown_reference', 'd.visibleIf : référence inconnue « titre »'],
      ['unknown_reference', 'autre.visibleIf : référence inconnue « $row.absent »'],
      ['unknown_reference', 'cellule_ref.visibleIf : référence inconnue « ko »'],
    ]);
  });

  it('vérifie les cascades de référentiels', () => {
    const list = (key: string, extra: Record<string, unknown> = {}) =>
      field('list', key, { listId: 'L', ...extra });
    expect(
      issuesOf([
        field('text', 'texte'),
        list('site', { level: 0 }),
        list('a', { parentField: 'texte' }),
        list('b', { parentField: 'site', listId: 'AUTRE' }),
        list('c', { parentField: 'site', level: 0 }),
        list('ok', { parentField: 'site', level: 1 }),
        list('ok_sans_niveau', { parentField: 'site' }),
        list('d', { parentField: 'absent' }),
        field('table', 't', { fields: [list('e', { parentField: 'site' })] }),
      ]),
    ).toEqual([
      ['invalid_parent', 'a : le champ parent doit être un champ référentiel'],
      ['invalid_parent', 'b : le champ parent doit utiliser le même référentiel'],
      ['invalid_parent', 'c : le niveau du parent doit être inférieur'],
      ['invalid_parent', 'd : le champ parent doit être un champ référentiel'],
      ['invalid_parent', 'e : le champ parent doit être au même niveau (racine ou même tableau)'],
    ]);
  });
});

describe('résolution des références de formule', () => {
  const model = buildModel(
    definition([
      field('number', 'x'),
      field('section', 's', { fields: [] }),
      field('table', 't', {
        fields: [field('number', 'q'), field('info', 'aide', { content: '' })],
      }),
    ]),
  );
  const root = createResolver(model.byKey);
  const inTable = createResolver(model.byKey, model.byKey.get('t')!.field as never);

  it.each([
    ['$today', 'Référence réservée {$today} : utiliser AUJOURDHUI(), UTILISATEUR()…'],
    ['inconnu', 'Champ inconnu : {inconnu}'],
    ['x.y', "{x} n'est pas un tableau"],
    ['t.absent', 'Colonne inconnue : {t.absent}'],
    ['t.aide', 'Colonne inconnue : {t.aide}'],
    ['s', '{s} ne porte pas de valeur'],
    ['q', '{q} est une colonne du tableau {t} : utiliser {t.q} dans un agrégat'],
  ])('refuse {%s}', (path, error) => {
    expect(root(path)).toEqual({ error });
  });

  it('résout racine, colonne, agrégat et ligne courante', () => {
    expect(root('x')).toEqual({ logic: { var: 'x' }, deps: ['x'] });
    expect(root('t')).toEqual({ logic: { var: 't' }, deps: ['t'] });
    expect(root('t.q')).toEqual({ logic: { pluck: [{ var: 't' }, 'q'] }, deps: ['t', 't.q'] });
    expect(inTable('q')).toEqual({ logic: { var: '$row.q' }, deps: ['t.q'] });
    expect(inTable('x')).toEqual({ logic: { var: 'x' }, deps: ['x'] });
  });
});
