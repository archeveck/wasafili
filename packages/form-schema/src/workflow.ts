import { z } from 'zod';
import { fieldKeySchema } from './common.js';

const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .optional();

export const workflowStateSchema = z.object({
  key: fieldKeySchema,
  label: z.string().trim().min(1).max(100),
  color,
  /** État d'une fiche à sa création (exactement un). */
  initial: z.boolean().optional(),
  /** État terminal : aucune transition n'en part. */
  final: z.boolean().optional(),
});

/** Transition exposée comme bouton d'enregistrement personnalisé. */
export const workflowTransitionSchema = z.object({
  key: fieldKeySchema,
  label: z.string().trim().min(1).max(100),
  from: z.array(fieldKeySchema).min(1),
  to: fieldKeySchema,
  color,
  /** Rôles (clés) autorisés à déclencher la transition (absent = tous). */
  roles: z.array(z.string()).optional(),
  /** Champs devant être renseignés pour franchir la transition. */
  requiredFields: z.array(fieldKeySchema).optional(),
  /** Message de confirmation affiché avant la transition. */
  confirm: z.string().max(500).optional(),
});

export const workflowSchema = z
  .object({
    states: z.array(workflowStateSchema).min(1),
    transitions: z.array(workflowTransitionSchema),
  })
  .superRefine((workflow, ctx) => {
    const states = new Set<string>();
    workflow.states.forEach((state, index) => {
      if (states.has(state.key)) {
        ctx.addIssue({
          code: 'custom',
          message: `État en double : ${state.key}`,
          path: ['states', index, 'key'],
        });
      }
      states.add(state.key);
    });
    const initial = workflow.states.filter((state) => state.initial).length;
    if (initial !== 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'Le workflow doit avoir exactement un état initial',
        path: ['states'],
      });
    }
    const finals = new Set(workflow.states.filter((s) => s.final).map((s) => s.key));
    const transitions = new Set<string>();
    workflow.transitions.forEach((transition, index) => {
      if (transitions.has(transition.key)) {
        ctx.addIssue({
          code: 'custom',
          message: `Transition en double : ${transition.key}`,
          path: ['transitions', index, 'key'],
        });
      }
      transitions.add(transition.key);
      for (const ref of [...transition.from, transition.to]) {
        if (!states.has(ref)) {
          ctx.addIssue({
            code: 'custom',
            message: `État inconnu : ${ref}`,
            path: ['transitions', index],
          });
        }
      }
      for (const from of transition.from) {
        if (finals.has(from)) {
          ctx.addIssue({
            code: 'custom',
            message: `Aucune transition ne peut partir de l'état final ${from}`,
            path: ['transitions', index, 'from'],
          });
        }
      }
    });
  });

export type WorkflowState = z.infer<typeof workflowStateSchema>;
export type WorkflowTransition = z.infer<typeof workflowTransitionSchema>;
export type Workflow = z.infer<typeof workflowSchema>;

export function initialState(workflow: Workflow | undefined): string | null {
  return workflow?.states.find((state) => state.initial)?.key ?? null;
}
