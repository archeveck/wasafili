import {
  type Condition,
  hasValue,
  type StructureDefinition,
  structureDefinitionSchema,
} from '@tesserax/form-schema';
import { inspectLogic } from './logic.js';
import { buildModel, type Entry, type Model } from './model.js';

export type DefinitionIssueCode =
  'schema' | 'formula' | 'cycle' | 'unknown_operator' | 'unknown_reference' | 'invalid_parent';

export interface DefinitionIssue {
  code: DefinitionIssueCode;
  message: string;
  path: PropertyKey[];
  /** Clé du champ concerné. */
  field?: string;
  /** Position dans la formule (erreurs de formule). */
  position?: number;
}

export type AnalysisResult =
  | { ok: true; definition: StructureDefinition; issues: [] }
  | { ok: false; issues: DefinitionIssue[] };

const ENVIRONMENT_VARS = new Set(['$state', '$now', '$today', '$user.id', '$user.roles']);

function isKnownVar(path: string, entry: Entry, model: Model): boolean {
  if (ENVIRONMENT_VARS.has(path)) return true;
  if (path.startsWith('$row.')) {
    const [column] = path.slice('$row.'.length).split('.');
    return entry.table?.fields.some((cell) => cell.key === column && hasValue(cell)) ?? false;
  }
  // `position.lat`, `photos.0` : seul le premier segment désigne un champ.
  const target = model.byKey.get(path.split('.')[0]!);
  return target !== undefined && !target.table && hasValue(target.field);
}

/**
 * Analyse complète d'une définition avant enregistrement : schéma, formules (compilation,
 * références, cycles), conditions (opérateurs, références) et cascades de référentiels.
 */
export function analyzeDefinition(input: unknown): AnalysisResult {
  const parsed = structureDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        code: 'schema',
        message: issue.message,
        path: issue.path,
      })),
    };
  }

  const model = buildModel(parsed.data);
  const issues: DefinitionIssue[] = [];

  // Ordre d'affichage des champs (et non ordre topologique) : plus lisible dans le designer.
  const order = new Map(model.entries.map((entry, index) => [entry.field, index]));
  const failed = model.calcs
    .filter((node) => node.error)
    .sort((a, b) => order.get(a.field)! - order.get(b.field)!);
  for (const node of failed) {
    const error = node.error!;
    issues.push({
      code: error.code,
      message: `${node.field.key} : ${error.message}`,
      path: ['fields'],
      field: node.field.key,
      ...(error.position !== undefined ? { position: error.position } : {}),
    });
  }

  for (const entry of model.entries) {
    const { field } = entry;
    const conditions: [string, Condition | undefined][] = [
      ['visibleIf', field.visibleIf],
      ['requiredIf', field.requiredIf],
    ];
    for (const [name, condition] of conditions) {
      if (!condition) continue;
      const { vars, issues: logicIssues } = inspectLogic(condition);
      for (const issue of logicIssues) {
        issues.push({
          code: 'unknown_operator',
          message: `${field.key}.${name} : opérateur non autorisé (${issue.detail})`,
          path: ['fields'],
          field: field.key,
        });
      }
      for (const path of vars) {
        if (!isKnownVar(path, entry, model)) {
          issues.push({
            code: 'unknown_reference',
            message: `${field.key}.${name} : référence inconnue « ${path} »`,
            path: ['fields'],
            field: field.key,
          });
        }
      }
    }

    if (field.type === 'list' && field.parentField !== undefined) {
      const parent = model.byKey.get(field.parentField);
      const problem =
        parent?.field.type !== 'list'
          ? 'le champ parent doit être un champ référentiel'
          : parent.field.listId !== field.listId
            ? 'le champ parent doit utiliser le même référentiel'
            : parent.table?.key !== entry.table?.key
              ? 'le champ parent doit être au même niveau (racine ou même tableau)'
              : parent.field.level !== undefined &&
                  field.level !== undefined &&
                  parent.field.level >= field.level
                ? 'le niveau du parent doit être inférieur'
                : undefined;
      if (problem) {
        issues.push({
          code: 'invalid_parent',
          message: `${field.key} : ${problem}`,
          path: ['fields'],
          field: field.key,
        });
      }
    }
  }

  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, definition: parsed.data, issues: [] };
}
