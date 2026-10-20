import Docxtemplater from 'docxtemplater';
import InspectModule from 'docxtemplater/js/inspect-module.js';
import { imageSize } from 'image-size';
import PizZip from 'pizzip';

/**
 * Fusion des modèles DOCX (P5.1.2) avec docxtemplater. Syntaxe des balises :
 * - `{{champ}}` : valeur lisible ; `{{#tableau}}…{{/tableau}}` : une répétition par ligne ;
 * - `{{@photo}}` ou `{{@photo:8}}` : images (photos, signature), seules dans leur paragraphe,
 *   largeur facultative en centimètres.
 *
 * Seules les valeurs `ImageValue` produisent du XML brut : un texte saisi dans une fiche est
 * toujours échappé, même placé dans une balise `{{@…}}`.
 */

export const DELIMITERS = { start: '{{', end: '}}' };

export type TagKind = 'value' | 'loop' | 'image';

export interface TemplateTag {
  /** Nom de la balise, sans préfixe ni option (`photo` pour `{{@photo:8}}`). */
  name: string;
  kind: TagKind;
  /** Boucle englobante. */
  parent?: string;
}

/** Valeur d'un champ photo ou signature, résolue en images au rendu. */
export interface ImageValue {
  kind: 'image';
  fileIds: string[];
  /** Largeur par défaut (cm) quand la balise n'en précise pas. */
  width: number;
}

export function isImageValue(value: unknown): value is ImageValue {
  return (
    typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'image'
  );
}

export interface ImageFile {
  data: Buffer;
  mimeType: string;
}

/** Erreur de syntaxe d'un modèle, expliquée en français (une entrée par balise fautive). */
export class TemplateSyntaxError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join(' ; '));
  }
}

const EXPLANATIONS: Record<string, (tag: string) => string> = {
  unopened_tag: (tag) => `« ${tag} » est fermée sans avoir été ouverte`,
  unclosed_tag: (tag) => `« ${tag} » n'est pas fermée (il manque « }} »)`,
  duplicate_open_tag: (tag) => `« ${tag} » contient « {{ » en double`,
  duplicate_close_tag: (tag) => `« ${tag} » contient « }} » en double`,
  unopened_loop: (tag) => `La fin de boucle « {{/${tag}}} » n'a pas de début`,
  unclosed_loop: (tag) => `La boucle « {{#${tag}}} » n'est pas fermée`,
  closing_tag_does_not_match_opening_tag: (tag) =>
    `La fin de boucle « ${tag} » ne correspond pas à la boucle ouverte`,
  unbalanced_loop_tags: (tag) => `Boucles mal imbriquées autour de « ${tag} »`,
  raw_xml_tag_should_be_only_text_in_paragraph: (tag) =>
    `L'image « {{@${tag}}} » doit être seule dans son paragraphe`,
  raw_tag_outerxml_invalid: (tag) => `L'image « {{@${tag}}} » doit être dans un paragraphe`,
  loop_position_invalid: (tag) => `La boucle « ${tag} » chevauche un tableau du document`,
};

function explain(error: unknown): never {
  const properties = (error as { properties?: { errors?: unknown[]; id?: string } }).properties;
  const errors = properties?.errors ?? [error];
  const problems = errors.map((item) => {
    const props = (item as { properties?: { id?: string; xtag?: string } }).properties ?? {};
    const explanation = props.id ? EXPLANATIONS[props.id] : undefined;
    const tag = props.xtag ?? '';
    return explanation ? explanation(tag) : `Balise invalide${tag ? ` : « ${tag} »` : ''}`;
  });
  throw new TemplateSyntaxError(problems.length > 0 ? problems : ['Document DOCX illisible']);
}

function open(template: Buffer, options: Docxtemplater.DXT.ConstructorOptions = {}) {
  let zip: PizZip;
  try {
    zip = new PizZip(template);
  } catch {
    throw new TemplateSyntaxError(['Le fichier n’est pas un document DOCX']);
  }
  if (!zip.file('word/document.xml')) {
    throw new TemplateSyntaxError(['Le fichier n’est pas un document Word (DOCX)']);
  }
  try {
    return new Docxtemplater(zip, {
      delimiters: DELIMITERS,
      paragraphLoop: true,
      linebreaks: true,
      ...options,
    });
  } catch (error) {
    return explain(error);
  }
}

/** `photo:8` → { name: 'photo', width: 8 }. */
function parseTag(tag: string): { name: string; width?: number } {
  const [name = '', option] = tag.trim().split(':');
  const width = option === undefined ? undefined : Number(option.replace(',', '.'));
  return { name: name.trim(), ...(width && width > 0 && width <= 30 ? { width } : {}) };
}

/** Balises du document (corps, en-têtes, pieds de page) ; erreur de syntaxe expliquée sinon. */
export function inspectTemplate(template: Buffer): TemplateTag[] {
  const inspect = new InspectModule();
  open(template, { modules: [inspect] });
  const tags: TemplateTag[] = [];
  const seen = new Set<string>();
  const walk = (
    parts: { type: string; value: string; module?: string; subparsed?: unknown[] }[],
    parent?: string,
  ) => {
    for (const part of parts) {
      if (part.type !== 'placeholder') continue;
      const { name } = parseTag(part.value);
      const kind: TagKind =
        part.module === 'loop' ? 'loop' : part.module === 'rawxml' ? 'image' : 'value';
      const key = `${parent ?? ''}/${kind}/${name}`;
      if (!seen.has(key)) {
        seen.add(key);
        tags.push({ name, kind, ...(parent ? { parent } : {}) });
      }
      if (part.subparsed) walk(part.subparsed as typeof parts, kind === 'loop' ? name : parent);
    }
  };
  walk(inspect.getAllStructuredTags() as unknown as Parameters<typeof walk>[0]);
  return tags;
}

const EMU_PER_CM = 360_000;
const MAX_HEIGHT_CM = 18;
const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpeg', 'image/png': 'png' };

const REL_IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function textParagraph(text: string): string {
  return `<w:p><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function drawing(rId: string, id: number, cx: number, cy: number): string {
  return (
    `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Image ${id}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="image${id}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
  );
}

/**
 * Fusionne le modèle avec les données. Les images sont ajoutées au document (médias et
 * relations du corps) au fil du rendu ; une image absente ou d'un format non pris en charge
 * est remplacée par une mention.
 */
export function renderTemplate(
  template: Buffer,
  data: Record<string, unknown>,
  images: ReadonlyMap<string, ImageFile>,
): Buffer {
  const media: { rId: string; path: string; data: Buffer; ext: string }[] = [];
  const byFile = new Map<string, { rId: string; width: number; height: number }>();
  let drawingId = 1000;

  const embed = (fileId: string, widthCm: number): string => {
    const image = images.get(fileId);
    const ext = image ? IMAGE_TYPES[image.mimeType] : undefined;
    if (!image || !ext) return textParagraph('[image indisponible]');
    let entry = byFile.get(fileId);
    if (!entry) {
      let size: { width?: number; height?: number };
      try {
        size = imageSize(image.data);
      } catch {
        return textParagraph('[image illisible]');
      }
      const rId = `rIdTx${media.length + 1}`;
      media.push({ rId, path: `media/wasafili_${media.length + 1}.${ext}`, data: image.data, ext });
      entry = { rId, width: size.width ?? 4, height: size.height ?? 3 };
      byFile.set(fileId, entry);
    }
    let cx = widthCm * EMU_PER_CM;
    let cy = (cx * entry.height) / entry.width;
    if (cy > MAX_HEIGHT_CM * EMU_PER_CM) {
      cx = (cx * MAX_HEIGHT_CM * EMU_PER_CM) / cy;
      cy = MAX_HEIGHT_CM * EMU_PER_CM;
    }
    return drawing(entry.rId, ++drawingId, Math.round(cx), Math.round(cy));
  };

  const doc = open(template, {
    parser: (tag: string) => {
      const { name, width } = parseTag(tag);
      return {
        get(scope: unknown, context: Docxtemplater.DXT.ParserContext) {
          if (name === '.') return scope;
          const value =
            scope && typeof scope === 'object'
              ? (scope as Record<string, unknown>)[name]
              : undefined;
          const raw = context.meta.part.module === 'rawxml';
          if (isImageValue(value)) {
            if (!raw) return value.fileIds.length > 0 ? `${value.fileIds.length} image(s)` : '';
            return value.fileIds.map((id) => embed(id, width ?? value.width)).join('');
          }
          // Jamais de XML brut issu d'une saisie. `undefined` : la balise est cherchée dans la
          // portée englobante (champ racine utilisé dans une boucle).
          if (raw && value !== undefined) return value === null ? '' : textParagraph(String(value));
          return value;
        },
      };
    },
    nullGetter: () => '',
  });
  try {
    doc.render(data);
  } catch (error) {
    explain(error);
  }

  const zip = doc.getZip();
  if (media.length > 0) {
    const relsPath = 'word/_rels/document.xml.rels';
    let rels =
      zip.file(relsPath)?.asText() ??
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    const entries = media
      .map((m) => `<Relationship Id="${m.rId}" Type="${REL_IMAGE}" Target="${m.path}"/>`)
      .join('');
    rels = rels.replace('</Relationships>', `${entries}</Relationships>`);
    zip.file(relsPath, rels);
    for (const m of media) zip.file(`word/${m.path}`, m.data);

    let types = zip.file('[Content_Types].xml')!.asText();
    for (const ext of new Set(media.map((m) => m.ext))) {
      if (!new RegExp(`Extension="${ext}"`, 'i').test(types)) {
        types = types.replace(
          '</Types>',
          `<Default Extension="${ext}" ContentType="image/${ext}"/></Types>`,
        );
      }
    }
    zip.file('[Content_Types].xml', types);
  }
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Balises `{{champ}}` d'un texte simple (sujet, corps d'e-mail, nom de fichier). */
export function renderText(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/g, (_, name: string) => {
    const value = data[name];
    if (value === undefined || value === null || typeof value === 'object') return '';
    return String(value);
  });
}
