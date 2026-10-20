import { initialState, type StructureDefinition, type SubmissionData } from '@wasafili/form-schema';
import { migrate, type SqlDatabase, type SqlValue } from './db.js';
import {
  type MutationPayload,
  type MutationResult,
  type NotificationDto,
  type PulledSubmission,
  type PulledTask,
  type PullResponse,
  type RevisionDto,
  type TaskStatus,
  type UploadTask,
} from './protocol.js';

export type SubmissionStatus = 'draft' | 'pending' | 'synced' | 'error';

export interface LocalStructure {
  id: string;
  name: string;
  description: string | null;
  currentVersionId: string | null;
  rights: string[];
}

export interface LocalVersion {
  id: string;
  structureId: string;
  version: number;
  definition: StructureDefinition;
}

export interface LocalListItem {
  id: string;
  listId: string;
  parentId: string | null;
  level: number;
  code: string | null;
  label: string;
  attributes: Record<string, unknown>;
}

export interface Location {
  lat: number;
  lng: number;
  accuracy?: number | null;
}

export interface LocalSubmission {
  id: string;
  structureId: string;
  versionId: string;
  /** Données vues localement : serveur + modifications en attente. */
  data: SubmissionData;
  /** Dernière copie reçue du serveur (null : jamais synchronisée). */
  serverData: SubmissionData | null;
  revision: number | null;
  status: SubmissionStatus;
  /** État de workflow vu localement : serveur, ou cible d'une transition en attente. */
  state: string | null;
  authorId: string | null;
  /** Tâche dont la fiche est issue. */
  taskId: string | null;
  location: Location | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LocalTask {
  id: string;
  structureId: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  dueAt: string | null;
  locationLabel: string | null;
  location: { lat: number; lng: number } | null;
  prefill: SubmissionData;
  /** `done` dès qu'une fiche a été saisie depuis la tâche, même non encore envoyée. */
  status: TaskStatus;
  submissionId: string | null;
}

export interface LocalNotification extends Omit<NotificationDto, 'readAt'> {
  read: boolean;
}

export interface QueuedMutation {
  seq: number;
  id: string;
  submissionId: string;
  type: MutationPayload['type'];
  payload: MutationPayload;
  status: 'pending' | 'sending' | 'failed';
  attempts: number;
  error: string | null;
}

export interface QueueStats {
  drafts: number;
  pending: number;
  failed: number;
  uploadsPending: number;
  uploadsFailed: number;
  lastSyncAt: string | null;
}

interface SubmissionRow {
  id: string;
  structure_id: string;
  version_id: string;
  server_data: string | null;
  local_data: string;
  revision: number | null;
  status: SubmissionStatus;
  state: string | null;
  author_id: string | null;
  task_id: string | null;
  location: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

interface MutationRow {
  seq: number;
  id: string;
  submission_id: string;
  type: MutationPayload['type'];
  payload: string;
  status: QueuedMutation['status'];
  attempts: number;
  error: string | null;
}

export interface StoreOptions {
  newId: () => string;
  now?: () => Date;
}

const parse = <T>(json: string | null): T | null =>
  json === null ? null : (JSON.parse(json) as T);

function toSubmission(row: SubmissionRow): LocalSubmission {
  return {
    id: row.id,
    structureId: row.structure_id,
    versionId: row.version_id,
    data: JSON.parse(row.local_data) as SubmissionData,
    serverData: parse<SubmissionData>(row.server_data),
    revision: row.revision,
    status: row.status,
    state: row.state,
    authorId: row.author_id,
    taskId: row.task_id,
    location: parse<Location>(row.location),
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMutation(row: MutationRow): QueuedMutation {
  return {
    seq: row.seq,
    id: row.id,
    submissionId: row.submission_id,
    type: row.type,
    payload: JSON.parse(row.payload) as MutationPayload,
    status: row.status,
    attempts: row.attempts,
    error: row.error,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Base locale de l'application mobile (P3.2.1) : données de référence, fiches, file de
 * mutations et file d'uploads. Toute écriture locale est d'abord persistée, puis envoyée par le
 * moteur de synchronisation : un arrêt de l'application ne perd rien.
 */
export class LocalStore {
  private readonly newId: () => string;
  private readonly now: () => Date;
  private depth = 0;

  constructor(
    readonly db: SqlDatabase,
    options: StoreOptions,
  ) {
    this.newId = options.newId;
    this.now = options.now ?? (() => new Date());
    migrate(db);
  }

  /** Transaction ; les appels imbriqués rejoignent la transaction englobante. */
  tx<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.depth++;
    try {
      return this.db.transaction(fn);
    } finally {
      this.depth--;
    }
  }

  // --- Métadonnées -------------------------------------------------------------------

  getMeta<T>(key: string): T | null {
    return parse<T>(
      this.db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key])?.value ?? null,
    );
  }

  setMeta(key: string, value: unknown): void {
    this.db.run(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      [key, JSON.stringify(value)],
    );
  }

  /** Efface toutes les données (déconnexion, changement d'instance). */
  reset(): void {
    this.tx(() => {
      for (const table of [
        'meta',
        'structures',
        'versions',
        'lists',
        'list_items',
        'submissions',
        'mutations',
        'uploads',
        'submissions_fts',
        'tasks',
        'notifications',
        'submission_history',
      ]) {
        this.db.run(`DELETE FROM ${table}`);
      }
    });
  }

  // --- Données de référence -------------------------------------------------------------

  structures(): LocalStructure[] {
    return this.db
      .all<{
        id: string;
        name: string;
        description: string | null;
        current_version_id: string | null;
        rights: string;
      }>('SELECT * FROM structures ORDER BY name')
      .map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        currentVersionId: row.current_version_id,
        rights: JSON.parse(row.rights) as string[],
      }));
  }

  structure(id: string): LocalStructure | undefined {
    return this.structures().find((structure) => structure.id === id);
  }

  version(id: string): LocalVersion | undefined {
    const row = this.db.get<{
      id: string;
      structure_id: string;
      version: number;
      definition: string;
    }>('SELECT * FROM versions WHERE id = ?', [id]);
    return (
      row && {
        id: row.id,
        structureId: row.structure_id,
        version: row.version,
        definition: JSON.parse(row.definition) as StructureDefinition,
      }
    );
  }

  currentVersion(structureId: string): LocalVersion | undefined {
    const id = this.structure(structureId)?.currentVersionId;
    return id ? this.version(id) : undefined;
  }

  /** Éléments d'un référentiel (cascade par parent, niveau, recherche). */
  listItems(
    listId: string,
    options: { parentId?: string | null; level?: number; q?: string; limit?: number } = {},
  ): LocalListItem[] {
    const where = ['list_id = ?', 'archived = 0'];
    const params: SqlValue[] = [listId];
    if (options.parentId === null) where.push('parent_id IS NULL');
    else if (options.parentId !== undefined) {
      where.push('parent_id = ?');
      params.push(options.parentId);
    }
    if (options.level !== undefined) {
      where.push('level = ?');
      params.push(options.level);
    }
    if (options.q) {
      where.push('(label LIKE ? OR code LIKE ?)');
      params.push(`%${options.q}%`, `%${options.q}%`);
    }
    params.push(options.limit ?? 500);
    return this.db
      .all<ItemRow>(
        `SELECT * FROM list_items WHERE ${where.join(' AND ')} ORDER BY position, label LIMIT ?`,
        params,
      )
      .map(toItem);
  }

  /** Élément par code, dans tous les référentiels (scan QR, hors ligne). */
  lookupCode(code: string): LocalListItem[] {
    return this.db
      .all<ItemRow>('SELECT * FROM list_items WHERE code = ? AND archived = 0', [code])
      .map(toItem);
  }

  itemLabels(ids: string[]): Map<string, string> {
    if (ids.length === 0) return new Map();
    const rows = this.db.all<{ id: string; label: string }>(
      `SELECT id, label FROM list_items WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids,
    );
    return new Map(rows.map((row) => [row.id, row.label]));
  }

  // --- Fiches --------------------------------------------------------------------------

  submissions(
    options: { structureId?: string; status?: SubmissionStatus; q?: string; limit?: number } = {},
  ): LocalSubmission[] {
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (options.structureId) {
      where.push('s.structure_id = ?');
      params.push(options.structureId);
    }
    if (options.status) {
      where.push('s.status = ?');
      params.push(options.status);
    }
    let from = 'submissions s';
    if (options.q?.trim()) {
      // Recherche plein texte locale (FTS5), insensible aux accents, par préfixe.
      from = 'submissions s JOIN submissions_fts f ON f.id = s.id';
      where.push('submissions_fts MATCH ?');
      params.push(
        options.q
          .trim()
          .split(/\s+/)
          .map((term) => `"${term.replace(/"/g, '""')}"*`)
          .join(' '),
      );
    }
    params.push(options.limit ?? 200);
    return this.db
      .all<SubmissionRow>(
        `SELECT s.* FROM ${from} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.updated_at DESC LIMIT ?`,
        params,
      )
      .map(toSubmission);
  }

  submission(id: string): LocalSubmission | undefined {
    const row = this.db.get<SubmissionRow>('SELECT * FROM submissions WHERE id = ?', [id]);
    return row && toSubmission(row);
  }

  /** Enregistre un brouillon (local uniquement, jamais envoyé tel quel). */
  saveDraft(input: {
    id?: string;
    structureId: string;
    data: SubmissionData;
    location?: Location | null;
    /** Fiche saisie depuis une tâche (conservé aux enregistrements suivants). */
    taskId?: string | null;
  }): string {
    const existing = input.id ? this.submission(input.id) : undefined;
    if (existing && existing.status !== 'draft')
      throw new Error('Seul un brouillon peut être réenregistré');
    const version = existing
      ? this.version(existing.versionId)
      : this.currentVersion(input.structureId);
    if (!version) throw new Error('Formulaire non disponible hors ligne');
    const id = input.id ?? this.newId();
    const now = this.now().toISOString();
    this.tx(() => {
      this.db.run(
        `INSERT INTO submissions (id, structure_id, version_id, local_data, status, state, location, task_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET local_data = excluded.local_data, location = excluded.location,
           task_id = COALESCE(excluded.task_id, submissions.task_id), updated_at = excluded.updated_at`,
        [
          id,
          input.structureId,
          version.id,
          JSON.stringify(input.data),
          initialState(version.definition.workflow),
          JSON.stringify(input.location ?? null),
          input.taskId ?? null,
          now,
          now,
        ],
      );
      this.index(id, input.data);
    });
    return id;
  }

  /**
   * Passe un brouillon à l'envoi : création mise en file (identifiant client conservé), suivie
   * de la transition choisie s'il y en a une (bouton d'enregistrement du workflow).
   */
  submit(id: string, data?: SubmissionData, transition?: { key: string; to: string }): void {
    const draft = this.submission(id);
    if (draft?.status !== 'draft') throw new Error('Brouillon introuvable');
    const values = data ?? draft.data;
    this.tx(() => {
      this.db.run(
        `UPDATE submissions SET local_data = ?, status = 'pending', updated_at = ? WHERE id = ?`,
        [JSON.stringify(values), this.now().toISOString(), id],
      );
      this.index(id, values);
      this.enqueue({
        id: this.newId(),
        type: 'create',
        submissionId: id,
        structureId: draft.structureId,
        data: values,
        ...(draft.location
          ? {
              location: {
                lat: draft.location.lat,
                lng: draft.location.lng,
                ...(draft.location.accuracy != null ? { accuracy: draft.location.accuracy } : {}),
              },
            }
          : {}),
        ...(draft.taskId ? { taskId: draft.taskId } : {}),
      });
      if (draft.taskId) {
        this.db.run('UPDATE tasks SET local_submission_id = ? WHERE id = ?', [id, draft.taskId]);
      }
      if (transition) {
        this.enqueue(
          { id: this.newId(), type: 'transition', submissionId: id, transition: transition.key },
          transition.to,
        );
        this.db.run('UPDATE submissions SET state = ? WHERE id = ?', [transition.to, id]);
      }
    });
  }

  /**
   * Transition de workflow hors ligne (P4.1.4) : l'état cible s'affiche aussitôt ; le serveur
   * revérifie tout et peut refuser (fiche passée entre-temps à un autre état…). La vérification
   * locale (`checkTransition` de form-engine) incombe à l'appelant.
   */
  transition(id: string, transition: { key: string; to: string }, data?: SubmissionData): void {
    const current = this.submission(id);
    if (!current) throw new Error('Fiche introuvable');
    if (current.status === 'draft') {
      this.submit(id, data, transition);
      return;
    }
    const changed = data ? this.changedFields(current.data, data) : {};
    const local = { ...current.data, ...changed };
    this.tx(() => {
      this.db.run(
        `UPDATE submissions SET local_data = ?, state = ?, status = CASE WHEN status = 'error' THEN 'error' ELSE 'pending' END, updated_at = ? WHERE id = ?`,
        [JSON.stringify(local), transition.to, this.now().toISOString(), id],
      );
      this.index(id, local);
      this.enqueue(
        {
          id: this.newId(),
          type: 'transition',
          submissionId: id,
          transition: transition.key,
          ...(current.revision !== null ? { baseRevision: current.revision } : {}),
          ...(Object.keys(changed).length > 0 ? { data: changed } : {}),
        },
        transition.to,
      );
    });
  }

  private changedFields(before: SubmissionData, after: SubmissionData): SubmissionData {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return Object.fromEntries(
      [...keys]
        .filter((key) => !same(before[key], after[key]))
        .map((key) => [key, after[key] ?? null]),
    );
  }

  /** Modifie une fiche : seuls les champs changés partent, fondés sur la révision connue. */
  edit(id: string, data: SubmissionData): void {
    const current = this.submission(id);
    if (!current) throw new Error('Fiche introuvable');
    if (current.status === 'draft') {
      this.saveDraft({ id, structureId: current.structureId, data, location: current.location });
      return;
    }
    const changed = this.changedFields(current.data, data);
    if (Object.keys(changed).length === 0) return;
    this.tx(() => {
      this.db.run(
        `UPDATE submissions SET local_data = ?, status = CASE WHEN status = 'error' THEN 'error' ELSE 'pending' END, updated_at = ? WHERE id = ?`,
        [JSON.stringify({ ...current.data, ...changed }), this.now().toISOString(), id],
      );
      this.index(id, { ...current.data, ...changed });
      this.enqueue({
        id: this.newId(),
        type: 'update',
        submissionId: id,
        ...(current.revision !== null ? { baseRevision: current.revision } : {}),
        data: changed,
      });
    });
  }

  /** Supprime une fiche ; un brouillon ou une création jamais tentée disparaît sans appel serveur. */
  remove(id: string): void {
    const current = this.submission(id);
    if (!current) return;
    this.tx(() => {
      const sent = this.db.get<{ n: number }>(
        `SELECT count(*) AS n FROM mutations WHERE submission_id = ? AND (attempts > 0 OR type <> 'create')`,
        [id],
      )!.n;
      const neverSent = current.status === 'draft' || (current.serverData === null && sent === 0);
      this.db.run(`DELETE FROM mutations WHERE submission_id = ? AND attempts = 0`, [id]);
      if (!neverSent) this.enqueue({ id: this.newId(), type: 'delete', submissionId: id });
      this.deleteLocal(id);
    });
  }

  // --- File de mutations ----------------------------------------------------------------

  private enqueue(payload: MutationPayload, targetState: string | null = null): void {
    // Regroupe une modification avec la précédente si celle-ci n'a jamais été tentée : on
    // ne modifie jamais une mutation qui a pu atteindre le serveur (son identifiant y est connu).
    const last = this.db.get<MutationRow>(
      'SELECT * FROM mutations WHERE submission_id = ? ORDER BY seq DESC LIMIT 1',
      [payload.submissionId],
    );
    if (
      payload.type === 'update' &&
      last &&
      last.status === 'pending' &&
      last.attempts === 0 &&
      (last.type === 'create' || last.type === 'update')
    ) {
      const previous = JSON.parse(last.payload) as Extract<
        MutationPayload,
        { data: SubmissionData }
      >;
      this.db.run('UPDATE mutations SET payload = ? WHERE seq = ?', [
        JSON.stringify({ ...previous, data: { ...previous.data, ...payload.data } }),
        last.seq,
      ]);
      return;
    }
    this.db.run(
      `INSERT INTO mutations (id, submission_id, type, payload, base_revision, target_state, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        payload.id,
        payload.submissionId,
        payload.type,
        JSON.stringify(payload),
        'baseRevision' in payload ? (payload.baseRevision ?? null) : null,
        targetState,
        this.now().toISOString(),
      ],
    );
  }

  /** Mutations à envoyer, dans l'ordre de création. */
  pendingMutations(limit = 50): QueuedMutation[] {
    return this.db
      .all<MutationRow>(`SELECT * FROM mutations WHERE status = 'pending' ORDER BY seq LIMIT ?`, [
        limit,
      ])
      .map(toMutation);
  }

  failedMutations(): QueuedMutation[] {
    return this.db
      .all<MutationRow>(`SELECT * FROM mutations WHERE status = 'failed' ORDER BY seq`)
      .map(toMutation);
  }

  markSending(ids: string[]): void {
    this.tx(() => {
      for (const id of ids) {
        this.db.run(
          `UPDATE mutations SET status = 'sending', attempts = attempts + 1 WHERE id = ?`,
          [id],
        );
      }
    });
  }

  /** Reprise après coupure ou arrêt brutal : les envois interrompus repartent. */
  resetSending(): void {
    this.db.run(`UPDATE mutations SET status = 'pending' WHERE status = 'sending'`);
    this.db.run(`UPDATE uploads SET status = 'pending' WHERE status = 'uploading'`);
  }

  applyResults(results: MutationResult[]): { applied: number; rejected: number } {
    let applied = 0;
    let rejected = 0;
    this.tx(() => {
      for (const result of results) {
        const row = this.db.get<MutationRow>('SELECT * FROM mutations WHERE id = ?', [result.id]);
        if (!row) continue;
        if (result.status === 'rejected') {
          rejected++;
          const message = result.error.details
            ? `${result.error.message} ${JSON.stringify(result.error.details)}`
            : result.error.message;
          this.db.run(`UPDATE mutations SET status = 'failed', error = ? WHERE id = ?`, [
            message,
            result.id,
          ]);
          this.db.run(
            `UPDATE submissions SET status = 'error', error = ?, state = ? WHERE id = ?`,
            [result.error.message, this.localState(row.submission_id), row.submission_id],
          );
          continue;
        }
        applied++;
        this.db.run('DELETE FROM mutations WHERE id = ?', [result.id]);
        if (result.submission) this.applyServerSubmission(result.submission);
        else this.refreshStatus(row.submission_id);
      }
    });
    return { applied, rejected };
  }

  /** Renvoie les mutations et fichiers refusés (après correction ou changement de droits). */
  retryFailed(): void {
    this.db.run(`UPDATE mutations SET status = 'pending', error = NULL WHERE status = 'failed'`);
    this.db.run(`UPDATE submissions SET status = 'pending', error = NULL WHERE status = 'error'`);
    this.db.run(`UPDATE uploads SET status = 'pending', error = NULL WHERE status = 'failed'`);
  }

  /** Abandonne une mutation refusée : la fiche revient à la dernière version du serveur. */
  discardMutation(id: string): void {
    const row = this.db.get<MutationRow>('SELECT * FROM mutations WHERE id = ?', [id]);
    if (!row) return;
    this.tx(() => {
      this.db.run('DELETE FROM mutations WHERE id = ?', [id]);
      const current = this.submission(row.submission_id);
      if (!current) return;
      if (current.serverData === null && row.type === 'create') this.deleteLocal(current.id);
      else this.rebase(current.id, current.serverData ?? {});
    });
  }

  // --- Uploads -------------------------------------------------------------------------

  addUpload(task: UploadTask & { submissionId?: string }): void {
    this.db.run(
      `INSERT OR IGNORE INTO uploads (file_id, submission_id, uri, name, mime_type, size, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        task.fileId,
        task.submissionId ?? null,
        task.uri,
        task.name,
        task.mimeType,
        task.size,
        this.now().toISOString(),
      ],
    );
  }

  pendingUploads(limit = 20): (UploadTask & { attempts: number })[] {
    return this.db
      .all<{
        file_id: string;
        uri: string;
        name: string;
        mime_type: string;
        size: number;
        attempts: number;
      }>(`SELECT * FROM uploads WHERE status = 'pending' ORDER BY created_at LIMIT ?`, [limit])
      .map((row) => ({
        fileId: row.file_id,
        uri: row.uri,
        name: row.name,
        mimeType: row.mime_type,
        size: row.size,
        attempts: row.attempts,
      }));
  }

  markUploading(fileId: string): void {
    this.db.run(
      `UPDATE uploads SET status = 'uploading', attempts = attempts + 1 WHERE file_id = ?`,
      [fileId],
    );
  }

  markUploaded(fileId: string): void {
    this.db.run(`UPDATE uploads SET status = 'uploaded', error = NULL WHERE file_id = ?`, [fileId]);
  }

  markUploadPending(fileId: string, error: string): void {
    this.db.run(`UPDATE uploads SET status = 'pending', error = ? WHERE file_id = ?`, [
      error,
      fileId,
    ]);
  }

  markUploadFailed(fileId: string, error: string): void {
    this.db.run(`UPDATE uploads SET status = 'failed', error = ? WHERE file_id = ?`, [
      error,
      fileId,
    ]);
  }

  /** URI locale d'un fichier pas encore (ou récemment) envoyé : affichage hors ligne. */
  localFileUri(fileId: string): string | undefined {
    return this.db.get<{ uri: string }>('SELECT uri FROM uploads WHERE file_id = ?', [fileId])?.uri;
  }

  stats(): QueueStats {
    const count = (sql: string) => this.db.get<{ n: number }>(sql)!.n;
    return {
      drafts: count(`SELECT count(*) AS n FROM submissions WHERE status = 'draft'`),
      pending: count(`SELECT count(*) AS n FROM mutations WHERE status IN ('pending', 'sending')`),
      failed: count(`SELECT count(*) AS n FROM mutations WHERE status = 'failed'`),
      uploadsPending: count(
        `SELECT count(*) AS n FROM uploads WHERE status IN ('pending', 'uploading')`,
      ),
      uploadsFailed: count(`SELECT count(*) AS n FROM uploads WHERE status = 'failed'`),
      lastSyncAt: this.getMeta<string>('lastSyncAt'),
    };
  }

  // --- Pull ----------------------------------------------------------------------------

  get cursor(): string | undefined {
    return this.getMeta<string>('cursor') ?? undefined;
  }

  /** Applique une page de pull et avance le curseur, atomiquement. */
  applyPull(page: PullResponse): void {
    this.tx(() => {
      this.setMeta('settings', page.settings);
      this.db.run('DELETE FROM structures');
      for (const s of page.structures) {
        this.db.run(
          'INSERT INTO structures (id, name, description, current_version_id, rights) VALUES (?, ?, ?, ?, ?)',
          [s.id, s.name, s.description, s.currentVersionId, JSON.stringify(s.rights)],
        );
      }
      for (const v of page.versions) {
        this.db.run(
          'INSERT OR REPLACE INTO versions (id, structure_id, version, definition) VALUES (?, ?, ?, ?)',
          [v.id, v.structureId, v.version, JSON.stringify(v.definition)],
        );
      }
      this.db.run('DELETE FROM lists');
      for (const l of page.lists) {
        this.db.run('INSERT INTO lists (id, name, levels) VALUES (?, ?, ?)', [
          l.id,
          l.name,
          JSON.stringify(l.levels),
        ]);
      }
      // Référentiels supprimés côté serveur (ou devenus inaccessibles) : leurs éléments disparaissent.
      this.db.run(`DELETE FROM list_items WHERE list_id NOT IN (SELECT id FROM lists)`);
      for (const i of page.listItems) {
        this.db.run(
          `INSERT OR REPLACE INTO list_items (id, list_id, parent_id, level, code, label, attributes, position, archived)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            i.id,
            i.listId,
            i.parentId,
            i.level,
            i.code,
            i.label,
            JSON.stringify(i.attributes),
            i.position,
            i.archived ? 1 : 0,
          ],
        );
      }
      for (const submission of page.submissions) this.applyServerSubmission(submission);
      for (const task of page.tasks ?? []) this.applyServerTask(task);
      for (const n of page.notifications ?? []) {
        this.db.run(
          `INSERT INTO notifications (id, type, title, body, data, read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET read = MAX(notifications.read, excluded.read)`,
          [n.id, n.type, n.title, n.body, JSON.stringify(n.data), n.readAt ? 1 : 0, n.createdAt],
        );
      }
      this.setMeta('cursor', page.cursor);
    });
  }

  private applyServerTask(task: PulledTask): void {
    if (task.deleted) {
      this.db.run('DELETE FROM tasks WHERE id = ?', [task.id]);
      return;
    }
    this.db.run(
      `INSERT INTO tasks (id, structure_id, title, description, start_at, end_at, due_at, location_label, location, prefill, status, submission_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET structure_id = excluded.structure_id, title = excluded.title,
         description = excluded.description, start_at = excluded.start_at, end_at = excluded.end_at,
         due_at = excluded.due_at, location_label = excluded.location_label, location = excluded.location,
         prefill = excluded.prefill, status = excluded.status, submission_id = excluded.submission_id,
         local_submission_id = CASE WHEN excluded.submission_id IS NULL THEN tasks.local_submission_id END`,
      [
        task.id,
        task.structureId,
        task.title,
        task.description,
        task.startAt,
        task.endAt,
        task.dueAt,
        task.locationLabel,
        JSON.stringify(task.location),
        JSON.stringify(task.prefill),
        task.status,
        task.submissionId,
      ],
    );
  }

  // --- Tâches et notifications ---------------------------------------------------------

  /** Tâches assignées, par date ; `from`/`to` (ISO) : tâches qui chevauchent la période. */
  tasks(options: { from?: string; to?: string; open?: boolean } = {}): LocalTask[] {
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (options.from) {
      where.push('t.end_at > ?');
      params.push(options.from);
    }
    if (options.to) {
      where.push('t.start_at < ?');
      params.push(options.to);
    }
    const rows = this.db.all<TaskRow>(
      `SELECT t.*, ${TASK_STATUS_SQL} AS local_status FROM tasks t ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY t.start_at, t.id`,
      params,
    );
    const tasks = rows.map(toTask);
    return options.open
      ? tasks.filter((t) => t.status === 'todo' || t.status === 'in_progress')
      : tasks;
  }

  task(id: string): LocalTask | undefined {
    const row = this.db.get<TaskRow>(
      `SELECT t.*, ${TASK_STATUS_SQL} AS local_status FROM tasks t WHERE t.id = ?`,
      [id],
    );
    return row && toTask(row);
  }

  notifications(limit = 100): LocalNotification[] {
    return this.db
      .all<{
        id: string;
        type: NotificationDto['type'];
        title: string;
        body: string | null;
        data: string;
        read: number;
        created_at: string;
      }>('SELECT * FROM notifications ORDER BY created_at DESC, id LIMIT ?', [limit])
      .map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        data: JSON.parse(row.data) as NotificationDto['data'],
        read: row.read === 1,
        createdAt: row.created_at,
      }));
  }

  unreadNotifications(): number {
    return this.db.get<{ n: number }>('SELECT count(*) AS n FROM notifications WHERE read = 0')!.n;
  }

  /** Lecture locale (l'état lu n'est pas renvoyé au serveur). Sans identifiant : toutes. */
  markNotificationsRead(id?: string): void {
    if (id) this.db.run('UPDATE notifications SET read = 1 WHERE id = ?', [id]);
    else this.db.run('UPDATE notifications SET read = 1');
  }

  /**
   * Intègre l'état serveur d'une fiche. Les modifications locales encore en attente sont
   * réappliquées par-dessus (rebasage) : elles ne sont jamais perdues.
   */
  private applyServerSubmission(remote: PulledSubmission): void {
    const pendingDelete = this.db.get<{ n: number }>(
      `SELECT count(*) AS n FROM mutations WHERE submission_id = ? AND type = 'delete'`,
      [remote.id],
    )!.n;
    if (pendingDelete > 0) return;
    if (remote.deleted) {
      this.db.run(`DELETE FROM mutations WHERE submission_id = ? AND attempts = 0`, [remote.id]);
      this.deleteLocal(remote.id);
      return;
    }
    const serverData = remote.data ?? {};
    this.db.run(
      `INSERT INTO submissions (id, structure_id, version_id, server_data, local_data, revision, status, state, server_state, author_id, location, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'synced', ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET version_id = excluded.version_id, server_data = excluded.server_data,
         revision = excluded.revision, server_state = excluded.server_state, author_id = excluded.author_id,
         location = excluded.location, created_at = excluded.created_at, updated_at = excluded.updated_at`,
      [
        remote.id,
        remote.structureId,
        remote.structureVersionId!,
        JSON.stringify(serverData),
        JSON.stringify(serverData),
        remote.revision ?? null,
        remote.state ?? null,
        remote.state ?? null,
        remote.authorId ?? null,
        JSON.stringify(remote.location ?? null),
        remote.createdAt ?? this.now().toISOString(),
        remote.updatedAt ?? this.now().toISOString(),
      ],
    );
    // Absent d'un résultat de push : l'historique reçu au dernier pull reste valable.
    if (remote.history) {
      this.db.run(
        'INSERT OR REPLACE INTO submission_history (submission_id, entries, total) VALUES (?, ?, ?)',
        [remote.id, JSON.stringify(remote.history), remote.historyTotal ?? remote.history.length],
      );
    }
    this.rebase(remote.id, serverData);
  }

  /** Historique d'une fiche reçu du serveur (révisions les plus récentes d'abord). */
  history(id: string): { entries: RevisionDto[]; total: number } | undefined {
    const row = this.db.get<{ entries: string; total: number }>(
      'SELECT entries, total FROM submission_history WHERE submission_id = ?',
      [id],
    );
    return row
      ? { entries: JSON.parse(row.entries) as RevisionDto[], total: row.total }
      : undefined;
  }

  /** Données locales = serveur + champs des mutations non encore appliquées. */
  private rebase(id: string, serverData: SubmissionData): void {
    const pending = this.db
      .all<MutationRow>(
        `SELECT * FROM mutations WHERE submission_id = ? AND type <> 'delete' ORDER BY seq`,
        [id],
      )
      .map(toMutation);
    const local = pending.reduce<SubmissionData>(
      (data, mutation) => ({
        ...data,
        ...('data' in mutation.payload ? mutation.payload.data : {}),
      }),
      { ...serverData },
    );
    const failed = pending.find((m) => m.status === 'failed');
    this.db.run(
      `UPDATE submissions SET local_data = ?, status = ?, error = ?, state = ? WHERE id = ?`,
      [
        JSON.stringify(local),
        failed ? 'error' : pending.length ? 'pending' : 'synced',
        failed?.error ?? null,
        this.localState(id),
        id,
      ],
    );
    this.index(id, local);
  }

  /** État local : cible de la dernière transition en attente non refusée, sinon état serveur. */
  private localState(id: string): string | null {
    const target = this.db.get<{ target_state: string }>(
      `SELECT target_state FROM mutations WHERE submission_id = ? AND type = 'transition' AND status <> 'failed' ORDER BY seq DESC LIMIT 1`,
      [id],
    );
    if (target) return target.target_state;
    const row = this.db.get<{
      server_state: string | null;
      state: string | null;
      server_data: string | null;
    }>('SELECT server_state, state, server_data FROM submissions WHERE id = ?', [id]);
    // Jamais synchronisée : l'état initial posé à la création locale fait foi.
    return row?.server_data === null ? (row?.state ?? null) : (row?.server_state ?? null);
  }

  private refreshStatus(id: string): void {
    const current = this.submission(id);
    if (current && current.status !== 'draft') this.rebase(id, current.serverData ?? current.data);
  }

  private deleteLocal(id: string): void {
    this.db.run('DELETE FROM submissions WHERE id = ?', [id]);
    this.db.run('DELETE FROM submissions_fts WHERE id = ?', [id]);
    this.db.run('DELETE FROM submission_history WHERE submission_id = ?', [id]);
  }

  /** Index plein texte : valeurs textuelles et libellés des éléments de référentiel. */
  private index(id: string, data: SubmissionData): void {
    const strings: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value === 'string') strings.push(value);
      else if (typeof value === 'number') strings.push(String(value));
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    };
    collect(data);
    // Valeurs de référentiel : indexées par leur libellé ; identifiants techniques ignorés.
    const labels = this.itemLabels([...new Set(strings.filter((s) => s.length <= 64))]);
    const content = strings
      .map((s) => labels.get(s) ?? s)
      .filter((s) => !/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(s));
    this.db.run('DELETE FROM submissions_fts WHERE id = ?', [id]);
    this.db.run('INSERT INTO submissions_fts (id, content) VALUES (?, ?)', [id, content.join(' ')]);
  }
}

interface ItemRow {
  id: string;
  list_id: string;
  parent_id: string | null;
  level: number;
  code: string | null;
  label: string;
  attributes: string;
}

function toItem(row: ItemRow): LocalListItem {
  return {
    id: row.id,
    listId: row.list_id,
    parentId: row.parent_id,
    level: row.level,
    code: row.code,
    label: row.label,
    attributes: JSON.parse(row.attributes) as Record<string, unknown>,
  };
}

/** Statut affiché : une fiche saisie depuis la tâche (encore présente localement) la clôt. */
const TASK_STATUS_SQL = `CASE WHEN t.local_submission_id IS NOT NULL AND t.status IN ('todo', 'in_progress')
  AND EXISTS (SELECT 1 FROM submissions s WHERE s.id = t.local_submission_id) THEN 'done' ELSE t.status END`;

interface TaskRow {
  id: string;
  structure_id: string;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string;
  due_at: string | null;
  location_label: string | null;
  location: string;
  prefill: string;
  local_status: TaskStatus;
  submission_id: string | null;
  local_submission_id: string | null;
}

function toTask(row: TaskRow): LocalTask {
  return {
    id: row.id,
    structureId: row.structure_id,
    title: row.title,
    description: row.description,
    startAt: row.start_at,
    endAt: row.end_at,
    dueAt: row.due_at,
    locationLabel: row.location_label,
    location: parse<{ lat: number; lng: number }>(row.location),
    prefill: JSON.parse(row.prefill) as SubmissionData,
    status: row.local_status,
    submissionId: row.submission_id ?? row.local_submission_id,
  };
}
