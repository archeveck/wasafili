import {
  COMPUTED_TYPES,
  type Field,
  NON_VALUE_TYPES,
  type StructureDefinition,
  type SubmissionData,
  type TableRow,
} from '@tesserax/form-schema';
import { dayIn, dayNumber, timeIn } from './dates.js';
import { type Data, evaluate, roundTo, toNumber, truthy } from './logic.js';
import { buildModel, type CalcNode, type CalculatedField, type Model } from './model.js';
import { validateState, type ValidationError } from './validate.js';

export const DEFAULT_TIME_ZONE = 'Africa/Abidjan';

/** Contexte d'évaluation, identique sur le serveur, le web et le mobile (P1.2.2). */
export interface EvaluationContext {
  user?: { id: string; roles?: readonly string[] };
  /** État de workflow courant de la fiche. */
  state?: string | null;
  /** Instant de référence (déterminisme) ; par défaut l'horloge locale. */
  now?: Date | string;
  timeZone?: string;
}

export interface FieldState {
  visible: boolean;
  required: boolean;
  readOnly: boolean;
}

export interface FormState {
  /** Valeurs saisies complétées des valeurs calculées. */
  values: SubmissionData;
  /** État des champs hors tableaux (sections comprises), par clé. */
  fields: Record<string, FieldState>;
  /** État des colonnes de chaque tableau, ligne par ligne. */
  rows: Record<string, Record<string, FieldState>[]>;
}

export interface EvaluateOptions {
  /**
   * Clés modifiées depuis l'évaluation précédente (`cle`, `tableau` ou `tableau.colonne`) :
   * seuls les calculs qui en dépendent sont refaits. `values` doit alors contenir les valeurs
   * calculées précédentes.
   */
  changed?: readonly string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  state: FormState;
}

const ROOT: FieldState = { visible: true, required: false, readOnly: false };

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function allowed(list: readonly string[] | undefined, value: string | null | undefined) {
  return !list?.length || (value != null && list.includes(value));
}

function rolesAllowed(list: readonly string[] | undefined, roles: readonly string[]) {
  return !list?.length || roles.some((role) => list.includes(role));
}

function coerce(result: unknown, field: CalculatedField): unknown {
  if (result === null || result === undefined) return null;
  switch (field.resultType) {
    case 'number': {
      const number = toNumber(result);
      if (number === null) return null;
      return field.decimals === undefined ? number : roundTo(number, field.decimals);
    }
    case 'text':
      return Array.isArray(result) ? result.join(', ') : String(result);
    case 'boolean':
      return truthy(result);
    case 'date':
      return typeof result === 'string' && dayNumber(result) !== null ? result.slice(0, 10) : null;
  }
}

export class FormEngine {
  readonly model: Model;

  constructor(definition: StructureDefinition) {
    this.model = buildModel(definition);
  }

  /** Variables d'environnement des expressions : `$user`, `$state`, `$now`, `$today`. */
  environment(context: EvaluationContext = {}): Data {
    const now = context.now === undefined ? new Date() : new Date(context.now);
    return {
      $user: { id: context.user?.id ?? null, roles: [...(context.user?.roles ?? [])] },
      $state: context.state ?? null,
      $now: now.toISOString(),
      $today: dayIn(now, context.timeZone ?? DEFAULT_TIME_ZONE),
    };
  }

  /** Calcule les champs calculés (racine et lignes de tableaux), en ordre de dépendance. */
  calculate(
    values: SubmissionData,
    context: EvaluationContext = {},
    options: EvaluateOptions = {},
  ): SubmissionData {
    return this.run(values, context, options).values;
  }

  /** Valeurs calculées + visibilité, caractère requis et lecture seule de chaque champ. */
  evaluate(
    values: SubmissionData,
    context: EvaluationContext = {},
    options: EvaluateOptions = {},
  ): FormState {
    const { values: computed, data } = this.run(values, context, options);
    const roles = context.user?.roles ?? [];
    const fields: Record<string, FieldState> = {};
    const rows: Record<string, Record<string, FieldState>[]> = {};

    const stateOf = (field: Field, parent: FieldState, scope: Data): FieldState => {
      const condition = (logic: Field['visibleIf'], fallback: boolean) =>
        logic ? truthy(evaluate(logic, scope)) : fallback;
      const visible =
        parent.visible &&
        field.type !== 'hidden' &&
        allowed(field.visibleInStates, context.state) &&
        rolesAllowed(field.visibleToRoles, roles) &&
        condition(field.visibleIf, true);
      const computedType = COMPUTED_TYPES.has(field.type);
      return {
        visible,
        required:
          visible &&
          !computedType &&
          !NON_VALUE_TYPES.has(field.type) &&
          (field.required === true || condition(field.requiredIf, false)),
        readOnly:
          parent.readOnly ||
          computedType ||
          field.readOnly === true ||
          !allowed(field.editableInStates, context.state) ||
          !rolesAllowed(field.editableByRoles, roles),
      };
    };

    for (const { field, section, table } of this.model.entries) {
      if (table) continue;
      fields[field.key] = stateOf(field, section ? fields[section.key]! : ROOT, data);
      if (field.type === 'table') {
        const tableState = fields[field.key]!;
        const tableRows = Array.isArray(computed[field.key])
          ? (computed[field.key] as unknown[])
          : [];
        rows[field.key] = tableRows.map((row) => {
          const scope = this.rowScope(data, isObject(row) ? row : {});
          return Object.fromEntries(
            field.fields.map((cell) => [cell.key, stateOf(cell, tableState, scope)]),
          );
        });
      }
    }
    return { values: computed, fields, rows };
  }

  /** Validation complète (P1.2.5) : un champ masqué n'est ni requis ni validé. */
  validate(
    values: SubmissionData,
    context: EvaluationContext = {},
    options: EvaluateOptions = {},
  ): ValidationResult {
    const state = this.evaluate(values, context, options);
    const errors = validateState(this.model, values, state);
    return { valid: errors.length === 0, errors, state };
  }

  /**
   * Valeurs par défaut et champs automatiques (P1.2.6). Une valeur déjà présente n'est jamais
   * écrasée, sauf l'horodatage « dernière modification ». Le serveur fait foi pour les champs
   * automatiques (auteur, horodatages).
   */
  applyDefaults(
    values: SubmissionData,
    context: EvaluationContext = {},
    options: { isNew?: boolean } = {},
  ): SubmissionData {
    const result: SubmissionData = { ...values };
    for (const { field, table } of this.model.entries) {
      if (table || NON_VALUE_TYPES.has(field.type)) continue;
      const value = this.defaultFor(field, context, options.isNew ?? true, result[field.key]);
      if (value !== undefined) result[field.key] = value;
    }
    return result;
  }

  /** Nouvelle ligne de tableau avec ses valeurs par défaut ; l'identifiant vient de l'appelant. */
  createRow(tableKey: string, rowId: string, context: EvaluationContext = {}): TableRow {
    const entry = this.model.byKey.get(tableKey);
    if (entry?.field.type !== 'table') throw new Error(`Tableau inconnu : ${tableKey}`);
    const row: TableRow = { _id: rowId };
    for (const cell of entry.field.fields) {
      const value = this.defaultFor(cell, context, true, undefined);
      if (value !== undefined) row[cell.key] = value;
    }
    return row;
  }

  private defaultFor(
    field: Field,
    context: EvaluationContext,
    isNew: boolean,
    current: unknown,
  ): unknown {
    const now = () => (context.now === undefined ? new Date() : new Date(context.now));
    const timeZone = context.timeZone ?? DEFAULT_TIME_ZONE;
    if (field.type === 'timestamp' && field.mode === 'updated') return now().toISOString();
    if (current !== undefined) return undefined;
    switch (field.type) {
      case 'timestamp':
        return isNew ? now().toISOString() : undefined;
      case 'author':
        return isNew ? context.user?.id : undefined;
      case 'date':
        return field.defaultValue ?? (field.defaultNow ? dayIn(now(), timeZone) : undefined);
      case 'time':
        return field.defaultValue ?? (field.defaultNow ? timeIn(now(), timeZone) : undefined);
      case 'datetime':
        return field.defaultValue ?? (field.defaultNow ? now().toISOString() : undefined);
      case 'multiselect':
        return field.defaultValue ? [...field.defaultValue] : undefined;
      default:
        return 'defaultValue' in field ? field.defaultValue : undefined;
    }
  }

  private rowScope(data: Data, row: Record<string, unknown>): Data {
    // Héritage prototypal : la ligne courante est visible via `$row` sans copier `data`.
    return Object.assign(Object.create(data) as Data, { $row: row });
  }

  private run(values: SubmissionData, context: EvaluationContext, options: EvaluateOptions) {
    const data: Data = { ...values, ...this.environment(context) };
    const dirty = options.changed ? new Set(options.changed) : undefined;
    const affected = (node: CalcNode) =>
      !dirty ||
      node.deps.some((dep) => [...dirty].some((key) => dep === key || dep.startsWith(`${key}.`)));

    for (const node of this.model.calcs) {
      if (!affected(node)) continue;
      dirty?.add(node.id);
      if (node.table) {
        const tableKey = node.table.key;
        const rows = data[tableKey];
        if (!Array.isArray(rows)) continue;
        data[tableKey] = rows.map((row: unknown) =>
          isObject(row)
            ? {
                ...row,
                [node.field.key]: node.logic
                  ? coerce(evaluate(node.logic, this.rowScope(data, row)), node.field)
                  : null,
              }
            : row,
        );
      } else {
        data[node.field.key] = node.logic ? coerce(evaluate(node.logic, data), node.field) : null;
      }
    }

    const computed: SubmissionData = {};
    for (const [key, value] of Object.entries(data)) {
      if (!key.startsWith('$')) computed[key] = value;
    }
    return { values: computed, data };
  }
}

export function createFormEngine(definition: StructureDefinition): FormEngine {
  return new FormEngine(definition);
}
