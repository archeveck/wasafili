import { type SubmissionData, type Workflow, type WorkflowTransition } from '@tesserax/form-schema';
import { type EvaluationContext, type FormEngine } from './engine.js';
import { isEmpty } from './logic.js';
import { type ValidationError } from './validate.js';

/** Motif d'une transition impossible, indépendamment des données (P4.1.1). */
export type TransitionRefusal = 'no_workflow' | 'unknown_transition' | 'wrong_state' | 'role';

export interface TransitionCheck {
  /** Vrai si la transition peut être franchie avec ces données. */
  ok: boolean;
  transition?: WorkflowTransition;
  refusal?: TransitionRefusal;
  /** Erreurs de données : validation dans l'état courant + champs exigés par la transition. */
  errors: ValidationError[];
}

function rolesAllowed(transition: WorkflowTransition, roles: readonly string[]) {
  return !transition.roles?.length || roles.some((role) => transition.roles!.includes(role));
}

/** Transitions proposées (boutons) depuis un état, pour les rôles donnés. */
export function availableTransitions(
  workflow: Workflow | undefined,
  state: string | null | undefined,
  roles: readonly string[] = [],
): WorkflowTransition[] {
  if (!workflow || state == null) return [];
  return workflow.transitions.filter(
    (transition) => transition.from.includes(state) && rolesAllowed(transition, roles),
  );
}

/**
 * Vérifie une transition : état de départ, rôle, puis données. Les données sont validées dans
 * l'état courant (celui où l'utilisateur les a saisies) ; les champs exigés par la transition
 * doivent en plus être renseignés, même s'ils ne sont pas requis par ailleurs.
 */
export function checkTransition(
  engine: FormEngine,
  values: SubmissionData,
  transitionKey: string,
  context: EvaluationContext = {},
): TransitionCheck {
  const workflow = engine.model.definition.workflow;
  if (!workflow) return { ok: false, refusal: 'no_workflow', errors: [] };
  const transition = workflow.transitions.find((t) => t.key === transitionKey);
  if (!transition) return { ok: false, refusal: 'unknown_transition', errors: [] };
  if (context.state == null || !transition.from.includes(context.state)) {
    return { ok: false, transition, refusal: 'wrong_state', errors: [] };
  }
  if (!rolesAllowed(transition, context.user?.roles ?? [])) {
    return { ok: false, transition, refusal: 'role', errors: [] };
  }
  const result = engine.validate(values, context);
  const errors = [...result.errors];
  const reported = new Set(errors.filter((e) => e.path.length === 1).map((e) => e.field));
  for (const key of transition.requiredFields ?? []) {
    if (!reported.has(key) && isEmpty(result.state.values[key])) {
      errors.push({
        path: [key],
        field: key,
        code: 'required',
        params: { transition: transition.key },
      });
    }
  }
  return { ok: errors.length === 0, transition, errors };
}
