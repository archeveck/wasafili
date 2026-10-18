import {
  createFormEngine,
  type EvaluationContext,
  type FormState,
  type ValidationError,
} from '@tesserax/form-engine';
import {
  type StructureDefinition,
  type SubmissionData,
  type TableRow,
} from '@tesserax/form-schema';
import { useCallback, useMemo, useState } from 'react';

export interface UseFormEngineOptions {
  initialValues?: SubmissionData;
  context?: EvaluationContext;
  /** Nouvelle fiche : valeurs par défaut et champs automatiques appliqués. */
  isNew?: boolean;
  /** Générateur d'identifiants de lignes (UUID côté client). */
  newId?: () => string;
}

export interface FormController {
  values: SubmissionData;
  state: FormState;
  /** Erreurs de validation de l'état courant (affichées une fois `submitted`). */
  errors: ValidationError[];
  submitted: boolean;
  dirty: boolean;
  setValue: (key: string, value: unknown) => void;
  setCell: (tableKey: string, rowIndex: number, key: string, value: unknown) => void;
  addRow: (tableKey: string) => void;
  removeRow: (tableKey: string, rowIndex: number) => void;
  /** Valide et marque le formulaire comme soumis ; renvoie les valeurs calculées si valide. */
  submit: () =>
    { valid: true; values: SubmissionData } | { valid: false; errors: ValidationError[] };
  reset: (values?: SubmissionData) => void;
}

/**
 * État d'un formulaire piloté par @tesserax/form-engine (P2.2.3). Sans dépendance DOM :
 * utilisable tel quel par l'application mobile.
 */
export function useFormEngine(
  definition: StructureDefinition,
  options: UseFormEngineOptions = {},
): FormController {
  const engine = useMemo(() => createFormEngine(definition), [definition]);
  const context = options.context;
  const newId =
    options.newId ??
    (() => {
      const crypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
      if (!crypto?.randomUUID) throw new Error('newId requis : crypto.randomUUID indisponible');
      return crypto.randomUUID();
    });
  const initial = () =>
    options.isNew
      ? engine.applyDefaults(options.initialValues ?? {}, context, { isNew: true })
      : (options.initialValues ?? {});

  const [values, setValues] = useState<SubmissionData>(initial);
  const [submitted, setSubmitted] = useState(false);
  const [dirty, setDirty] = useState(false);

  const result = useMemo(() => engine.validate(values, context), [engine, values, context]);

  const update = useCallback((next: (current: SubmissionData) => SubmissionData) => {
    setValues(next);
    setDirty(true);
  }, []);

  const rows = (current: SubmissionData, tableKey: string): TableRow[] =>
    Array.isArray(current[tableKey]) ? [...(current[tableKey] as TableRow[])] : [];

  return {
    values: result.state.values,
    state: result.state,
    errors: result.errors,
    submitted,
    dirty,
    setValue: (key, value) => update((current) => ({ ...current, [key]: value })),
    setCell: (tableKey, rowIndex, key, value) =>
      update((current) => {
        const next = rows(current, tableKey);
        next[rowIndex] = { ...next[rowIndex]!, [key]: value };
        return { ...current, [tableKey]: next };
      }),
    addRow: (tableKey) =>
      update((current) => ({
        ...current,
        [tableKey]: [...rows(current, tableKey), engine.createRow(tableKey, newId(), context)],
      })),
    removeRow: (tableKey, rowIndex) =>
      update((current) => ({
        ...current,
        [tableKey]: rows(current, tableKey).filter((_, index) => index !== rowIndex),
      })),
    submit: () => {
      setSubmitted(true);
      return result.valid
        ? { valid: true, values: result.state.values }
        : { valid: false, errors: result.errors };
    },
    reset: (next) => {
      setValues(next ?? initial());
      setSubmitted(false);
      setDirty(false);
    },
  };
}
