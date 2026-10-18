import { type Field, type StructureDefinition } from '@tesserax/form-schema';

/** Champ minimal pour les tests : `id` et `label` dérivés de la clé. */
export function field<T extends Field['type']>(
  type: T,
  key: string,
  extra: Record<string, unknown> = {},
): Field {
  return { id: `id-${key}`, key, label: key, type, ...extra } as Field;
}

export function definition(fields: Field[], extra: Partial<StructureDefinition> = {}) {
  return { schemaVersion: 1 as const, fields, ...extra };
}
