import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { store } from './offline';

export interface StoredFile {
  fileId: string;
  uri: string;
  name: string;
  mimeType: string;
  size: number;
}

/** Dossier permanent des fichiers saisis (les URI de la caméra sont temporaires). */
function filesDirectory(): Directory {
  const directory = new Directory(Paths.document, 'fichiers');
  if (!directory.exists) directory.create({ intermediates: true });
  return directory;
}

/** Photo compressée (qualité et dimension réglées dans le formulaire) puis conservée. */
export async function storePhoto(
  sourceUri: string,
  options: { quality?: number; maxDimension?: number } = {},
): Promise<StoredFile> {
  const context = ImageManipulator.manipulate(sourceUri);
  context.resize({ width: options.maxDimension ?? 1600 });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: options.quality ?? 0.7,
  });
  return keep(new File(saved.uri), 'image/jpeg', 'jpg');
}

/** Image produite par l'application (signature, annotation). */
export function storeBytes(bytes: Uint8Array, mimeType: string, extension: string): StoredFile {
  const fileId = randomUUID();
  const file = new File(filesDirectory(), `${fileId}.${extension}`);
  file.create();
  file.write(bytes);
  // Taille des octets écrits : la propriété `size` peut être lue avant la fin de l'écriture.
  return { fileId, uri: file.uri, name: `${fileId}.${extension}`, mimeType, size: bytes.length };
}

function keep(source: File, mimeType: string, extension: string): StoredFile {
  const fileId = randomUUID();
  const target = new File(filesDirectory(), `${fileId}.${extension}`);
  source.copy(target);
  return {
    fileId,
    uri: target.uri,
    name: `${fileId}.${extension}`,
    mimeType,
    size: sizeOf(target, source),
  };
}

/** Taille relue sur le disque (objet neuf : pas de valeur en cache), sinon celle de la source. */
function sizeOf(target: File, source: File): number {
  const size = new File(target.uri).size || source.size;
  if (!size) throw new Error('Fichier vide ou illisible');
  return size;
}

/** Met le fichier en file d'envoi et renvoie la référence à stocker dans la fiche. */
export function enqueueFile(file: StoredFile, submissionId?: string) {
  store.addUpload({ ...file, ...(submissionId ? { submissionId } : {}) });
  return { fileId: file.fileId, name: file.name, mimeType: file.mimeType, size: file.size };
}

/** Fichier choisi par l'utilisateur (sélecteur de documents) : copié et conservé tel quel. */
export function storePickedFile(uri: string, name: string, mimeType: string): StoredFile {
  const fileId = randomUUID();
  const target = new File(filesDirectory(), `${fileId}-${name.replace(/[^\w.-]/g, '_')}`);
  const source = new File(uri);
  source.copy(target);
  return { fileId, uri: target.uri, name, mimeType, size: sizeOf(target, source) };
}
