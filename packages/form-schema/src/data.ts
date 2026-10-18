import { z } from 'zod';
import { isoDateSchema, isoDateTimeSchema, isoTimeSchema } from './common.js';
import { type Field, type SimpleField, type TableField } from './fields.js';
import { type StructureDefinition } from './definition.js';
import { rootValueFields } from './walk.js';

/** Référence à un fichier téléversé séparément (UUID client, D10). */
export const fileRefSchema = z.object({
  fileId: z.uuid(),
  /** Version annotée d'une photo ; l'original reste `fileId`. */
  annotatedFileId: z.uuid().optional(),
  name: z.string().max(255).optional(),
  mimeType: z.string().max(255).optional(),
  size: z.number().int().min(0).optional(),
});

export const geoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** Précision horizontale en mètres. */
  accuracy: z.number().min(0).optional(),
  altitude: z.number().optional(),
  source: z.enum(['gps', 'manual', 'map']),
  capturedAt: isoDateTimeSchema.optional(),
});

export type FileRef = z.infer<typeof fileRefSchema>;
export type GeoPoint = z.infer<typeof geoPointSchema>;
export type FieldValue = unknown;
export type SubmissionData = Record<string, FieldValue>;
/** Ligne d'un tableau répétable ; `_id` est stable (fusion des modifications hors ligne). */
export type TableRow = { _id: string } & Record<string, FieldValue>;

/** Schéma Zod de la valeur d'un champ simple (forme uniquement, sans contraintes métier). */
export function valueSchema(field: SimpleField): z.ZodType {
  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'email':
    case 'phone':
    case 'barcode':
    case 'list':
    case 'author':
      return z.string();
    case 'number':
    case 'rating':
    case 'slider':
      return z.number().finite();
    case 'date':
      return isoDateSchema;
    case 'time':
      return isoTimeSchema;
    case 'datetime':
    case 'timestamp':
      return isoDateTimeSchema;
    case 'boolean':
      return z.boolean();
    case 'select':
      return z.string();
    case 'multiselect':
      return z.array(z.string());
    case 'relation':
    case 'user':
      return field.multiple ? z.array(z.string()) : z.string();
    case 'photo':
    case 'file':
      return z.array(fileRefSchema);
    case 'signature':
      return fileRefSchema;
    case 'geolocation':
      return geoPointSchema;
    case 'calculated':
      return z.union([z.number(), z.string(), z.boolean()]);
    case 'hidden':
      return z.union([z.string(), z.number(), z.boolean()]);
    case 'info':
      return z.never();
  }
}

function rowSchema(table: TableField): z.ZodType {
  const shape: Record<string, z.ZodType> = { _id: z.string().min(1) };
  for (const cell of table.fields) {
    if (cell.type !== 'info') shape[cell.key] = valueSchema(cell).nullable().optional();
  }
  return z.object(shape).strict();
}

/** Schéma d'une valeur de champ (racine ou tableau) ; `undefined` pour un champ sans valeur. */
export function fieldValueSchema(field: Field): z.ZodType | undefined {
  if (field.type === 'section' || field.type === 'info') return undefined;
  if (field.type === 'table') return z.array(rowSchema(field));
  return valueSchema(field);
}

/**
 * Schéma dynamique des données d'une fiche pour une version de structure (P1.1.4).
 * Toutes les valeurs sont facultatives et peuvent valoir `null` (le caractère requis dépend
 * des conditions, évaluées par le moteur) ; les clés inconnues sont refusées.
 */
export function buildDataSchema(definition: StructureDefinition) {
  const shape: Record<string, z.ZodType> = {};
  for (const field of rootValueFields(definition.fields)) {
    shape[field.key] = fieldValueSchema(field)!.nullable().optional();
  }
  return z.object(shape).strict();
}
