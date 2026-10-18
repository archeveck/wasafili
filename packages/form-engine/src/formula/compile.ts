import { type JsonLogic } from '@tesserax/form-schema';
import { FormulaError } from './errors.js';
import { type BinaryOperator, type Node, parse } from './parser.js';

/** Résolution d'une référence `{...}` : expression json-logic et dépendances, ou erreur. */
export type RefResolver = (
  path: string,
) => { logic: JsonLogic; deps: string[] } | { error: string };

export interface CompiledFormula {
  logic: JsonLogic;
  /** Nœuds dont dépend la formule (`cle` ou `tableau.colonne`), sans doublon. */
  deps: string[];
}

const BINARY: Record<BinaryOperator, string> = {
  '+': '+',
  '-': '-',
  '*': '*',
  '/': '/',
  '%': '%',
  '=': '==',
  '!=': '!=',
  '<': '<',
  '<=': '<=',
  '>': '>',
  '>=': '>=',
  '&&': 'and',
  '||': 'or',
};

interface FunctionSpec {
  min: number;
  max: number;
  compile: (args: JsonLogic[]) => JsonLogic;
}

const op =
  (name: string) =>
  (args: JsonLogic[]): JsonLogic => ({ [name]: args });
const variable = (path: string) => (): JsonLogic => ({ var: path });
const MANY = Number.POSITIVE_INFINITY;

const SPECS: Record<string, FunctionSpec> = {
  SI: { min: 2, max: 3, compile: (args) => ({ if: args.length === 2 ? [...args, null] : args }) },
  ET: { min: 1, max: MANY, compile: op('and') },
  OU: { min: 1, max: MANY, compile: op('or') },
  NON: { min: 1, max: 1, compile: op('!') },
  SOMME: { min: 1, max: MANY, compile: op('sum') },
  MOYENNE: { min: 1, max: MANY, compile: op('avg') },
  MIN: { min: 1, max: MANY, compile: op('min_of') },
  MAX: { min: 1, max: MANY, compile: op('max_of') },
  NB: { min: 1, max: MANY, compile: op('count') },
  ARRONDI: { min: 1, max: 2, compile: op('round') },
  ABS: { min: 1, max: 1, compile: op('abs') },
  CONCAT: { min: 1, max: MANY, compile: op('concat') },
  VIDE: { min: 1, max: 1, compile: op('empty') },
  DANS: { min: 2, max: MANY, compile: ([value, ...list]) => ({ in_list: [value!, list] }) },
  JOURS_ENTRE: { min: 2, max: 2, compile: op('days_between') },
  AJOUTER_JOURS: { min: 2, max: 2, compile: op('add_days') },
  AUJOURDHUI: { min: 0, max: 0, compile: variable('$today') },
  MAINTENANT: { min: 0, max: 0, compile: variable('$now') },
  UTILISATEUR: { min: 0, max: 0, compile: variable('$user.id') },
  ETAT: { min: 0, max: 0, compile: variable('$state') },
};

/** Noms anglais acceptés en alias. */
const ALIASES: Record<string, string> = {
  IF: 'SI',
  AND: 'ET',
  OR: 'OU',
  NOT: 'NON',
  SUM: 'SOMME',
  AVG: 'MOYENNE',
  AVERAGE: 'MOYENNE',
  COUNT: 'NB',
  NB_LIGNES: 'NB',
  ROUND: 'ARRONDI',
  EMPTY: 'VIDE',
  IN: 'DANS',
  DAYS_BETWEEN: 'JOURS_ENTRE',
  ADD_DAYS: 'AJOUTER_JOURS',
  TODAY: 'AUJOURDHUI',
  NOW: 'MAINTENANT',
  USER: 'UTILISATEUR',
  STATE: 'ETAT',
};

export const FORMULA_FUNCTIONS: readonly string[] = Object.keys(SPECS);

/**
 * Compile une formule lisible en json-logic (D7). Exemples :
 * `{prix} * {quantite}`, `SOMME({lignes.montant})`, `SI({etat} = "bon"; 0; 1)`.
 */
export function compileFormula(source: string, resolve: RefResolver): CompiledFormula {
  const deps = new Set<string>();

  const compile = (node: Node): JsonLogic => {
    switch (node.type) {
      case 'literal':
        return node.value;
      case 'ref': {
        const resolved = resolve(node.path);
        if ('error' in resolved) throw new FormulaError(resolved.error, node.position);
        resolved.deps.forEach((dep) => deps.add(dep));
        return resolved.logic;
      }
      case 'unary':
        return { [node.operator]: [compile(node.argument)] };
      case 'binary':
        return { [BINARY[node.operator]]: [compile(node.left), compile(node.right)] };
      case 'call': {
        const name = ALIASES[node.name] ?? node.name;
        const spec = SPECS[name];
        if (!spec) throw new FormulaError(`Fonction inconnue : ${node.name}`, node.position);
        if (node.args.length < spec.min || node.args.length > spec.max) {
          const expected =
            spec.min === spec.max
              ? `${spec.min}`
              : spec.max === MANY
                ? `au moins ${spec.min}`
                : `${spec.min} à ${spec.max}`;
          throw new FormulaError(
            `${name} attend ${expected} argument(s), ${node.args.length} fourni(s)`,
            node.position,
          );
        }
        return spec.compile(node.args.map(compile));
      }
    }
  };

  const logic = compile(parse(source));
  return { logic, deps: [...deps] };
}
