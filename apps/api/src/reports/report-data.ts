import {
  type Field,
  type FileRef,
  type GeoPoint,
  type SimpleField,
  type StructureDefinition,
  type SubmissionData,
  walkFields,
} from '@tesserax/form-schema';
import { type ImageValue, type TemplateTag } from './docx';

/**
 * Données de fusion d'une fiche (P5.1.2) : une valeur lisible par champ (libellés des choix,
 * dates dans le fuseau de l'instance…), un tableau d'objets par tableau répétable, des
 * `ImageValue` pour les photos et signatures. Les balises `_…` décrivent la fiche elle-même
 * (une clé de champ commence toujours par une lettre : aucun conflit possible).
 */

export const BUILTIN_TAGS: { name: string; label: string }[] = [
  { name: '_formulaire', label: 'Nom du formulaire' },
  { name: '_etat', label: 'État de la fiche' },
  { name: '_auteur', label: 'Auteur de la fiche' },
  { name: '_creee_le', label: 'Date de création' },
  { name: '_modifiee_le', label: 'Date de dernière modification' },
  { name: '_identifiant', label: 'Identifiant de la fiche' },
  { name: '_instance', label: 'Nom de l’organisation' },
  { name: '_genere_le', label: 'Date de génération du rapport' },
];

const IMAGE_FIELDS = new Set<Field['type']>(['photo', 'signature']);
const DEFAULT_WIDTH: Record<string, number> = { photo: 12, signature: 5 };

export interface Labels {
  /** Éléments de référentiel : id → libellé. */
  items: ReadonlyMap<string, string>;
  /** Utilisateurs : id → nom complet. */
  users: ReadonlyMap<string, string>;
}

export interface SubmissionInfo {
  id: string;
  state: string | null;
  authorId: string | null;
  createdAt: Date;
  updatedAt: Date;
  data: SubmissionData;
}

export interface ReportContext {
  structureName: string;
  instanceName: string;
  timeZone: string;
  labels: Labels;
  now?: Date;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function formatDateTime(value: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(new Date(value))
    .replace(',', '');
}

function formatNumber(value: number, decimals?: number): string {
  return new Intl.NumberFormat('fr-FR', {
    maximumFractionDigits: decimals ?? 10,
    ...(decimals !== undefined ? { minimumFractionDigits: decimals } : {}),
  })
    .format(value)
    .replace(/[\u202f\u00a0]/g, ' ');
}

const withUnit = (text: string, unit?: string) => (unit ? `${text} ${unit}` : text);

function photos(value: unknown): string[] {
  const refs = Array.isArray(value) ? (value as FileRef[]) : value ? [value as FileRef] : [];
  // La version annotée est celle que l'inspecteur a voulu montrer.
  return refs.map((ref) => ref.annotatedFileId ?? ref.fileId);
}

/** Valeur de fusion d'un champ simple. */
export function formatValue(
  field: SimpleField,
  value: unknown,
  context: Pick<ReportContext, 'labels' | 'timeZone'>,
): string | ImageValue {
  if (IMAGE_FIELDS.has(field.type)) {
    return { kind: 'image', fileIds: photos(value), width: DEFAULT_WIDTH[field.type]! };
  }
  if (value === null || value === undefined || value === '') return '';
  switch (field.type) {
    case 'select':
      return field.options.find((o) => o.value === value)?.label ?? String(value);
    case 'multiselect':
      return (value as string[])
        .map((item) => field.options.find((o) => o.value === item)?.label ?? item)
        .join(', ');
    case 'list':
      return context.labels.items.get(String(value)) ?? '';
    case 'user':
    case 'author':
      return (Array.isArray(value) ? value : [value])
        .map((id) => context.labels.users.get(String(id)) ?? '')
        .filter(Boolean)
        .join(', ');
    case 'boolean':
      return value ? 'Oui' : 'Non';
    case 'number':
      return withUnit(formatNumber(Number(value), field.decimals), field.unit);
    case 'slider':
      return withUnit(formatNumber(Number(value)), field.unit);
    case 'rating':
      return `${String(value)}/${field.max ?? 5}`;
    case 'date':
      return formatDate(String(value));
    case 'datetime':
    case 'timestamp':
      return formatDateTime(String(value), context.timeZone);
    case 'geolocation': {
      const point = value as GeoPoint;
      const coords = `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;
      return point.accuracy === undefined
        ? coords
        : `${coords} (± ${Math.round(point.accuracy)} m)`;
    }
    case 'file':
      return (value as FileRef[]).map((f) => f.name ?? 'fichier').join(', ');
    case 'calculated':
      if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
      if (typeof value === 'number') return formatNumber(value, field.decimals);
      return field.resultType === 'date' ? formatDate(String(value)) : String(value);
    default:
      return Array.isArray(value) ? value.join(', ') : String(value);
  }
}

/** Données de fusion d'une fiche. */
export function reportData(
  definition: StructureDefinition,
  submission: SubmissionInfo,
  context: ReportContext,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const { field, table } of walkFields(definition.fields)) {
    if (table || field.type === 'section' || field.type === 'info') continue;
    const value = submission.data[field.key];
    if (field.type === 'table') {
      const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
      data[field.key] = rows.map((row, index) => {
        const out: Record<string, unknown> = { _numero: index + 1 };
        for (const cell of field.fields) {
          if (cell.type !== 'info') out[cell.key] = formatValue(cell, row[cell.key], context);
        }
        return out;
      });
    } else {
      data[field.key] = formatValue(field, value, context);
    }
  }
  const stateLabel =
    definition.workflow?.states.find((s) => s.key === submission.state)?.label ??
    submission.state ??
    '';
  return {
    ...data,
    _formulaire: context.structureName,
    _etat: stateLabel,
    _auteur: submission.authorId ? (context.labels.users.get(submission.authorId) ?? '') : '',
    _creee_le: formatDateTime(submission.createdAt, context.timeZone),
    _modifiee_le: formatDateTime(submission.updatedAt, context.timeZone),
    _identifiant: submission.id,
    _instance: context.instanceName,
    _genere_le: formatDateTime(context.now ?? new Date(), context.timeZone),
  };
}

/** Fichiers image référencés par les balises `{{@…}}` du modèle (seuls ceux-là sont chargés). */
export function imageFileIds(
  data: Record<string, unknown>,
  tags: readonly TemplateTag[],
): string[] {
  const ids = new Set<string>();
  for (const tag of tags) {
    if (tag.kind !== 'image') continue;
    const scopes = tag.parent ? ((data[tag.parent] as Record<string, unknown>[]) ?? []) : [data];
    for (const scope of [...scopes, data]) {
      const value = scope[tag.name] as ImageValue | undefined;
      if (value?.kind === 'image') for (const id of value.fileIds) ids.add(id);
    }
  }
  return [...ids];
}

/** Fiche fictive pour l'aperçu d'un modèle sans fiche réelle (P5.1.4). */
export function sampleSubmission(
  definition: StructureDefinition,
  now = new Date(),
): SubmissionInfo {
  const sample = (field: SimpleField): unknown => {
    switch (field.type) {
      case 'number':
      case 'slider':
        return 12.5;
      case 'rating':
        return 4;
      case 'boolean':
        return true;
      case 'date':
        return now.toISOString().slice(0, 10);
      case 'time':
        return '08:30';
      case 'datetime':
      case 'timestamp':
        return now.toISOString();
      case 'select':
        return field.options[0]?.value;
      case 'multiselect':
        return field.options.slice(0, 2).map((o) => o.value);
      case 'geolocation':
        return { lat: 5.359952, lng: -4.008256, accuracy: 5, source: 'gps' };
      case 'photo':
        return [{ fileId: SAMPLE_IMAGE }];
      case 'signature':
        return { fileId: SAMPLE_IMAGE };
      case 'file':
        return [{ fileId: SAMPLE_IMAGE, name: 'document.pdf' }];
      case 'list':
      case 'user':
      case 'author':
      case 'relation':
        return undefined;
      case 'info':
        return undefined;
      default:
        return `‹ ${field.label} ›`;
    }
  };
  const data: SubmissionData = {};
  for (const { field, table } of walkFields(definition.fields)) {
    if (table || field.type === 'section' || field.type === 'info') continue;
    if (field.type === 'table') {
      data[field.key] = [1, 2].map((n) => ({
        _id: `exemple-${n}`,
        ...Object.fromEntries(field.fields.map((cell) => [cell.key, sample(cell)])),
      }));
    } else {
      data[field.key] = sample(field);
    }
  }
  return {
    id: '00000000-0000-0000-0000-000000000000',
    state: definition.workflow?.states[0]?.key ?? null,
    authorId: null,
    createdAt: now,
    updatedAt: now,
    data,
  };
}

/** Identifiant réservé de l'image d'exemple (gris uni). */
export const SAMPLE_IMAGE = 'exemple';

export interface TagIssue {
  tag: string;
  message: string;
}

/**
 * Vérification des balises contre la structure (P5.1.1). Signalées sans bloquer : une
 * structure évolue, le modèle peut précéder le champ (et une balise inconnue reste vide).
 */
export function checkTags(
  tags: readonly TemplateTag[],
  definition: StructureDefinition,
): TagIssue[] {
  const root = new Map<string, Field>();
  const tables = new Map<string, Map<string, Field>>();
  for (const { field, table } of walkFields(definition.fields)) {
    if (field.type === 'section' || field.type === 'info') continue;
    if (table) {
      const cells = tables.get(table.key) ?? new Map<string, Field>();
      cells.set(field.key, field);
      tables.set(table.key, cells);
    } else root.set(field.key, field);
  }
  const builtins = new Set(BUILTIN_TAGS.map((t) => t.name));
  const issues: TagIssue[] = [];
  for (const tag of tags) {
    const cells = tag.parent ? tables.get(tag.parent) : undefined;
    const field = cells?.get(tag.name) ?? root.get(tag.name);
    const shown =
      tag.kind === 'loop'
        ? `{{#${tag.name}}}`
        : tag.kind === 'image'
          ? `{{@${tag.name}}}`
          : `{{${tag.name}}}`;
    if (tag.kind === 'loop') {
      if (!tables.has(tag.name)) {
        issues.push({
          tag: shown,
          message: root.has(tag.name)
            ? `« ${root.get(tag.name)!.label} » n'est pas un tableau répétable`
            : 'Tableau inconnu dans ce formulaire',
        });
      }
      continue;
    }
    if (builtins.has(tag.name) || (tag.parent && tag.name === '_numero')) continue;
    if (!field) {
      issues.push({ tag: shown, message: 'Champ inconnu dans ce formulaire' });
      continue;
    }
    const image = IMAGE_FIELDS.has(field.type);
    if (tag.kind === 'image' && !image) {
      issues.push({
        tag: shown,
        message: `« ${field.label} » n'est ni une photo ni une signature`,
      });
    } else if (tag.kind === 'value' && image) {
      issues.push({
        tag: shown,
        message: `Pour afficher « ${field.label} », utilisez {{@${tag.name}}}`,
      });
    } else if (tag.kind === 'value' && field.type === 'table') {
      issues.push({
        tag: shown,
        message: `« ${field.label} » est un tableau : {{#${tag.name}}}…{{/${tag.name}}}`,
      });
    }
  }
  return issues;
}

/** Balises proposées dans le back-office pour une structure (aide à la rédaction). */
export function availableTags(definition: StructureDefinition) {
  const fields: { tag: string; label: string; table?: string }[] = [];
  for (const { field, table } of walkFields(definition.fields)) {
    if (field.type === 'section' || field.type === 'info') continue;
    const tag =
      field.type === 'table'
        ? `{{#${field.key}}}…{{/${field.key}}}`
        : IMAGE_FIELDS.has(field.type)
          ? `{{@${field.key}}}`
          : `{{${field.key}}}`;
    fields.push({ tag, label: field.label, ...(table ? { table: table.key } : {}) });
  }
  return {
    fields,
    builtins: BUILTIN_TAGS.map((t) => ({ tag: `{{${t.name}}}`, label: t.label })),
  };
}
