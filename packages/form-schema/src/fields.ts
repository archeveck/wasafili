import { z } from 'zod';
import {
  conditionSchema,
  fieldKeySchema,
  isoDateSchema,
  isoDateTimeSchema,
  isoTimeSchema,
} from './common.js';

/** Propriétés communes à tous les champs. */
const base = {
  /** Identifiant technique stable (designer, historique) ; distinct de la clé. */
  id: z.string().min(1).max(64),
  key: fieldKeySchema,
  label: z.string().trim().min(1).max(200),
  help: z.string().max(1000).optional(),
  required: z.boolean().optional(),
  readOnly: z.boolean().optional(),
  visibleIf: conditionSchema.optional(),
  requiredIf: conditionSchema.optional(),
  /** États de workflow où le champ est visible (absent = tous). */
  visibleInStates: z.array(z.string()).optional(),
  /** États de workflow où le champ est modifiable (absent = tous). */
  editableInStates: z.array(z.string()).optional(),
  /** Rôles (clés) qui voient le champ (absent = tous). */
  visibleToRoles: z.array(z.string()).optional(),
  /** Rôles (clés) qui peuvent le modifier (absent = tous). */
  editableByRoles: z.array(z.string()).optional(),
  /** Champ proposé comme filtre/tri dans le back-office et l'API. */
  filterable: z.boolean().optional(),
};

const option = z.object({
  value: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

const length = {
  minLength: z.number().int().min(0).optional(),
  maxLength: z.number().int().min(1).optional(),
};

const pattern = {
  /** Expression régulière (syntaxe JavaScript, sans délimiteurs). */
  pattern: z.string().min(1).optional(),
  patternMessage: z.string().max(200).optional(),
};

export const textField = z.object({
  ...base,
  type: z.literal('text'),
  ...length,
  ...pattern,
  placeholder: z.string().max(200).optional(),
  defaultValue: z.string().optional(),
});

export const textareaField = z.object({
  ...base,
  type: z.literal('textarea'),
  ...length,
  defaultValue: z.string().optional(),
});

export const numberField = z.object({
  ...base,
  type: z.literal('number'),
  min: z.number().optional(),
  max: z.number().optional(),
  /** Nombre maximal de décimales (0 = entier). */
  decimals: z.number().int().min(0).max(10).optional(),
  unit: z.string().max(20).optional(),
  defaultValue: z.number().optional(),
});

export const dateField = z.object({
  ...base,
  type: z.literal('date'),
  min: isoDateSchema.optional(),
  max: isoDateSchema.optional(),
  /** Pré-remplir avec la date du jour (fuseau de l'instance). */
  defaultNow: z.boolean().optional(),
  defaultValue: isoDateSchema.optional(),
});

export const timeField = z.object({
  ...base,
  type: z.literal('time'),
  defaultNow: z.boolean().optional(),
  defaultValue: isoTimeSchema.optional(),
});

export const datetimeField = z.object({
  ...base,
  type: z.literal('datetime'),
  defaultNow: z.boolean().optional(),
  defaultValue: isoDateTimeSchema.optional(),
});

export const booleanField = z.object({
  ...base,
  type: z.literal('boolean'),
  display: z.enum(['switch', 'checkbox']).optional(),
  defaultValue: z.boolean().optional(),
});

export const selectField = z.object({
  ...base,
  type: z.literal('select'),
  options: z.array(option).min(1),
  display: z.enum(['dropdown', 'radio', 'buttons']).optional(),
  defaultValue: z.string().optional(),
});

export const multiselectField = z.object({
  ...base,
  type: z.literal('multiselect'),
  options: z.array(option).min(1),
  minItems: z.number().int().min(0).optional(),
  maxItems: z.number().int().min(1).optional(),
  defaultValue: z.array(z.string()).optional(),
});

/** Valeur choisie dans un référentiel (liste hiérarchique), éventuellement en cascade. */
export const listField = z.object({
  ...base,
  type: z.literal('list'),
  listId: z.string().min(1),
  /** Niveau de la hiérarchie proposé (0 = racine) ; absent = tous niveaux. */
  level: z.number().int().min(0).optional(),
  /** Champ `list` parent : les éléments proposés sont les enfants de sa valeur. */
  parentField: fieldKeySchema.optional(),
});

export const relationField = z.object({
  ...base,
  type: z.literal('relation'),
  structureId: z.string().min(1),
  multiple: z.boolean().optional(),
});

export const photoField = z.object({
  ...base,
  type: z.literal('photo'),
  maxCount: z.number().int().min(1).max(50).optional(),
  /** Qualité JPEG de compression côté mobile (0,1 à 1). */
  quality: z.number().min(0.1).max(1).optional(),
  /** Plus grande dimension après redimensionnement, en pixels. */
  maxDimension: z.number().int().min(320).max(8192).optional(),
  allowAnnotation: z.boolean().optional(),
  allowGallery: z.boolean().optional(),
});

export const fileField = z.object({
  ...base,
  type: z.literal('file'),
  maxCount: z.number().int().min(1).max(50).optional(),
  /** Types MIME acceptés (ex. `application/pdf`, `image/*`). */
  accept: z.array(z.string().min(1)).optional(),
});

export const signatureField = z.object({ ...base, type: z.literal('signature') });

export const geolocationField = z.object({
  ...base,
  type: z.literal('geolocation'),
  allowManual: z.boolean().optional(),
  /** Précision GPS minimale exigée, en mètres. */
  maxAccuracy: z.number().positive().optional(),
});

export const barcodeField = z.object({
  ...base,
  type: z.literal('barcode'),
  formats: z.array(z.string().min(1)).optional(),
  /** Référentiel dans lequel rechercher le code scanné (par code d'élément). */
  lookupListId: z.string().min(1).optional(),
  ...pattern,
});

export const calculatedField = z.object({
  ...base,
  type: z.literal('calculated'),
  /** Formule lisible, ex. `{prix} * {quantite}` ou `SOMME({lignes.montant})`. */
  formula: z.string().min(1).max(2000),
  resultType: z.enum(['number', 'text', 'boolean', 'date']),
  decimals: z.number().int().min(0).max(10).optional(),
});

export const userField = z.object({
  ...base,
  type: z.literal('user'),
  multiple: z.boolean().optional(),
  /** Restreint le choix aux membres de ces groupes. */
  groupIds: z.array(z.string()).optional(),
});

export const emailField = z.object({
  ...base,
  type: z.literal('email'),
  defaultValue: z.string().optional(),
});

export const phoneField = z.object({
  ...base,
  type: z.literal('phone'),
  defaultValue: z.string().optional(),
});

export const ratingField = z.object({
  ...base,
  type: z.literal('rating'),
  max: z.number().int().min(2).max(10).optional(),
  defaultValue: z.number().int().min(0).optional(),
});

export const sliderField = z.object({
  ...base,
  type: z.literal('slider'),
  min: z.number(),
  max: z.number(),
  step: z.number().positive().optional(),
  unit: z.string().max(20).optional(),
  defaultValue: z.number().optional(),
});

/** Texte informatif affiché dans le formulaire (pas de valeur). */
export const infoField = z.object({
  ...base,
  type: z.literal('info'),
  /** Contenu en Markdown simple. */
  content: z.string().max(5000),
});

export const hiddenField = z.object({
  ...base,
  type: z.literal('hidden'),
  defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

/** Horodatage automatique : création de la fiche ou dernière modification. */
export const timestampField = z.object({
  ...base,
  type: z.literal('timestamp'),
  mode: z.enum(['created', 'updated']),
});

/** Auteur automatique : utilisateur qui a créé la fiche. */
export const authorField = z.object({ ...base, type: z.literal('author') });

/** Champs « simples » : utilisables partout, y compris dans un tableau répétable. */
export const simpleFieldSchema = z.discriminatedUnion('type', [
  textField,
  textareaField,
  numberField,
  dateField,
  timeField,
  datetimeField,
  booleanField,
  selectField,
  multiselectField,
  listField,
  relationField,
  photoField,
  fileField,
  signatureField,
  geolocationField,
  barcodeField,
  calculatedField,
  userField,
  emailField,
  phoneField,
  ratingField,
  sliderField,
  infoField,
  hiddenField,
  timestampField,
  authorField,
]);

/** Tableau répétable : sous-formulaire de n lignes (pas de tableau dans un tableau). */
export const tableField = z.object({
  ...base,
  type: z.literal('table'),
  fields: z.array(simpleFieldSchema).min(1).max(100),
  minRows: z.number().int().min(0).optional(),
  maxRows: z.number().int().min(1).optional(),
});

/** Section : regroupement visuel (titre) ; ses champs appartiennent au niveau racine des données. */
export const sectionField = z.object({
  ...base,
  type: z.literal('section'),
  fields: z.array(z.discriminatedUnion('type', [...simpleFieldSchema.options, tableField])),
  collapsible: z.boolean().optional(),
});

export const fieldSchema = z.discriminatedUnion('type', [
  ...simpleFieldSchema.options,
  tableField,
  sectionField,
]);

export type SimpleField = z.infer<typeof simpleFieldSchema>;
export type TableField = z.infer<typeof tableField>;
export type SectionField = z.infer<typeof sectionField>;
export type Field = z.infer<typeof fieldSchema>;
export type FieldType = Field['type'];
export type FieldOfType<T extends FieldType> = Extract<Field, { type: T }>;

export const FIELD_TYPES = fieldSchema.options.map(
  (variant) => variant.shape.type.value,
) as FieldType[];

/** Types qui ne portent pas de valeur dans les données d'une fiche. */
export const NON_VALUE_TYPES: ReadonlySet<FieldType> = new Set(['section', 'info']);

/** Types dont la valeur est calculée par le moteur ou le serveur, jamais saisie. */
export const COMPUTED_TYPES: ReadonlySet<FieldType> = new Set([
  'calculated',
  'timestamp',
  'author',
]);
