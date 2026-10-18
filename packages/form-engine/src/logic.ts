import { type JsonLogic } from '@tesserax/form-schema';
import jsonLogic from 'json-logic-js';
import { dayNumber, formatDay } from './dates.js';

export function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** Convertit en nombre fini (nombres et chaînes numériques) ; `null` sinon. */
export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Arrondi décimal (½ s'éloigne de zéro), robuste aux erreurs binaires (1,005 → 1,01). */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return (Math.sign(value) * Math.round(Math.abs(value) * factor * (1 + Number.EPSILON))) / factor;
}

const flatten = (args: unknown[]): unknown[] =>
  args.flatMap((arg) => (Array.isArray(arg) ? arg : [arg]));
const numbers = (args: unknown[]): number[] =>
  flatten(args)
    .map(toNumber)
    .filter((value): value is number => value !== null);

/**
 * Opérations ajoutées à json-logic. Les agrégats aplatissent les tableaux : `SOMME({lignes.x})`
 * compile en `{"sum": [{"pluck": [{"var": "lignes"}, "x"]}]}`.
 */
const customOperations: Record<string, (...args: unknown[]) => unknown> = {
  empty: (value) => isEmpty(value),
  /** Vrai si la valeur (ou l'une des valeurs d'un choix multiple) est dans la liste. */
  in_list: (value, list) => {
    const candidates = Array.isArray(list) ? list : [list];
    return (Array.isArray(value) ? value : [value]).some((item) => candidates.includes(item));
  },
  pluck: (rows, key) =>
    Array.isArray(rows)
      ? rows.map((row) =>
          row && typeof row === 'object'
            ? (row as Record<string, unknown>)[String(key)]
            : undefined,
        )
      : [],
  sum: (...args) => numbers(args).reduce((total, value) => total + value, 0),
  avg: (...args) => {
    const values = numbers(args);
    return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
  },
  min_of: (...args) => {
    const values = numbers(args);
    return values.length ? Math.min(...values) : null;
  },
  max_of: (...args) => {
    const values = numbers(args);
    return values.length ? Math.max(...values) : null;
  },
  count: (...args) => flatten(args).filter((value) => !isEmpty(value)).length,
  round: (value, decimals) => {
    const number = toNumber(value);
    return number === null ? null : roundTo(number, toNumber(decimals) ?? 0);
  },
  abs: (value) => {
    const number = toNumber(value);
    return number === null ? null : Math.abs(number);
  },
  concat: (...args) =>
    flatten(args)
      .filter((value) => value !== null && value !== undefined)
      .map(String)
      .join(''),
  days_between: (from, to) => {
    const start = dayNumber(from);
    const end = dayNumber(to);
    return start === null || end === null ? null : end - start;
  },
  add_days: (date, days) => {
    const start = dayNumber(date);
    const offset = toNumber(days);
    return start === null || offset === null ? null : formatDay(start + Math.trunc(offset));
  },
};

for (const [name, operation] of Object.entries(customOperations)) {
  jsonLogic.add_operation(name, operation);
}

/**
 * Opérateurs autorisés dans une définition. Les opérateurs à portée locale (`map`, `filter`,
 * `reduce`, `all`, `some`, `none`) et `log` sont exclus : ils changent le sens de `var`.
 */
export const OPERATORS: ReadonlySet<string> = new Set([
  'var',
  'missing',
  'missing_some',
  'if',
  '?:',
  '==',
  '===',
  '!=',
  '!==',
  '!',
  '!!',
  'or',
  'and',
  '>',
  '>=',
  '<',
  '<=',
  'max',
  'min',
  '+',
  '-',
  '*',
  '/',
  '%',
  'in',
  'cat',
  'substr',
  'merge',
  ...Object.keys(customOperations),
]);

export type Data = Record<string, unknown>;

/** Évalue une expression ; une erreur d'évaluation donne `undefined`. */
export function evaluate(logic: JsonLogic, data: Data): unknown {
  try {
    return jsonLogic.apply(logic as never, data);
  } catch {
    return undefined;
  }
}

export function truthy(value: unknown): boolean {
  return jsonLogic.truthy(value);
}

export interface LogicIssue {
  kind: 'unknown_operator' | 'invalid_var';
  detail: string;
}

/** Parcourt une expression : variables lues et opérateurs non autorisés. */
export function inspectLogic(logic: JsonLogic): { vars: string[]; issues: LogicIssue[] } {
  const vars: string[] = [];
  const issues: LogicIssue[] = [];
  const visit = (node: JsonLogic): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    const entries = Object.entries(node);
    if (entries.length !== 1) {
      issues.push({ kind: 'unknown_operator', detail: 'objet à plusieurs clés' });
      return;
    }
    const [operator, args] = entries[0]!;
    if (!OPERATORS.has(operator)) {
      issues.push({ kind: 'unknown_operator', detail: operator });
      return;
    }
    if (operator === 'var') {
      const path = Array.isArray(args) ? args[0] : args;
      if (typeof path === 'string' && path !== '') vars.push(path);
      else issues.push({ kind: 'invalid_var', detail: JSON.stringify(args) });
      return;
    }
    visit(args);
  };
  visit(logic);
  return { vars, issues };
}
