import { FormulaError } from './errors.js';

export type Operator =
  '+' | '-' | '*' | '/' | '%' | '=' | '!=' | '<' | '<=' | '>' | '>=' | '&&' | '||' | '!';

export type Token =
  | { kind: 'number'; value: number; position: number }
  | { kind: 'string'; value: string; position: number }
  | { kind: 'ref'; path: string; position: number }
  | { kind: 'ident'; name: string; position: number }
  | { kind: 'operator'; value: Operator; position: number }
  | { kind: '(' | ')' | ','; position: number }
  | { kind: 'end'; position: number };

const OPERATORS: [string, Operator][] = [
  ['<=', '<='],
  ['>=', '>='],
  ['<>', '!='],
  ['!=', '!='],
  ['==', '='],
  ['&&', '&&'],
  ['||', '||'],
  ['+', '+'],
  ['-', '-'],
  ['*', '*'],
  ['/', '/'],
  ['%', '%'],
  ['=', '='],
  ['<', '<'],
  ['>', '>'],
  ['!', '!'],
];

const REF_PATTERN = /^\$?[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/;
const IDENT_START = /[A-Za-z_À-ſ]/;
const IDENT_PART = /[A-Za-z0-9_À-ſ]/;

/** Nom de fonction ou mot-clé normalisé : majuscules, sans accents. */
function normalizeIdent(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i]!;
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    const position = i;

    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      const match = /^(\d+(\.\d+)?|\.\d+)/.exec(source.slice(i))!;
      tokens.push({ kind: 'number', value: Number(match[0]), position });
      i += match[0].length;
      continue;
    }

    if (char === '"' || char === "'") {
      let value = '';
      i++;
      while (i < source.length && source[i] !== char) {
        if (source[i] === '\\' && i + 1 < source.length) i++;
        value += source[i];
        i++;
      }
      if (i >= source.length) throw new FormulaError('Chaîne de caractères non fermée', position);
      i++;
      tokens.push({ kind: 'string', value, position });
      continue;
    }

    if (char === '{') {
      const end = source.indexOf('}', i);
      if (end < 0) throw new FormulaError('Référence non fermée : « } » manquant', position);
      const path = source.slice(i + 1, end).trim();
      if (!REF_PATTERN.test(path)) {
        throw new FormulaError(`Référence invalide : {${path}}`, position);
      }
      tokens.push({ kind: 'ref', path, position });
      i = end + 1;
      continue;
    }

    if (IDENT_START.test(char)) {
      let name = '';
      while (i < source.length && IDENT_PART.test(source[i]!)) name += source[i++];
      tokens.push({ kind: 'ident', name: normalizeIdent(name), position });
      continue;
    }

    if (char === '(' || char === ')') {
      tokens.push({ kind: char, position });
      i++;
      continue;
    }
    // Séparateur d'arguments : « , » ou « ; » (habitude des tableurs en français).
    if (char === ',' || char === ';') {
      tokens.push({ kind: ',', position });
      i++;
      continue;
    }

    const operator = OPERATORS.find(([text]) => source.startsWith(text, i));
    if (!operator) throw new FormulaError(`Caractère inattendu : « ${char} »`, position);
    tokens.push({ kind: 'operator', value: operator[1], position });
    i += operator[0].length;
  }
  tokens.push({ kind: 'end', position: source.length });
  return tokens;
}
