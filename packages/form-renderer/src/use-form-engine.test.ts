import { act, renderHook } from '@testing-library/react';
import { inspectionEquipement } from '@wasafili/form-schema';
import { describe, expect, it } from 'vitest';
import { errorsAt, validationMessage } from './messages.js';
import { useFormEngine } from './use-form-engine.js';

const definition = inspectionEquipement({ listId: 'l' });
const context = { now: '2026-10-18T09:00:00Z', user: { id: 'u1', roles: ['technicien'] } };

describe('useFormEngine', () => {
  it('applique les défauts d une nouvelle fiche et réévalue à chaque saisie', () => {
    let ids = 0;
    const { result } = renderHook(() =>
      useFormEngine(definition, { isNew: true, context, newId: () => `r${++ids}` }),
    );
    expect(result.current.values['date_inspection']).toBe('2026-10-18');
    expect(result.current.state.fields['description_defaut']!.visible).toBe(false);

    act(() => result.current.setValue('etat', 'hors_service'));
    expect(result.current.state.fields['description_defaut']).toMatchObject({
      visible: true,
      required: true,
    });

    act(() => result.current.addRow('pieces'));
    act(() => result.current.setCell('pieces', 0, 'prix_unitaire', 500));
    expect(result.current.values['pieces']).toEqual([
      { _id: 'r1', quantite: 1, prix_unitaire: 500, montant: 500 },
    ]);
    expect(result.current.values['total_pieces']).toBe(500);

    act(() => result.current.removeRow('pieces', 0));
    expect(result.current.values['total_pieces']).toBe(0);
    expect(result.current.dirty).toBe(true);
  });

  it('valide à la soumission puis réinitialise', () => {
    const { result } = renderHook(() => useFormEngine(definition, { context }));
    let outcome: ReturnType<typeof result.current.submit> | undefined;
    act(() => {
      outcome = result.current.submit();
    });
    expect(outcome?.valid).toBe(false);
    expect(result.current.submitted).toBe(true);
    expect(errorsAt(result.current.errors, ['etat'])).toHaveLength(1);

    act(() => result.current.reset({ etat: 'bon' }));
    expect(result.current.submitted).toBe(false);
    expect(result.current.values['etat']).toBe('bon');
  });
});

describe('validationMessage', () => {
  const translate = (key: string, params?: Record<string, unknown>) =>
    `${key}:${JSON.stringify(params ?? {})}`;

  it('traduit le code avec ses paramètres, ou reprend le message de motif', () => {
    expect(
      validationMessage({ path: ['a'], field: 'a', code: 'min', params: { min: 2 } }, translate),
    ).toBe('validation.min:{"min":2}');
    expect(
      validationMessage(
        { path: ['a'], field: 'a', code: 'pattern', params: { message: 'Format EQ-0000' } },
        translate,
      ),
    ).toBe('Format EQ-0000');
  });
});
