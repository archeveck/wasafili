import { z } from 'zod';
import { structureDefinitionSchema } from './definition.js';

/** JSON Schema de la définition de structure (OpenAPI, documentation) — P1.1.6. */
export function structureDefinitionJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(structureDefinitionSchema, { unrepresentable: 'any' }) as Record<
    string,
    unknown
  >;
}
