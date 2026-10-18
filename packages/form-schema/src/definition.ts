import { z } from 'zod';
import { fieldSchema } from './fields.js';
import { hasValue, walkFields } from './walk.js';
import { workflowSchema } from './workflow.js';

export const STRUCTURE_SCHEMA_VERSION = 1;

/**
 * Définition d'une structure (formulaire), stockée en JSON dans chaque version.
 * Contrôles structurels ici ; les contrôles sémantiques (formules, références des conditions,
 * cycles) sont faits par `analyzeDefinition` de `@tesserax/form-engine`.
 */
export const structureDefinitionSchema = z
  .object({
    schemaVersion: z.literal(STRUCTURE_SCHEMA_VERSION),
    fields: z.array(fieldSchema).max(500),
    workflow: workflowSchema.optional(),
  })
  .superRefine((definition, ctx) => {
    const keys = new Map<string, string>();
    // Champs racines porteurs d'une valeur : seuls exigibles par une transition.
    const rootValues = new Set<string>();
    const ids = new Set<string>();
    const states = definition.workflow
      ? new Set(definition.workflow.states.map((s) => s.key))
      : undefined;

    for (const { field, table } of walkFields(definition.fields)) {
      const issue = (message: string) =>
        ctx.addIssue({ code: 'custom', message: `${field.key} : ${message}`, path: ['fields'] });

      // Clés uniques sur toute la structure (y compris colonnes de tableaux) : une référence
      // `{cle}` dans une formule est ainsi toujours non ambiguë.
      if (keys.has(field.key)) issue('clé déjà utilisée');
      keys.set(field.key, field.type);
      if (!table && hasValue(field)) rootValues.add(field.key);
      if (ids.has(field.id)) issue(`identifiant déjà utilisé (${field.id})`);
      ids.add(field.id);

      if ('options' in field) {
        const values = field.options.map((o) => o.value);
        if (new Set(values).size !== values.length) issue('valeurs d option en double');
      }
      const ranges: [unknown, unknown][] = [];
      if ('min' in field) ranges.push([field.min, field.max]);
      if ('minLength' in field) ranges.push([field.minLength, field.maxLength]);
      if ('minItems' in field) ranges.push([field.minItems, field.maxItems]);
      if ('minRows' in field) ranges.push([field.minRows, field.maxRows]);
      for (const [min, max] of ranges) {
        if (min !== undefined && max !== undefined && (min as number) > (max as number)) {
          issue('minimum supérieur au maximum');
        }
      }
      if ('pattern' in field && field.pattern !== undefined) {
        try {
          new RegExp(field.pattern);
        } catch {
          issue('expression régulière invalide');
        }
      }
      for (const list of [field.visibleInStates, field.editableInStates]) {
        for (const state of list ?? []) {
          if (!states) issue(`état « ${state} » référencé sans workflow`);
          else if (!states.has(state)) issue(`état inconnu « ${state} »`);
        }
      }
    }

    definition.workflow?.transitions.forEach((transition, index) => {
      for (const key of transition.requiredFields ?? []) {
        if (!rootValues.has(key)) {
          ctx.addIssue({
            code: 'custom',
            message: keys.has(key)
              ? `Transition ${transition.key} : « ${key} » n'est pas un champ racine à valeur`
              : `Transition ${transition.key} : champ inconnu « ${key} »`,
            path: ['workflow', 'transitions', index, 'requiredFields'],
          });
        }
      }
    });
  });

export type StructureDefinition = z.infer<typeof structureDefinitionSchema>;

export function emptyDefinition(): StructureDefinition {
  return { schemaVersion: STRUCTURE_SCHEMA_VERSION, fields: [] };
}
