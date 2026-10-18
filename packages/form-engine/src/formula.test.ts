import { describe, expect, it } from 'vitest';
import { compileFormula, type RefResolver } from './formula/compile.js';
import { FormulaError } from './formula/errors.js';
import { parse } from './formula/parser.js';
import { tokenize } from './formula/tokenizer.js';
import { evaluate } from './logic.js';

const vars: RefResolver = (path) => ({ logic: { var: path }, deps: [path] });
const compile = (source: string) => compileFormula(source, vars).logic;
const run = (source: string, data: Record<string, unknown> = {}) => evaluate(compile(source), data);

function errorOf(source: string): FormulaError {
  try {
    compileFormula(source, vars);
  } catch (error) {
    return error as FormulaError;
  }
  throw new Error(`aucune erreur pour ${source}`);
}

describe('analyse lexicale', () => {
  it('reconnaît nombres, chaînes, références, noms et opérateurs', () => {
    expect(tokenize('12.5 .5 "a\\"b" \'c\' {x} somme <> == <= && ; ,').map((t) => t.kind)).toEqual([
      'number',
      'number',
      'string',
      'string',
      'ref',
      'ident',
      'operator',
      'operator',
      'operator',
      'operator',
      ',',
      ',',
      'end',
    ]);
  });

  it('normalise les noms (majuscules, sans accents)', () => {
    expect(tokenize('moyenne Aujourd')[1]).toMatchObject({ name: 'AUJOURD' });
    expect(tokenize('Échéance')[0]).toMatchObject({ name: 'ECHEANCE' });
  });

  it.each([
    ['"ouvert', 'Chaîne de caractères non fermée', 0],
    ['{prix', 'Référence non fermée : « } » manquant', 0],
    ['1 + {Prix}', 'Référence invalide : {Prix}', 4],
    ['1 # 2', 'Caractère inattendu : « # »', 2],
    ['1 + .', 'Caractère inattendu : « . »', 4],
  ])('signale %s', (source, message, position) => {
    expect(errorOf(source)).toMatchObject({ name: 'FormulaError', message, position });
  });
});

describe('analyse syntaxique', () => {
  it('respecte les priorités et l associativité à gauche', () => {
    expect(compile('1 + 2 * 3 - 4')).toEqual({ '-': [{ '+': [1, { '*': [2, 3] }] }, 4] });
    expect(run('2 + 3 * 4')).toBe(14);
    expect(run('(2 + 3) * 4')).toBe(20);
    expect(run('10 / 4')).toBe(2.5);
    expect(run('10 % 4')).toBe(2);
  });

  it('gère comparaisons, ET/OU infixes, NON et le moins unaire', () => {
    expect(run('{a} > 1 ET {b} = "x"', { a: 2, b: 'x' })).toBe(true);
    expect(run('{a} < 1 OU {a} >= 2', { a: 2 })).toBe(true);
    expect(run('{a} <= 1 && {a} != 2 || {a} <> 3', { a: 2 })).toBe(true);
    expect(run('NON {a}', { a: true })).toBe(false);
    expect(run('!{a}', { a: false })).toBe(true);
    expect(run('-{a} + 1', { a: 3 })).toBe(-2);
    expect(run('5 == 5')).toBe(true);
  });

  it('reconnaît les littéraux VRAI, FAUX, NUL', () => {
    expect(compile('VRAI')).toBe(true);
    expect(compile('false')).toBe(false);
    expect(compile('nul')).toBeNull();
  });

  it.each([
    ['', 'Formule incomplète', 0],
    ['1 +', 'Formule incomplète', 3],
    ['1 2', 'Élément inattendu', 2],
    [')', 'Élément inattendu', 0],
    ['(1 + 2', 'Parenthèse fermante attendue', 6],
    ['SOMME(1; 2', 'Parenthèse fermante attendue après les arguments de SOMME', 10],
    ['prix * 2', "Nom inconnu : PRIX (une référence s'écrit {cle})", 0],
  ])('signale « %s »', (source, message, position) => {
    expect(errorOf(source)).toMatchObject({ message, position });
  });

  it('produit un arbre avec appels imbriqués', () => {
    expect(parse('SI({a}; ARRONDI({b}); 0)')).toMatchObject({
      type: 'call',
      name: 'SI',
      args: [{ type: 'ref' }, { type: 'call', name: 'ARRONDI' }, { type: 'literal', value: 0 }],
    });
  });
});

describe('fonctions', () => {
  const data = { a: 2, b: 3, l: [1, '2', null], d1: '2026-10-01', d2: '2026-10-18', t: 'x' };

  it.each([
    ['SI({a} > 1; "grand"; "petit")', 'grand'],
    ['SI({a} > 5; "grand")', null],
    ['IF({a} > 1, 1, 0)', 1],
    ['ET({a} > 1; {b} > 1)', true],
    ['OU({a} > 5; {b} > 5)', false],
    ['NON({a} > 5)', true],
    ['NOT({a} > 5)', true],
    ['SOMME({a}; {b}; {l})', 8],
    ['SUM({l})', 3],
    ['MOYENNE({a}; {b})', 2.5],
    ['AVG({l})', 1.5],
    ['MIN({a}; {b})', 2],
    ['MAX({l}; 10)', 10],
    ['NB({l})', 2],
    ['NB_LIGNES({l})', 2],
    ['ARRONDI(2.345; 2)', 2.35],
    ['ROUND(2.5)', 3],
    ['ABS(-4)', 4],
    ['CONCAT({t}; "-"; {a}; NUL)', 'x-2'],
    ['VIDE({inconnu})', true],
    ['EMPTY({t})', false],
    ['DANS({t}; "x"; "y")', true],
    ['IN({a}; 5)', false],
    ['JOURS_ENTRE({d1}; {d2})', 17],
    ['DAYS_BETWEEN({d2}; {d1})', -17],
    ['AJOUTER_JOURS({d1}; 31)', '2026-11-01'],
    ['ADD_DAYS({d1}; -1)', '2026-09-30'],
  ])('%s → %o', (source, expected) => {
    expect(run(source, data)).toEqual(expected);
  });

  it('expose les variables d environnement', () => {
    const env = { $today: '2026-10-18', $now: 'N', $user: { id: 'u1' }, $state: 'soumis' };
    expect(run('AUJOURDHUI()', env)).toBe('2026-10-18');
    expect(run('TODAY()', env)).toBe('2026-10-18');
    expect(run('MAINTENANT()', env)).toBe('N');
    expect(run('NOW()', env)).toBe('N');
    expect(run('UTILISATEUR()', env)).toBe('u1');
    expect(run('USER()', env)).toBe('u1');
    expect(run('ETAT()', env)).toBe('soumis');
    expect(run('STATE()', env)).toBe('soumis');
  });

  it.each([
    ['INCONNUE(1)', 'Fonction inconnue : INCONNUE'],
    ['ABS(1; 2)', 'ABS attend 1 argument(s), 2 fourni(s)'],
    ['SOMME()', 'SOMME attend au moins 1 argument(s), 0 fourni(s)'],
    ['SI(1)', 'SI attend 2 à 3 argument(s), 1 fourni(s)'],
    ['AUJOURDHUI(1)', 'AUJOURDHUI attend 0 argument(s), 1 fourni(s)'],
  ])('signale %s', (source, message) => {
    expect(errorOf(source).message).toBe(message);
  });
});

describe('références', () => {
  it('collecte les dépendances sans doublon', () => {
    expect(compileFormula('{a} + {a} * {b}', vars).deps).toEqual(['a', 'b']);
  });

  it('remonte l erreur du résolveur à la position de la référence', () => {
    const resolver: RefResolver = (path) => ({ error: `inconnu ${path}` });
    expect(() => compileFormula('1 + {x}', resolver)).toThrow(FormulaError);
    try {
      compileFormula('1 + {x}', resolver);
    } catch (error) {
      expect(error).toMatchObject({ message: 'inconnu x', position: 4 });
    }
  });
});
