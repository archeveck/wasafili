/** Modèle de nommage par défaut : un dossier par fiche, un fichier par photo. */
export const DEFAULT_PATTERN = '{date}_{fiche}/{champ}_{n}';

/** Jetons d'un modèle de nommage (P6.4). `{valeur:cle}` lit un champ de la fiche. */
export const PATTERN_TOKENS = [
  'structure',
  'fiche',
  'id',
  'date',
  'etat',
  'auteur',
  'champ',
  'libelle',
  'n',
  'original',
] as const;
export type PatternToken = (typeof PATTERN_TOKENS)[number];

const TOKEN = /\{([a-z]+)(?::([A-Za-z0-9_]+))?\}/g;
const MAX_SEGMENT = 100;

/** Erreurs d'un modèle : jeton inconnu, accolade orpheline. Liste vide si le modèle est valide. */
export function patternErrors(pattern: string): string[] {
  const errors: string[] = [];
  for (const match of pattern.matchAll(TOKEN)) {
    const [, name, argument] = match;
    if (name === 'valeur') {
      if (!argument) errors.push('{valeur:cle} attend la clé d’un champ');
    } else if (!(PATTERN_TOKENS as readonly string[]).includes(name!) || argument) {
      errors.push(`Jeton inconnu : ${match[0]}`);
    }
  }
  if (/[{}]/.test(pattern.replace(TOKEN, ''))) errors.push('Accolade sans jeton');
  if (pattern.trim() === '') errors.push('Modèle vide');
  return errors;
}

/** Segment de chemin sûr dans une archive (ni `..`, ni séparateur, ni caractère interdit). */
export function safeSegment(value: string): string {
  const cleaned = value
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '_')
    .slice(0, MAX_SEGMENT)
    .trim();
  return cleaned === '' ? '_' : cleaned;
}

export type PatternValues = Record<PatternToken, string> & { values: Record<string, unknown> };

/** Chemin d'une photo dans l'archive, sans extension. */
export function renderPattern(pattern: string, values: PatternValues): string {
  return pattern
    .split('/')
    .map((segment) =>
      segment.replace(TOKEN, (_match, name: string, argument?: string) => {
        if (name === 'valeur') {
          const value = values.values[argument!];
          return typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
            ? String(value)
            : '';
        }
        return values[name as PatternToken] ?? '';
      }),
    )
    .map(safeSegment)
    .join('/');
}

/** Ajoute l'extension et rend chaque chemin unique (`-2`, `-3`… en cas de collision). */
export function uniquePaths(): (base: string, extension: string) => string {
  const used = new Set<string>();
  return (base, extension) => {
    const suffix = extension ? `.${extension}` : '';
    let candidate = `${base}${suffix}`;
    for (let i = 2; used.has(candidate.toLowerCase()); i += 1) candidate = `${base}-${i}${suffix}`;
    used.add(candidate.toLowerCase());
    return candidate;
  };
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/gif': 'gif',
};

/** Extension d'après le type MIME, sinon d'après le nom d'origine. */
export function extensionOf(mimeType: string, name: string): string {
  const known = EXTENSIONS[mimeType.toLowerCase()];
  if (known) return known;
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  return match ? match[1]!.toLowerCase() : '';
}
