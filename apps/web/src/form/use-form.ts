import { type EvaluationContext } from '@wasafili/form-engine';
import { useFormEngine } from '@wasafili/form-renderer';
import { type StructureDefinition, type SubmissionData } from '@wasafili/form-schema';
import { useMemo } from 'react';
import { useApp } from '@/lib/use-app';

/** `useFormEngine` avec le contexte de l'appelant (utilisateur, rôles, fuseau de l'instance). */
export function useFormRenderer(
  definition: StructureDefinition,
  options: {
    isNew?: boolean;
    initialValues?: SubmissionData;
    userId?: string;
    roles?: string[];
    state?: string | null;
  },
) {
  const { timeZone } = useApp();
  const context = useMemo<EvaluationContext>(
    () => ({
      ...(options.userId ? { user: { id: options.userId, roles: options.roles ?? [] } } : {}),
      state: options.state ?? null,
      timeZone,
    }),
    [options.userId, options.roles, options.state, timeZone],
  );
  return useFormEngine(definition, {
    context,
    ...(options.isNew !== undefined ? { isNew: options.isNew } : {}),
    ...(options.initialValues ? { initialValues: options.initialValues } : {}),
  });
}
