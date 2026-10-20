import {
  COMPUTED_TYPES,
  hasValue,
  type SimpleField,
  type SubmissionData,
  type TableField,
  valueSchema,
} from '@wasafili/form-schema';
import { type FieldState, type FormState } from './engine.js';
import { isEmpty } from './logic.js';
import { type Model } from './model.js';

export type ValidationCode =
  | 'required'
  | 'type'
  | 'unknown_field'
  | 'min_length'
  | 'max_length'
  | 'pattern'
  | 'email'
  | 'phone'
  | 'min'
  | 'max'
  | 'decimals'
  | 'step'
  | 'integer'
  | 'option'
  | 'min_items'
  | 'max_items'
  | 'accuracy'
  | 'min_rows'
  | 'max_rows';

/** Erreur localisable : le code et ses paramètres sont traduits par l'interface (i18n). */
export interface ValidationError {
  /** Chemin dans les données : `['cle']` ou `['tableau', indexLigne, 'colonne']`. */
  path: (string | number)[];
  field: string;
  code: ValidationCode;
  params?: Record<string, unknown>;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9][0-9 ().-]{4,19}$/;

type Check = [boolean, ValidationCode, Record<string, unknown>?];

function decimalsOf(value: number): number {
  const [, fraction = ''] = String(value).split('.');
  return fraction.length;
}

/** Contraintes métier d'une valeur déjà conforme à la forme attendue. */
function constraints(field: SimpleField, value: unknown): Check[] {
  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'barcode': {
      const text = value as string;
      const checks: Check[] = [];
      if ('minLength' in field && field.minLength !== undefined) {
        checks.push([text.length < field.minLength, 'min_length', { min: field.minLength }]);
      }
      if ('maxLength' in field && field.maxLength !== undefined) {
        checks.push([text.length > field.maxLength, 'max_length', { max: field.maxLength }]);
      }
      if ('pattern' in field && field.pattern !== undefined) {
        checks.push([
          !new RegExp(field.pattern).test(text),
          'pattern',
          { message: field.patternMessage },
        ]);
      }
      return checks;
    }
    case 'email':
      return [[!EMAIL.test(value as string), 'email']];
    case 'phone':
      return [[!PHONE.test(value as string), 'phone']];
    case 'number': {
      const number = value as number;
      return [
        [field.min !== undefined && number < field.min, 'min', { min: field.min }],
        [field.max !== undefined && number > field.max, 'max', { max: field.max }],
        [
          field.decimals !== undefined && decimalsOf(number) > field.decimals,
          'decimals',
          { max: field.decimals },
        ],
      ];
    }
    case 'slider': {
      const number = value as number;
      const steps = field.step === undefined ? 0 : (number - field.min) / field.step;
      return [
        [number < field.min, 'min', { min: field.min }],
        [number > field.max, 'max', { max: field.max }],
        [Math.abs(steps - Math.round(steps)) > 1e-9, 'step', { step: field.step }],
      ];
    }
    case 'rating': {
      const number = value as number;
      const max = field.max ?? 5;
      return [
        [!Number.isInteger(number), 'integer'],
        [number < 1, 'min', { min: 1 }],
        [number > max, 'max', { max }],
      ];
    }
    case 'date': {
      const date = value as string;
      return [
        [field.min !== undefined && date < field.min, 'min', { min: field.min }],
        [field.max !== undefined && date > field.max, 'max', { max: field.max }],
      ];
    }
    case 'select':
      return [[!field.options.some((option) => option.value === value), 'option']];
    case 'multiselect': {
      const values = value as string[];
      const options = new Set(field.options.map((option) => option.value));
      return [
        [values.some((item) => !options.has(item)), 'option'],
        [
          field.minItems !== undefined && values.length < field.minItems,
          'min_items',
          { min: field.minItems },
        ],
        [
          field.maxItems !== undefined && values.length > field.maxItems,
          'max_items',
          { max: field.maxItems },
        ],
      ];
    }
    case 'photo':
    case 'file': {
      const files = value as unknown[];
      return [
        [
          field.maxCount !== undefined && files.length > field.maxCount,
          'max_items',
          { max: field.maxCount },
        ],
      ];
    }
    case 'geolocation': {
      const accuracy = (value as { accuracy?: number }).accuracy;
      return [
        [
          field.maxAccuracy !== undefined &&
            (accuracy === undefined || accuracy > field.maxAccuracy),
          'accuracy',
          { max: field.maxAccuracy },
        ],
      ];
    }
    default:
      return [];
  }
}

function validateValue(
  field: SimpleField,
  value: unknown,
  state: FieldState,
  path: (string | number)[],
  errors: ValidationError[],
): void {
  const push = (code: ValidationCode, params?: Record<string, unknown>) =>
    errors.push({ path, field: field.key, code, ...(params ? { params } : {}) });

  if (isEmpty(value)) {
    if (state.required) push('required');
    return;
  }
  if (!valueSchema(field).safeParse(value).success) {
    push('type');
    return;
  }
  for (const [failed, code, params] of constraints(field, value)) {
    if (failed) push(code, params);
  }
}

function validateTable(
  table: TableField,
  value: unknown,
  state: FieldState,
  rowStates: Record<string, FieldState>[],
  errors: ValidationError[],
): void {
  const push = (
    path: (string | number)[],
    code: ValidationCode,
    params?: Record<string, unknown>,
  ) => errors.push({ path, field: table.key, code, ...(params ? { params } : {}) });

  if (isEmpty(value)) {
    if (state.required || (table.minRows ?? 0) > 0) push([table.key], 'required');
    return;
  }
  if (!Array.isArray(value)) {
    push([table.key], 'type');
    return;
  }
  if (table.minRows !== undefined && value.length < table.minRows) {
    push([table.key], 'min_rows', { min: table.minRows });
  }
  if (table.maxRows !== undefined && value.length > table.maxRows) {
    push([table.key], 'max_rows', { max: table.maxRows });
  }

  const cells = new Map(table.fields.filter(hasValue).map((cell) => [cell.key, cell]));
  value.forEach((row: unknown, index) => {
    const record = row as Record<string, unknown> | null;
    if (
      !record ||
      typeof record !== 'object' ||
      typeof record['_id'] !== 'string' ||
      !record['_id']
    ) {
      push([table.key, index], 'type');
      return;
    }
    for (const key of Object.keys(record)) {
      if (key !== '_id' && !cells.has(key)) {
        errors.push({ path: [table.key, index, key], field: key, code: 'unknown_field' });
      }
    }
    for (const cell of cells.values()) {
      const cellState = rowStates[index]![cell.key]!;
      if (!cellState.visible || COMPUTED_TYPES.has(cell.type)) continue;
      validateValue(cell, record[cell.key], cellState, [table.key, index, cell.key], errors);
    }
  });
}

/** Valide les données saisies au regard de l'état évalué du formulaire. */
export function validateState(
  model: Model,
  input: SubmissionData,
  state: FormState,
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const key of Object.keys(input)) {
    if (!model.rootValueKeys.has(key))
      errors.push({ path: [key], field: key, code: 'unknown_field' });
  }
  for (const { field, table } of model.entries) {
    if (table || !hasValue(field) || COMPUTED_TYPES.has(field.type)) continue;
    const fieldState = state.fields[field.key]!;
    if (!fieldState.visible) continue;
    if (field.type === 'table') {
      validateTable(field, input[field.key], fieldState, state.rows[field.key]!, errors);
    } else {
      validateValue(field as SimpleField, input[field.key], fieldState, [field.key], errors);
    }
  }
  return errors;
}
