import NetInfo from '@react-native-community/netinfo';
import { ApiError } from '@wasafili/sdk';
import {
  LocalStore,
  SyncEngine,
  type SyncReport,
  type SyncTransport,
  TransientError,
} from '@wasafili/sync';
import { randomUUID } from 'expo-crypto';
import { File } from 'expo-file-system';
import { AppState } from 'react-native';
import { useSyncExternalStore } from 'react';
import { openDeviceDatabase } from './db';
import { client, currentInstance } from './session';

/** Erreurs réseau et serveur : temporaires (nouvel essai) ; autres : définitives. */
async function transient<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof TypeError || (error instanceof ApiError && error.status >= 500)) {
      throw new TransientError(error.message);
    }
    throw error;
  }
}

const transport: SyncTransport = {
  pull: (cursor) => transient(() => client.app(currentInstance()!).sync.pull(cursor)),
  push: (mutations) =>
    transient(async () => (await client.app(currentInstance()!).sync.push(mutations)).results),
  // Envoi direct du fichier local vers l'URL signée (session d'arrière-plan sur iOS).
  upload: (task) =>
    transient(async () => {
      const files = client.app(currentInstance()!).files;
      const { upload } = await files.requestUpload({
        id: task.fileId,
        name: task.name,
        mimeType: task.mimeType,
        size: task.size,
      });
      if (upload) {
        const result = await new File(task.uri).upload(upload.url, {
          httpMethod: 'PUT',
          mimeType: task.mimeType,
          headers: upload.headers,
        });
        if (result.status >= 500)
          throw new TransientError(`Stockage indisponible (${result.status})`);
        if (result.status >= 300)
          throw new ApiError(result.status, 'upload_failed', 'Fichier refusé par le stockage');
      }
      await files.complete(task.fileId);
    }),
};

export const store = new LocalStore(openDeviceDatabase(), { newId: randomUUID });

let version = 0;
let lastReport: SyncReport | undefined;
let online = true;
const listeners = new Set<() => void>();
const notify = () => {
  version++;
  listeners.forEach((listener) => listener());
};

export const engine = new SyncEngine(store, transport, {
  onChange: notify,
  isPermanentUploadError: (error) => error instanceof ApiError && error.status < 500,
});

let retry: ReturnType<typeof setTimeout> | undefined;

/** Lance une synchronisation (si connecté à une instance) et programme le nouvel essai. */
export async function synchronize(): Promise<SyncReport | undefined> {
  if (!currentInstance() || !client.isAuthenticated()) return undefined;
  clearTimeout(retry);
  lastReport = await engine.sync();
  if (lastReport.transient && engine.retryDelay > 0)
    retry = setTimeout(() => void synchronize(), engine.retryDelay);
  notify();
  return lastReport;
}

let started = false;
/** Déclencheurs (P3.2.5) : réseau retrouvé, retour au premier plan, puis toutes les 10 minutes. */
export function startSyncTriggers() {
  if (started) return;
  started = true;
  NetInfo.addEventListener((state) => {
    const reachable = state.isConnected !== false && state.isInternetReachable !== false;
    if (reachable && !online) void synchronize();
    if (reachable !== online) {
      online = reachable;
      notify();
    }
  });
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void synchronize();
  });
  setInterval(() => void synchronize(), 10 * 60_000);
  void synchronize();
}

/** Signale une écriture locale (rafraîchit l'interface et pousse dès que possible). */
export function changed() {
  notify();
  void synchronize();
}

/** Abonnement de l'interface à la base locale et à l'état de synchronisation. */
export function useOffline() {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
  );
  return {
    store,
    stats: store.stats(),
    busy: engine.busy,
    online,
    lastReport,
    settings: store.getMeta<Record<string, unknown>>('settings'),
  };
}
