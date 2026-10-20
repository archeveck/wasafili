import { availableTransitions, checkTransition, createFormEngine } from '@wasafili/form-engine';
import {
  type StructureDefinition,
  type SubmissionData,
  type Workflow,
  type WorkflowTransition,
  walkFields,
} from '@wasafili/form-schema';
import { type StateCount } from '@wasafili/sdk';
import { Badge } from '@/components/ui/display';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function stateLabel(workflow: Workflow | undefined, state: string | null) {
  return workflow?.states.find((s) => s.key === state)?.label ?? state ?? '—';
}

export function StateBadge({
  workflow,
  state,
}: {
  workflow: Workflow | undefined;
  state: string | null;
}) {
  if (!workflow || state === null) return null;
  const color = workflow.states.find((s) => s.key === state)?.color;
  return <Badge color={color}>{stateLabel(workflow, state)}</Badge>;
}

/** Filtre par état avec compteurs (P4.3). */
export function StateFilter({
  workflow,
  counts,
  value,
  onChange,
}: {
  workflow: Workflow;
  counts: StateCount[];
  value: string | undefined;
  onChange: (state: string | undefined) => void;
}) {
  const count = (state: string) => counts.find((c) => c.state === state)?.count ?? 0;
  const total = counts.reduce((sum, c) => sum + c.count, 0);
  const chip = (key: string | undefined, label: string, n: number, color?: string) => (
    <button
      key={key ?? 'all'}
      type="button"
      aria-pressed={value === key}
      onClick={() => onChange(key)}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm',
        value === key ? 'border-primary bg-primary/10 font-medium' : 'border-border bg-surface',
      )}
    >
      {color && <span className="size-2 rounded-full" style={{ backgroundColor: color }} />}
      {label}
      <span className="text-muted">{n}</span>
    </button>
  );
  return (
    <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filtrer par état">
      {chip(undefined, 'Tous', total)}
      {workflow.states.map((s) => chip(s.key, s.label, count(s.key), s.color))}
    </div>
  );
}

/**
 * Vérifie une transition avec form-engine avant l'appel à l'API (le serveur revérifie) :
 * renvoie un message si des champs manquent, sinon `null`.
 */
export function transitionProblem(
  definition: StructureDefinition,
  values: SubmissionData,
  transition: WorkflowTransition,
  context: { state: string | null; userId?: string | undefined; roles: string[] },
): string | null {
  const engine = createFormEngine(definition);
  const check = checkTransition(engine, values, transition.key, {
    state: context.state,
    ...(context.userId ? { user: { id: context.userId, roles: context.roles } } : {}),
  });
  if (check.ok) return null;
  if (check.refusal) return `« ${transition.label} » n'est pas possible depuis cet état`;
  const labels = new Map(
    [...walkFields(definition.fields)].map(({ field }) => [field.key, field.label]),
  );
  const missing = [...new Set(check.errors.map((e) => labels.get(e.field) ?? e.field))];
  return `À compléter avant « ${transition.label} » : ${missing.join(', ')}`;
}

/** Boutons d'enregistrement du workflow, filtrés par état et par rôle. */
export function TransitionButtons({
  workflow,
  state,
  roles,
  disabled,
  onRun,
}: {
  workflow: Workflow | undefined;
  state: string | null;
  roles: string[];
  disabled?: boolean;
  onRun: (transition: WorkflowTransition) => void;
}) {
  return availableTransitions(workflow, state, roles).map((transition) => (
    <Button
      key={transition.key}
      type="button"
      disabled={disabled}
      style={transition.color ? { backgroundColor: transition.color } : undefined}
      onClick={() => {
        if (transition.confirm && !window.confirm(transition.confirm)) return;
        onRun(transition);
      }}
    >
      {transition.label}
    </Button>
  ));
}
