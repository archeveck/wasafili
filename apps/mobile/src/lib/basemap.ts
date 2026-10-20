import NetInfo from '@react-native-community/netinfo';
import { LogManager, type StyleSpecification } from '@maplibre/maplibre-react-native';
import { layers, namedFlavor } from '@protomaps/basemaps';
import { Directory, File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';
import { serverUrl } from './session';

/**
 * Fond de carte hors ligne (P3.4.5, D3) : extraction allégée du fond du back-office
 * (`infra/maps/fetch-basemap.sh`, zone Côte d'Ivoire), téléchargée une fois sur l'appareil puis
 * lue par MapLibre sans réseau (`pmtiles://file://…`). Servie sous la même origine que l'API
 * (`/tiles/`, `/maps/fonts/`), comme pour le back-office. Sans fichier, les cartes affichent
 * un fond neutre : la saisie n'en dépend jamais (D4).
 */
const TILES_PATH = '/tiles/basemap-mobile.pmtiles';
/** Polices des libellés, mêmes fichiers que `apps/web/public/maps/fonts`. */
const FONTS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'];
const GLYPH_RANGES = ['0-255', '256-511', '8192-8447'];
/** En-tête d'une archive PMTiles : écarte une page d'erreur enregistrée par mégarde. */
const MAGIC = 'PMTiles';

// Seules les plages latines sont fournies (comme sur le web) : un nom en tifinagh, par exemple,
// s'affiche sans ses caractères. Message attendu, retiré de la console ; les autres restent.
LogManager.onLog(({ message }) => message.startsWith('Failed to load glyph range'));

export type BasemapState =
  | { status: 'absent'; error?: string }
  | { status: 'downloading'; progress: number }
  | { status: 'ready'; size: number; downloadedAt: number | null };

const directory = () => new Directory(Paths.document, 'carte');
const tilesFile = () => new File(directory(), 'basemap.pmtiles');
const fontsDirectory = () => new Directory(directory(), 'fonts');

function readState(): BasemapState {
  const file = tilesFile();
  return file.exists
    ? { status: 'ready', size: file.size, downloadedAt: file.modificationTime }
    : { status: 'absent' };
}

let state: BasemapState = readState();
let controller: AbortController | undefined;
const listeners = new Set<() => void>();
const set = (next: BasemapState) => {
  state = next;
  listeners.forEach((listener) => listener());
};

function hasPmtilesHeader(file: File): boolean {
  const handle = file.open();
  try {
    return String.fromCharCode(...handle.readBytesSync(MAGIC.length)) === MAGIC;
  } finally {
    handle.close();
  }
}

/**
 * Télécharge (ou remplace) le fond de carte. Le fichier en service n'est remplacé qu'après un
 * transfert complet et vérifié : une coupure laisse l'ancien fond intact.
 */
export async function downloadBasemap(): Promise<void> {
  if (state.status === 'downloading') return;
  const previous = state;
  controller = new AbortController();
  set({ status: 'downloading', progress: 0 });
  const base = serverUrl();
  const part = new File(directory(), 'basemap.part');
  try {
    if (!directory().exists) directory().create({ intermediates: true });
    for (const font of FONTS) {
      const target = new Directory(fontsDirectory(), font);
      if (!target.exists) target.create({ intermediates: true });
      for (const range of GLYPH_RANGES) {
        await File.createDownloadTask(
          `${base}/maps/fonts/${encodeURIComponent(font)}/${range}.pbf`,
          new File(target, `${range}.pbf`),
          { sessionType: 'foreground', signal: controller.signal },
        ).downloadAsync();
      }
    }
    if (part.exists) part.delete();
    const downloaded = await File.createDownloadTask(`${base}${TILES_PATH}`, part, {
      signal: controller.signal,
      onProgress: ({ bytesWritten, totalBytes }) => {
        if (totalBytes > 0) set({ status: 'downloading', progress: bytesWritten / totalBytes });
      },
    }).downloadAsync();
    if (!downloaded || !hasPmtilesHeader(part)) throw new Error('Fichier reçu invalide.');
    const file = tilesFile();
    if (file.exists) file.delete();
    part.move(file);
    set(readState());
  } catch (error) {
    if (part.exists) part.delete();
    const aborted = error instanceof Error && error.name === 'AbortError';
    set(
      previous.status === 'ready'
        ? previous
        : aborted
          ? { status: 'absent' }
          : {
              status: 'absent',
              error: /HTTP 404/.test(String(error))
                ? 'Le serveur ne propose pas de fond de carte.'
                : 'Téléchargement interrompu. Réessayez avec une meilleure connexion.',
            },
    );
  } finally {
    controller = undefined;
  }
}

export const cancelBasemapDownload = () => controller?.abort();

export function deleteBasemap() {
  controller?.abort();
  if (directory().exists) directory().delete();
  set(readState());
}

let prefetchTried = false;
/**
 * Préchargement : une tentative par lancement, dès qu'un réseau Wi-Fi est disponible (le fichier
 * pèse plusieurs dizaines de Mo). Sur réseau mobile, le téléchargement reste manuel.
 */
export function startBasemapPrefetch() {
  NetInfo.addEventListener((network) => {
    if (prefetchTried || state.status !== 'absent' || network.type !== 'wifi') return;
    if (network.isInternetReachable === false) return;
    prefetchTried = true;
    void downloadBasemap();
  });
}

export function useBasemap(): BasemapState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

const ATTRIBUTION = '© contributeurs OpenStreetMap';

/** Style MapLibre : fond vectoriel local s'il est présent, sinon fond neutre. */
export function basemapStyle(ready: boolean): StyleSpecification {
  const root = directory().uri.replace(/\/$/, '');
  return {
    version: 8,
    glyphs: `${root}/fonts/{fontstack}/{range}.pbf`,
    sources: ready
      ? {
          protomaps: {
            type: 'vector',
            url: `pmtiles://${tilesFile().uri}`,
            attribution: ATTRIBUTION,
          },
        }
      : {},
    layers: ready
      ? layers('protomaps', namedFlavor('light'), { lang: 'fr' })
      : [{ id: 'fond', type: 'background', paint: { 'background-color': '#eef0ec' } }],
  };
}
