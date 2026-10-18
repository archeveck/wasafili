import {
  type Field,
  type StructureDefinition,
  type Workflow,
  type WorkflowState,
  type WorkflowTransition,
} from '@tesserax/form-schema';
import { uniqueKey } from './model';

/**
 * Opérations pures de l'éditeur de workflow (P4.2). Elles gardent la définition cohérente :
 * renommer ou supprimer un état met à jour les transitions et les champs qui le référencent.
 */

const STATE_LISTS = ['visibleInStates', 'editableInStates'] as const;

function mapFields(fields: Field[], fn: (field: Field) => Field): Field[] {
  return fields.map((field) => {
    const next = fn(field);
    return next.type === 'section' || next.type === 'table'
      ? ({ ...next, fields: mapFields(next.fields as Field[], fn) } as Field)
      : next;
  });
}

/** Remplace (ou retire, `to` absent) un état dans les listes d'états des champs. */
function renameInFields(fields: Field[], from: string, to?: string): Field[] {
  return mapFields(fields, (field) => {
    let next = field;
    for (const list of STATE_LISTS) {
      const states = field[list];
      if (!states?.includes(from)) continue;
      const replaced = states.flatMap((s) => (s === from ? (to ? [to] : []) : [s]));
      next = { ...next, [list]: replaced.length ? replaced : undefined };
    }
    return next;
  });
}

function withWorkflow(definition: StructureDefinition, workflow: Workflow): StructureDefinition {
  return { ...definition, workflow };
}

/**
 * Positions des états sans position enregistrée : niveaux à partir de l'état initial (un
 * niveau par transition franchie), états d'un même niveau empilés.
 */
export function layoutStates(workflow: Workflow): Map<string, { x: number; y: number }> {
  const depth = new Map<string, number>();
  const start = workflow.states.find((s) => s.initial) ?? workflow.states[0];
  const queue = start ? [start.key] : [];
  if (start) depth.set(start.key, 0);
  while (queue.length) {
    const key = queue.shift()!;
    for (const t of workflow.transitions) {
      if (t.from.includes(key) && !depth.has(t.to)) {
        depth.set(t.to, depth.get(key)! + 1);
        queue.push(t.to);
      }
    }
  }
  const unreachable = Math.max(0, ...depth.values()) + 1;
  const rows = new Map<number, number>();
  const positions = new Map<string, { x: number; y: number }>();
  for (const state of workflow.states) {
    const level = depth.get(state.key) ?? unreachable;
    const row = rows.get(level) ?? 0;
    rows.set(level, row + 1);
    positions.set(state.key, state.position ?? { x: level * 260, y: row * 140 });
  }
  return positions;
}

export function defaultWorkflow(): Workflow {
  return {
    states: [
      {
        key: 'brouillon',
        label: 'Brouillon',
        color: '#5B6470',
        initial: true,
        position: { x: 0, y: 0 },
      },
    ],
    transitions: [],
  };
}

/** Retire le workflow et les règles par état des champs. */
export function removeWorkflow(definition: StructureDefinition): StructureDefinition {
  const { workflow: _workflow, ...rest } = definition;
  return {
    ...rest,
    fields: mapFields(definition.fields, (field) => {
      const { visibleInStates: _v, editableInStates: _e, ...clean } = field;
      return clean as Field;
    }),
  };
}

export function addState(
  definition: StructureDefinition,
  label: string,
): {
  definition: StructureDefinition;
  key: string;
} {
  const workflow = definition.workflow ?? defaultWorkflow();
  const key = uniqueKey(label, new Set(workflow.states.map((s) => s.key)));
  const last = workflow.states.at(-1)?.position ?? { x: 0, y: 0 };
  const state: WorkflowState = { key, label, position: { x: last.x + 240, y: last.y } };
  return {
    definition: withWorkflow(definition, { ...workflow, states: [...workflow.states, state] }),
    key,
  };
}

export function updateState(
  definition: StructureDefinition,
  key: string,
  patch: Partial<WorkflowState>,
): StructureDefinition {
  const workflow = definition.workflow!;
  const renamed = patch.key !== undefined && patch.key !== key ? patch.key : undefined;
  const states = workflow.states.map((state) => {
    if (state.key === key) return { ...state, ...patch };
    // Un seul état initial.
    return patch.initial ? { ...state, initial: undefined } : state;
  });
  const transitions = renamed
    ? workflow.transitions.map((t) => ({
        ...t,
        from: t.from.map((f) => (f === key ? renamed : f)),
        to: t.to === key ? renamed : t.to,
      }))
    : // Un état final n'a pas de transition sortante.
      patch.final
      ? workflow.transitions
          .map((t) => ({ ...t, from: t.from.filter((f) => f !== key) }))
          .filter((t) => t.from.length > 0)
      : workflow.transitions;
  return {
    ...definition,
    fields: renamed ? renameInFields(definition.fields, key, renamed) : definition.fields,
    workflow: { states, transitions },
  };
}

export function removeState(definition: StructureDefinition, key: string): StructureDefinition {
  const workflow = definition.workflow!;
  const removed = workflow.states.find((s) => s.key === key);
  const states = workflow.states.filter((s) => s.key !== key);
  // L'état initial supprimé passe au premier état restant.
  if (removed?.initial && states[0]) states[0] = { ...states[0], initial: true };
  const transitions = workflow.transitions
    .filter((t) => t.to !== key)
    .map((t) => ({ ...t, from: t.from.filter((f) => f !== key) }))
    .filter((t) => t.from.length > 0);
  return {
    ...definition,
    fields: renameInFields(definition.fields, key),
    workflow: { states, transitions },
  };
}

export function addTransition(
  definition: StructureDefinition,
  from: string,
  to: string,
): { definition: StructureDefinition; key: string } {
  const workflow = definition.workflow!;
  const target = workflow.states.find((s) => s.key === to)!;
  const key = uniqueKey(`vers_${to}`, new Set(workflow.transitions.map((t) => t.key)));
  const transition: WorkflowTransition = { key, label: target.label, from: [from], to };
  return {
    definition: withWorkflow(definition, {
      ...workflow,
      transitions: [...workflow.transitions, transition],
    }),
    key,
  };
}

export function updateTransition(
  definition: StructureDefinition,
  key: string,
  patch: Partial<WorkflowTransition>,
): StructureDefinition {
  const workflow = definition.workflow!;
  return withWorkflow(definition, {
    ...workflow,
    transitions: workflow.transitions.map((t) => (t.key === key ? { ...t, ...patch } : t)),
  });
}

export function removeTransition(
  definition: StructureDefinition,
  key: string,
): StructureDefinition {
  const workflow = definition.workflow!;
  return withWorkflow(definition, {
    ...workflow,
    transitions: workflow.transitions.filter((t) => t.key !== key),
  });
}
