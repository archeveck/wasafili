import {
  type Field,
  type FieldOfType,
  hasValue,
  type JsonLogic,
  type SectionField,
  type StructureDefinition,
  type TableField,
  walkFields,
} from '@tesserax/form-schema';
import { type RefResolver, compileFormula } from './formula/compile.js';
import { FormulaError } from './formula/errors.js';

export interface Entry {
  field: Field;
  section?: SectionField;
  table?: TableField;
}

export type CalculatedField = FieldOfType<'calculated'>;

/** Champ calculé compilé, nœud du graphe de dépendances. */
export interface CalcNode {
  /** `cle` (racine) ou `tableau.colonne` (calcul par ligne). */
  id: string;
  field: CalculatedField;
  table?: TableField;
  /** Absent si la formule est invalide ou prise dans un cycle : la valeur vaut alors `null`. */
  logic?: JsonLogic;
  deps: string[];
  error?: { code: 'formula' | 'cycle'; message: string; position?: number };
}

export interface Model {
  definition: StructureDefinition;
  entries: Entry[];
  byKey: Map<string, Entry>;
  rootValueKeys: Set<string>;
  /** Champs calculés en ordre topologique (dépendances d'abord). */
  calcs: CalcNode[];
}

/** Résolveur des références `{...}` d'une formule, selon le tableau où elle est évaluée. */
export function createResolver(byKey: Map<string, Entry>, table?: TableField): RefResolver {
  return (path): ReturnType<RefResolver> => {
    if (path.startsWith('$')) {
      return { error: `Référence réservée {${path}} : utiliser AUJOURDHUI(), UTILISATEUR()…` };
    }
    const [first, column] = path.split('.') as [string, string | undefined];
    const entry = byKey.get(first);
    if (!entry) return { error: `Champ inconnu : {${path}}` };

    if (column !== undefined) {
      if (entry.field.type !== 'table') return { error: `{${first}} n'est pas un tableau` };
      const cell = entry.field.fields.find((f) => f.key === column);
      if (!cell || !hasValue(cell)) return { error: `Colonne inconnue : {${path}}` };
      return { logic: { pluck: [{ var: first }, column] }, deps: [first, path] };
    }
    if (!hasValue(entry.field)) return { error: `{${path}} ne porte pas de valeur` };
    if (entry.table) {
      if (entry.table.key === table?.key) {
        return { logic: { var: `$row.${path}` }, deps: [`${entry.table.key}.${path}`] };
      }
      return {
        error: `{${path}} est une colonne du tableau {${entry.table.key}} : utiliser {${entry.table.key}.${path}} dans un agrégat`,
      };
    }
    return { logic: { var: path }, deps: [path] };
  };
}

function compileNodes(entries: Entry[], byKey: Map<string, Entry>): CalcNode[] {
  const nodes: CalcNode[] = [];
  for (const { field, table } of entries) {
    if (field.type !== 'calculated') continue;
    const id = table ? `${table.key}.${field.key}` : field.key;
    try {
      const { logic, deps } = compileFormula(field.formula, createResolver(byKey, table));
      nodes.push({ id, field, table, logic, deps });
    } catch (error) {
      const { message, position } = error as FormulaError;
      nodes.push({ id, field, table, deps: [], error: { code: 'formula', message, position } });
    }
  }
  return nodes;
}

/** Tri topologique ; les nœuds pris dans un cycle sont marqués en erreur (P1.2.3). */
function sortNodes(nodes: CalcNode[]): CalcNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const state = new Map<string, 'visiting' | 'done'>();
  const sorted: CalcNode[] = [];

  const visit = (node: CalcNode, stack: CalcNode[]): void => {
    const status = state.get(node.id);
    if (status === 'done') return;
    if (status === 'visiting') {
      const cycle = stack.slice(stack.indexOf(node));
      const description = [...cycle, node].map((n) => n.field.key).join(' → ');
      for (const member of cycle) {
        delete member.logic;
        member.error ??= { code: 'cycle', message: `Dépendance circulaire : ${description}` };
      }
      return;
    }
    state.set(node.id, 'visiting');
    for (const dep of node.deps) {
      const target = byId.get(dep);
      if (target) visit(target, [...stack, node]);
    }
    state.set(node.id, 'done');
    sorted.push(node);
  };

  nodes.forEach((node) => visit(node, []));
  return sorted;
}

export function buildModel(definition: StructureDefinition): Model {
  const entries = [...walkFields(definition.fields)];
  const byKey = new Map(entries.map((entry) => [entry.field.key, entry]));
  const rootValueKeys = new Set(
    entries.filter((e) => !e.table && hasValue(e.field)).map((e) => e.field.key),
  );
  return {
    definition,
    entries,
    byKey,
    rootValueKeys,
    calcs: sortNodes(compileNodes(entries, byKey)),
  };
}
