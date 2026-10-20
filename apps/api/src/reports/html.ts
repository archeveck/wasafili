import { type ImageFile, isImageValue, TemplateSyntaxError, type TemplateTag } from './docx';

/**
 * Modèles de rapport HTML (spécification §1.1 « DOCX/HTML ») : même syntaxe de balises que les
 * modèles DOCX — `{{champ}}`, `{{#tableau}}…{{/tableau}}`, `{{@photo}}` ou `{{@photo:8}}`
 * (largeur en centimètres) — et mêmes données de fusion.
 *
 * Le modèle, écrit par un gestionnaire, est contrôlé à l'enregistrement : ni script, ni cadre,
 * ni ressource externe (seules les images `data:` sont admises). Chaque valeur d'une fiche est
 * échappée ; les images de la fiche sont intégrées en `data:`. À la conversion, la politique de
 * sécurité injectée et Chromium verrouillé (Gotenberg sans JavaScript ni réseau) complètent.
 */

const TAG = /\{\{\s*([#/@]?)\s*([^{}]*?)\s*\}\}/g;
const NAME = /^[a-z_][a-z0-9_]*$/;
/** Images d'une fiche affichables par Chromium. */
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const DEFAULT_IMAGE_WIDTH_CM = 8;

export const HTML_TEMPLATE_MAX_LENGTH = 1_000_000;

const CSP =
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ` +
  `img-src data:; style-src 'unsafe-inline'; font-src data:">`;

const FORBIDDEN: [RegExp, string][] = [
  [/<script\b/i, 'Les scripts (« <script> ») ne sont pas autorisés'],
  [
    /<(iframe|frame|frameset|object|embed|applet|base|link|form|portal)\b/i,
    'La balise « <$1> » n’est pas autorisée',
  ],
  [/<meta\b[^>]*http-equiv/i, '« <meta http-equiv> » n’est pas autorisé'],
  [/<[^>]*\son[a-z]+\s*=/i, 'Les attributs d’événement (« onclick=… ») ne sont pas autorisés'],
  [/@import\b/i, '« @import » n’est pas autorisé : écrivez les styles dans le modèle'],
  [
    /<[^>]*\s(?:src|href|srcset|poster|action|data|background|xlink:href)\s*=\s*["']?\s*(?!data:|#)[^\s"'>]/i,
    'Ressource externe interdite : intégrez les images en « data: » (le PDF est produit sans réseau)',
  ],
  [
    /url\(\s*["']?\s*(?!data:)[^)\s"']/i,
    'Ressource externe interdite dans les styles (« url(…) ») : utilisez « data: »',
  ],
];

type Node =
  | { type: 'text'; text: string }
  | { type: 'value' | 'image'; name: string; width?: number }
  | { type: 'loop'; name: string; children: Node[] };

/** `photo:8` → { name: 'photo', width: 8 } (même règle que les modèles DOCX). */
function parseName(raw: string): { name: string; width?: number } {
  const [name = '', option] = raw.split(':');
  const width = option === undefined ? undefined : Number(option.replace(',', '.'));
  return { name: name.trim(), ...(width && width > 0 && width <= 30 ? { width } : {}) };
}

/** Analyse le modèle ; toutes les erreurs sont rassemblées, expliquées en français. */
function parse(html: string): { nodes: Node[]; problems: string[] } {
  const problems = FORBIDDEN.flatMap(([pattern, message]) => {
    const match = pattern.exec(html);
    return match ? [message.replace('$1', match[1]?.toLowerCase() ?? '')] : [];
  });
  const root: Node[] = [];
  const stack: { name: string; children: Node[] }[] = [];
  const current = () => stack.at(-1)?.children ?? root;
  const text = (segment: string) => {
    const stray = /\{\{[^\n]{0,30}/.exec(segment);
    if (stray) problems.push(`« ${stray[0]} » n'est pas fermée (il manque « }} »)`);
    current().push({ type: 'text', text: segment });
  };
  let last = 0;
  for (const match of html.matchAll(TAG)) {
    const [whole, prefix, raw] = match;
    text(html.slice(last, match.index));
    last = match.index + whole.length;
    const { name, width } = parseName(raw!);
    if (!NAME.test(name)) {
      problems.push(`« ${whole} » : nom de balise invalide (lettres minuscules, chiffres, « _ »)`);
      continue;
    }
    if (prefix === '#') {
      const loop: Node = { type: 'loop', name, children: [] };
      current().push(loop);
      stack.push(loop);
    } else if (prefix === '/') {
      const open = stack.pop();
      if (!open) problems.push(`La fin de boucle « {{/${name}}} » n'a pas de début`);
      else if (open.name !== name) {
        problems.push(
          `La fin de boucle « {{/${name}}} » ne correspond pas à « {{#${open.name}}} »`,
        );
      }
    } else {
      current().push({
        type: prefix === '@' ? 'image' : 'value',
        name,
        ...(width ? { width } : {}),
      });
    }
  }
  text(html.slice(last));
  for (const open of stack) problems.push(`La boucle « {{#${open.name}}} » n'est pas fermée`);
  return { nodes: root, problems };
}

/** Balises du modèle, comme `inspectTemplate` pour un DOCX ; erreur expliquée sinon. */
export function inspectHtmlTemplate(html: string): TemplateTag[] {
  const { nodes, problems } = parse(html);
  if (problems.length > 0) throw new TemplateSyntaxError(problems);
  const tags: TemplateTag[] = [];
  const seen = new Set<string>();
  const walk = (list: Node[], parent?: string) => {
    for (const node of list) {
      if (node.type === 'text') continue;
      const kind = node.type;
      const key = `${parent ?? ''}/${kind}/${node.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        tags.push({ name: node.name, kind, ...(parent ? { parent } : {}) });
      }
      if (node.type === 'loop') walk(node.children, node.name);
    }
  };
  walk(nodes);
  return tags;
}

const escapeHtml = (text: string) =>
  text.replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/**
 * Fusionne le modèle avec les données d'une fiche. Dans une boucle, une balise désigne d'abord
 * la colonne de la ligne, sinon un champ de la fiche. Une image absente, ou d'un type que le
 * navigateur n'affiche pas, est remplacée par une mention.
 */
export function renderHtmlTemplate(
  html: string,
  data: Record<string, unknown>,
  images: ReadonlyMap<string, ImageFile>,
): string {
  const { nodes, problems } = parse(html);
  if (problems.length > 0) throw new TemplateSyntaxError(problems);
  const lookup = (scopes: Record<string, unknown>[], name: string) =>
    scopes.find((scope) => name in scope)?.[name];
  const image = (fileId: string, width: number) => {
    const file = images.get(fileId);
    if (!file || !IMAGE_TYPES.has(file.mimeType)) return '<em>(image indisponible)</em>';
    return `<img alt="" style="width:${width}cm;max-width:100%" src="data:${file.mimeType};base64,${file.data.toString('base64')}">`;
  };
  const render = (list: Node[], scopes: Record<string, unknown>[]): string =>
    list
      .map((node) => {
        if (node.type === 'text') return node.text;
        const value = lookup(scopes, node.name);
        if (node.type === 'loop') {
          return Array.isArray(value)
            ? value
                .map((row) => render(node.children, [row as Record<string, unknown>, ...scopes]))
                .join('')
            : '';
        }
        if (node.type === 'image' && isImageValue(value)) {
          return value.fileIds
            .map((id) => image(id, node.width ?? value.width ?? DEFAULT_IMAGE_WIDTH_CM))
            .join(' ');
        }
        // Valeur d'une fiche : toujours du texte, même placée dans une balise {{@…}}.
        if (value === null || value === undefined || typeof value === 'object') return '';
        return escapeHtml(String(value));
      })
      .join('');
  const body = render(nodes, [data]);
  return /<head[^>]*>/i.test(body)
    ? body.replace(/<head[^>]*>/i, (head) => `${head}<meta charset="utf-8">${CSP}`)
    : `<!doctype html><html lang="fr"><head><meta charset="utf-8">${CSP}</head><body>${body}</body></html>`;
}
