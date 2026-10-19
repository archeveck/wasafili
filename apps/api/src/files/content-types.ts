/**
 * Types de fichiers (P7.4.2). Les fichiers sont déposés directement dans le stockage par URL
 * signée : l'API ne voit pas leur contenu au dépôt, d'où trois garde-fous.
 */

/** Contenus actifs (interprétés par un navigateur) ou exécutables : refusés dès la demande. */
const BLOCKED = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/javascript',
  'application/javascript',
  'application/ecmascript',
  'text/xml',
  'application/xml',
  'application/x-msdownload',
  'application/vnd.microsoft.portable-executable',
  'application/x-sh',
  'application/java-archive',
]);

export const isBlockedType = (mimeType: string): boolean => BLOCKED.has(mimeType.toLowerCase());

const ascii = (bytes: Buffer, start: number, end: number) =>
  bytes.subarray(start, end).toString('latin1');

/**
 * Signatures des seuls types affichés dans le navigateur (images, PDF) : vérifiées à la
 * confirmation du dépôt ; tout autre type est servi en téléchargement.
 */
const SIGNATURES: Record<string, (head: Buffer) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
  'image/gif': (b) => ascii(b, 0, 4) === 'GIF8',
  'image/webp': (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP',
  'image/heic': (b) => ascii(b, 4, 8) === 'ftyp',
  'image/heif': (b) => ascii(b, 4, 8) === 'ftyp',
  'application/pdf': (b) => ascii(b, 0, 5) === '%PDF-',
};

/** Octets lus au début d'un fichier pour vérifier sa signature. */
export const SIGNATURE_BYTES = 12;

/** Le fichier peut-il s'afficher dans le navigateur (sinon : téléchargement) ? */
export const isInlineType = (mimeType: string): boolean => mimeType.toLowerCase() in SIGNATURES;

/** Le début du fichier correspond-il au type annoncé ? Vrai pour un type sans signature connue. */
export function matchesSignature(mimeType: string, head: Buffer): boolean {
  const check = SIGNATURES[mimeType.toLowerCase()];
  return !check || check(head);
}
