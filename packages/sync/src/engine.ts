import { type LocalStore } from './store.js';
import { type SyncTransport, TransientError } from './protocol.js';

export interface SyncReport {
  pushed: number;
  rejected: number;
  pulled: number;
  uploaded: number;
  uploadFailures: number;
  /** Erreur ayant interrompu la synchronisation (réseau, session…). */
  error?: string;
  /** L'erreur est temporaire : nouvel essai automatique après `retryDelay`. */
  transient?: boolean;
}

export interface EngineOptions {
  batchSize?: number;
  /** Erreur d'upload définitive (fichier refusé) plutôt que temporaire. */
  isPermanentUploadError?: (error: unknown) => boolean;
  onChange?: () => void;
  now?: () => Date;
}

const MAX_DELAY = 5 * 60_000;

/**
 * Moteur de synchronisation (P3.2.5). Une passe = envoi des mutations, envoi des fichiers,
 * réception des changements. Une seule passe à la fois ; les déclencheurs (réseau retrouvé,
 * retour au premier plan, bouton) appellent simplement `sync()`.
 */
export class SyncEngine {
  private running?: Promise<SyncReport>;
  private failures = 0;

  constructor(
    private readonly store: LocalStore,
    private readonly transport: SyncTransport,
    private readonly options: EngineOptions = {},
  ) {}

  get busy(): boolean {
    return this.running !== undefined;
  }

  /** Délai avant le prochain essai automatique (backoff exponentiel, 0 sans échec). */
  get retryDelay(): number {
    return this.failures === 0 ? 0 : Math.min(MAX_DELAY, 5_000 * 2 ** (this.failures - 1));
  }

  sync(): Promise<SyncReport> {
    this.running ??= this.run().finally(() => {
      this.running = undefined;
      this.options.onChange?.();
    });
    return this.running;
  }

  private async run(): Promise<SyncReport> {
    const report: SyncReport = {
      pushed: 0,
      rejected: 0,
      pulled: 0,
      uploaded: 0,
      uploadFailures: 0,
    };
    const store = this.store;
    try {
      store.resetSending();

      // 1. Mutations, dans l'ordre, par lots. Une réponse perdue fait renvoyer le lot : le
      //    serveur reconnaît les mutations déjà appliquées (même identifiant).
      for (;;) {
        const batch = store.pendingMutations(this.options.batchSize ?? 50);
        if (batch.length === 0) break;
        store.markSending(batch.map((m) => m.id));
        let results;
        try {
          results = await this.transport.push(batch.map((m) => m.payload));
        } catch (error) {
          store.resetSending();
          throw error;
        }
        const outcome = store.applyResults(results);
        report.pushed += outcome.applied;
        report.rejected += outcome.rejected;
        this.options.onChange?.();
      }

      // 2. Fichiers, indépendamment des fiches (le serveur accepte la référence avant l'objet).
      for (;;) {
        const uploads = store.pendingUploads();
        if (uploads.length === 0) break;
        for (const upload of uploads) {
          store.markUploading(upload.fileId);
          try {
            await this.transport.upload(upload);
            store.markUploaded(upload.fileId);
            report.uploaded++;
          } catch (error) {
            if (this.options.isPermanentUploadError?.(error)) {
              store.markUploadFailed(upload.fileId, (error as Error).message);
              report.uploadFailures++;
            } else {
              store.markUploadPending(upload.fileId, (error as Error).message);
              throw error;
            }
          }
          this.options.onChange?.();
        }
      }

      // 3. Changements du serveur, page par page (curseur avancé avec chaque page).
      for (;;) {
        const page = await this.transport.pull(store.cursor);
        store.applyPull(page);
        report.pulled += page.submissions.length;
        if (!page.hasMore) break;
      }

      store.setMeta('lastSyncAt', (this.options.now?.() ?? new Date()).toISOString());
      this.failures = 0;
    } catch (error) {
      this.failures++;
      report.error = (error as Error).message;
      report.transient = error instanceof TransientError;
    }
    return report;
  }
}
