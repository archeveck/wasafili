import { inspectionWorkflow } from '@wasafili/form-schema';
import { describe, expect, it } from 'vitest';
import { createFormEngine } from './engine.js';
import { definition, field } from './test-utils.js';
import { availableTransitions, checkTransition } from './workflow.js';

const workflow = {
  ...inspectionWorkflow,
  transitions: inspectionWorkflow.transitions.map((t) =>
    t.key === 'rejeter' ? { ...t, requiredFields: ['motif'] } : t,
  ),
};
const engine = createFormEngine(
  definition([field('text', 'nom', { required: true }), field('text', 'motif')], { workflow }),
);
const superviseur = { user: { id: 'u1', roles: ['superviseur'] } };

describe('availableTransitions', () => {
  it("propose les transitions de l'état courant permises au rôle", () => {
    const keys = (state: string | null, roles?: string[]) =>
      availableTransitions(workflow, state, roles).map((t) => t.key);
    expect(keys('brouillon')).toEqual(['soumettre']);
    expect(keys('soumis')).toEqual([]);
    expect(keys('soumis', ['superviseur'])).toEqual(['valider', 'rejeter']);
    expect(keys(null)).toEqual([]);
    expect(availableTransitions(undefined, 'brouillon')).toEqual([]);
  });
});

describe('checkTransition', () => {
  it('refuse sans workflow, transition inconnue, mauvais état ou rôle', () => {
    const bare = createFormEngine(definition([field('text', 'nom')]));
    expect(checkTransition(bare, {}, 'soumettre').refusal).toBe('no_workflow');
    expect(checkTransition(engine, {}, 'inconnue', { state: 'brouillon' }).refusal).toBe(
      'unknown_transition',
    );
    expect(checkTransition(engine, { nom: 'x' }, 'valider', { state: 'brouillon' })).toMatchObject({
      ok: false,
      refusal: 'wrong_state',
      transition: { key: 'valider' },
    });
    expect(checkTransition(engine, { nom: 'x' }, 'soumettre', {}).refusal).toBe('wrong_state');
    expect(checkTransition(engine, { nom: 'x' }, 'valider', { state: 'soumis' }).refusal).toBe(
      'role',
    );
  });

  it('valide les données dans l’état courant et exige les champs de la transition', () => {
    expect(checkTransition(engine, { nom: 'x' }, 'soumettre', { state: 'brouillon' })).toEqual({
      ok: true,
      transition: workflow.transitions[0],
      errors: [],
    });
    expect(
      checkTransition(engine, {}, 'rejeter', { ...superviseur, state: 'soumis' }).errors,
    ).toEqual([
      { path: ['nom'], field: 'nom', code: 'required' },
      { path: ['motif'], field: 'motif', code: 'required', params: { transition: 'rejeter' } },
    ]);
    expect(
      checkTransition(engine, { nom: 'x', motif: 'flou' }, 'rejeter', {
        ...superviseur,
        state: 'soumis',
      }).ok,
    ).toBe(true);
  });

  it('ne signale pas deux fois un champ déjà en erreur', () => {
    const strict = createFormEngine(
      definition([field('text', 'motif', { required: true })], {
        workflow: {
          ...workflow,
          transitions: [{ ...workflow.transitions[0]!, requiredFields: ['motif'] }],
        },
      }),
    );
    expect(checkTransition(strict, {}, 'soumettre', { state: 'brouillon' }).errors).toEqual([
      { path: ['motif'], field: 'motif', code: 'required' },
    ]);
  });
});
