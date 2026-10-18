import { z } from 'zod';

/** Clé d'un champ : identifiant stable dans les données, les formules et les rapports. */
export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

export const fieldKeySchema = z
  .string()
  .regex(
    FIELD_KEY_PATTERN,
    'Clé invalide : minuscules, chiffres et « _ », commence par une lettre',
  );

/** Expression json-logic (https://jsonlogic.com) : objet, tableau ou littéral. */
export type JsonLogic =
  boolean | number | string | null | JsonLogic[] | { [operator: string]: JsonLogic };

export const jsonLogicSchema: z.ZodType<JsonLogic> = z.lazy(() =>
  z.union([
    z.boolean(),
    z.number(),
    z.string(),
    z.null(),
    z.array(jsonLogicSchema),
    z.record(z.string(), jsonLogicSchema),
  ]),
);

/** Condition (visibilité, requis…) : objet json-logic à opérateur unique. */
export const conditionSchema = z
  .record(z.string(), jsonLogicSchema)
  .refine((logic) => Object.keys(logic).length === 1, {
    message: 'Une condition est un objet json-logic à opérateur unique',
  });

export type Condition = z.infer<typeof conditionSchema>;

/** Date calendaire `AAAA-MM-JJ`. */
export const isoDateSchema = z.iso.date();
/** Heure `HH:MM` ou `HH:MM:SS`. */
export const isoTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Heure invalide');
/** Instant ISO 8601 avec fuseau (stocké en UTC). */
export const isoDateTimeSchema = z.iso.datetime({ offset: true });
