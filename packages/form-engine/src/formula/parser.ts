import { FormulaError } from './errors.js';
import { type Operator, type Token, tokenize } from './tokenizer.js';

export type Node =
  | { type: 'literal'; value: number | string | boolean | null }
  | { type: 'ref'; path: string; position: number }
  | { type: 'unary'; operator: '-' | '!'; argument: Node }
  | { type: 'binary'; operator: BinaryOperator; left: Node; right: Node }
  | { type: 'call'; name: string; args: Node[]; position: number };

export type BinaryOperator = Exclude<Operator, '!'>;

const KEYWORDS: Record<string, boolean | null> = {
  VRAI: true,
  TRUE: true,
  FAUX: false,
  FALSE: false,
  NUL: null,
  NULL: null,
};

/** Mots-clés infixes : `a ET b`, `a OU b`. */
const WORD_OPERATORS: Record<string, BinaryOperator> = { ET: '&&', AND: '&&', OU: '||', OR: '||' };

/** Niveaux de priorité, du plus faible au plus fort. */
const LEVELS: BinaryOperator[][] = [
  ['||'],
  ['&&'],
  ['=', '!=', '<', '<=', '>', '>='],
  ['+', '-'],
  ['*', '/', '%'],
];

export function parse(source: string): Node {
  const tokens = tokenize(source);
  let index = 0;
  const peek = (): Token => tokens[index]!;
  const next = (): Token => tokens[index++]!;

  const binaryOperatorOf = (token: Token): BinaryOperator | undefined => {
    if (token.kind === 'operator' && token.value !== '!') return token.value;
    if (token.kind === 'ident' && tokens[index + 1]?.kind !== '(')
      return WORD_OPERATORS[token.name];
    return undefined;
  };

  const parseLevel = (level: number): Node => {
    if (level === LEVELS.length) return parseUnary();
    let left = parseLevel(level + 1);
    for (;;) {
      const operator = binaryOperatorOf(peek());
      if (!operator || !LEVELS[level]!.includes(operator)) return left;
      next();
      left = { type: 'binary', operator, left, right: parseLevel(level + 1) };
    }
  };

  const parseUnary = (): Node => {
    const token = peek();
    if (token.kind === 'operator' && (token.value === '-' || token.value === '!')) {
      next();
      return { type: 'unary', operator: token.value, argument: parseUnary() };
    }
    if (token.kind === 'ident' && (token.name === 'NON' || token.name === 'NOT')) {
      if (tokens[index + 1]?.kind !== '(') {
        next();
        return { type: 'unary', operator: '!', argument: parseUnary() };
      }
    }
    return parsePrimary();
  };

  const parsePrimary = (): Node => {
    const token = next();
    switch (token.kind) {
      case 'number':
      case 'string':
        return { type: 'literal', value: token.value };
      case 'ref':
        return { type: 'ref', path: token.path, position: token.position };
      case '(': {
        const inner = parseLevel(0);
        expect(')', 'Parenthèse fermante attendue');
        return inner;
      }
      case 'ident': {
        if (peek().kind === '(') {
          next();
          const args: Node[] = [];
          if (peek().kind !== ')') {
            do args.push(parseLevel(0));
            while (peek().kind === ',' && next());
          }
          expect(')', `Parenthèse fermante attendue après les arguments de ${token.name}`);
          return { type: 'call', name: token.name, args, position: token.position };
        }
        if (token.name in KEYWORDS) return { type: 'literal', value: KEYWORDS[token.name]! };
        throw new FormulaError(
          `Nom inconnu : ${token.name} (une référence s'écrit {cle})`,
          token.position,
        );
      }
      case 'end':
        throw new FormulaError('Formule incomplète', token.position);
      default:
        throw new FormulaError('Élément inattendu', token.position);
    }
  };

  const expect = (kind: Token['kind'], message: string): void => {
    if (peek().kind !== kind) throw new FormulaError(message, peek().position);
    next();
  };

  const tree = parseLevel(0);
  if (peek().kind !== 'end') throw new FormulaError('Élément inattendu', peek().position);
  return tree;
}
