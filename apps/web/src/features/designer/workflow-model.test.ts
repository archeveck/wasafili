import { inspectionWorkflow, structureDefinitionSchema } from '@wasafili/form-schema';
import { describe, expect, it } from 'vitest';
import {
  addState,
  addTransition,
  defaultWorkflow,
  layoutStates,
  removeState,
  removeTransition,
  removeWorkflow,
  updateState,
  updateTransition,
} from './workflow-model';

const definition = () =>
  structureDefinitionSchema.parse({
    schemaVersion: 1,
    workflow: inspectionWorkflow,
    fields: [
      {
        id: 's',
        key: 'bloc',
        type: 'section',
        label: 'Bloc',
        fields: [
          {
            id: 'm',
            key: 'motif',
            type: 'text',
            label: 'Motif',
            visibleInStates: ['soumis', 'rejete'],
            editableInStates: ['rejete'],
          },
        ],
      },
    ],
  });

const valid = (d: unknown) => structureDefinitionSchema.safeParse(d).success;
const motif = (d: ReturnType<typeof definition>) =>
  (d.fields[0] as { fields: Record<string, unknown>[] }).fields[0]!;

describe('workflow-model', () => {
  it('ajoute des états à clé unique et des transitions', () => {
    const base = { schemaVersion: 1 as const, fields: [] };
    const first = addState({ ...base, workflow: defaultWorkflow() }, 'À valider');
    expect(first.key).toBe('a_valider');
    const second = addState(first.definition, 'À valider');
    expect(second.key).toBe('a_valider_2');
    const linked = addTransition(second.definition, 'brouillon', 'a_valider');
    expect(linked.definition.workflow!.transitions).toEqual([
      { key: 'a_valider', label: 'À valider', from: ['brouillon'], to: 'a_valider' },
    ]);
    expect(valid(linked.definition)).toBe(true);
    // Sans workflow, le premier état crée le workflow par défaut.
    expect(addState(base, 'Soumis').definition.workflow!.states.map((s) => s.key)).toEqual([
      'brouillon',
      'soumis',
    ]);
  });

  it('renomme un état partout où il est référencé', () => {
    const next = updateState(definition(), 'rejete', { key: 'a_reprendre', label: 'À reprendre' });
    expect(next.workflow!.transitions.find((t) => t.key === 'soumettre')!.from).toEqual([
      'brouillon',
      'a_reprendre',
    ]);
    expect(next.workflow!.transitions.find((t) => t.key === 'rejeter')!.to).toBe('a_reprendre');
    expect(motif(next)).toMatchObject({
      visibleInStates: ['soumis', 'a_reprendre'],
      editableInStates: ['a_reprendre'],
    });
    expect(valid(next)).toBe(true);
  });

  it('garde un seul état initial et aucune transition depuis un état final', () => {
    const initial = updateState(definition(), 'soumis', { initial: true });
    expect(initial.workflow!.states.filter((s) => s.initial).map((s) => s.key)).toEqual(['soumis']);
    const final = updateState(definition(), 'rejete', { final: true });
    expect(final.workflow!.transitions.find((t) => t.key === 'soumettre')!.from).toEqual([
      'brouillon',
    ]);
    expect(valid(final)).toBe(true);
  });

  it('supprime un état, ses transitions et ses références', () => {
    const next = removeState(definition(), 'rejete');
    expect(next.workflow!.transitions.map((t) => t.key)).toEqual(['soumettre', 'valider']);
    expect(motif(next)).toMatchObject({ visibleInStates: ['soumis'] });
    expect(motif(next)['editableInStates']).toBeUndefined();
    const noInitial = removeState(definition(), 'brouillon');
    expect(noInitial.workflow!.states[0]).toMatchObject({ key: 'soumis', initial: true });
    expect(valid(next) && valid(noInitial)).toBe(true);
  });

  it('dispose par niveaux les états sans position', () => {
    const positions = layoutStates(inspectionWorkflow);
    expect(Object.fromEntries(positions)).toEqual({
      brouillon: { x: 0, y: 0 },
      soumis: { x: 260, y: 0 },
      valide: { x: 520, y: 0 },
      rejete: { x: 520, y: 140 },
    });
    const placed = updateState(definition(), 'soumis', { position: { x: 5, y: 6 } });
    expect(layoutStates(placed.workflow!).get('soumis')).toEqual({ x: 5, y: 6 });
  });

  it('modifie et supprime une transition, ou tout le workflow', () => {
    const edited = updateTransition(definition(), 'valider', {
      label: 'Approuver',
      roles: ['admin'],
    });
    expect(edited.workflow!.transitions[1]).toMatchObject({ label: 'Approuver', roles: ['admin'] });
    expect(removeTransition(edited, 'valider').workflow!.transitions).toHaveLength(2);
    const bare = removeWorkflow(definition());
    expect(bare.workflow).toBeUndefined();
    expect(motif(bare)['visibleInStates']).toBeUndefined();
    expect(valid(bare)).toBe(true);
  });
});
