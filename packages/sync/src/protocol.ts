import { type StructureDefinition, type SubmissionData } from '@wasafili/form-schema';

/** Contrat du protocole `/v1/{app}/sync` (ADR 0007), côté client. */

/** Révision d'une fiche (historique consultable hors ligne) ; `$state` : changement d'état. */
export interface RevisionDto {
  revision: number;
  action: 'create' | 'update' | 'transition' | 'delete';
  /** Nom de l'auteur ; `null` : intégration (clé API) ou compte supprimé. */
  author: string | null;
  authorId: string | null;
  /** Automatisation à l'origine de l'écriture. */
  automation: string | null;
  changes: { field: string; before: unknown; after: unknown }[];
  createdAt: string;
}

export interface PulledSubmission {
  id: string;
  structureId: string;
  deleted: boolean;
  structureVersionId?: string;
  revision?: number;
  state?: string | null;
  authorId?: string | null;
  data?: SubmissionData;
  location?: { lat: number; lng: number; accuracy: number | null } | null;
  createdAt?: string;
  updatedAt?: string;
  /** Révisions les plus récentes (au plus `HISTORY_LIMIT`), de la plus récente à la plus ancienne. */
  history?: RevisionDto[];
  /** Nombre total de révisions sur le serveur. */
  historyTotal?: number;
}

export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';

/** Tâche planifiée (P4.4) ; dates ISO 8601 (UTC). */
export interface TaskDto {
  id: string;
  structureId: string;
  title: string;
  description: string | null;
  assigneeUserId: string | null;
  assigneeGroupId: string | null;
  startAt: string;
  endAt: string;
  dueAt: string | null;
  locationLabel: string | null;
  location: { lat: number; lng: number } | null;
  prefill: SubmissionData;
  status: TaskStatus;
  submissionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationDto {
  id: string;
  type: 'task_assigned' | 'submission_state';
  title: string;
  body: string | null;
  data: { taskId?: string; submissionId?: string; structureId?: string };
  readAt: string | null;
  createdAt: string;
}

/** Tâche reçue ; `deleted` : supprimée ou plus assignée à l'utilisateur. */
export type PulledTask = (TaskDto & { deleted: false }) | { id: string; deleted: true };

export interface PullResponse {
  cursor: string;
  hasMore: boolean;
  settings: Record<string, unknown>;
  structures: {
    id: string;
    name: string;
    description: string | null;
    currentVersionId: string | null;
    rights: string[];
  }[];
  versions: { id: string; structureId: string; version: number; definition: StructureDefinition }[];
  lists: { id: string; name: string; levels: string[] }[];
  listItems: {
    id: string;
    listId: string;
    parentId: string | null;
    level: number;
    code: string | null;
    label: string;
    attributes: Record<string, unknown>;
    position: number;
    archived: boolean;
  }[];
  submissions: PulledSubmission[];
  tasks: PulledTask[];
  notifications: NotificationDto[];
}

export type MutationPayload =
  | {
      id: string;
      type: 'create';
      submissionId: string;
      structureId: string;
      data: SubmissionData;
      location?: { lat: number; lng: number; accuracy?: number };
      /** Tâche dont la fiche est issue (close par la création). */
      taskId?: string;
    }
  | {
      id: string;
      type: 'update';
      submissionId: string;
      baseRevision?: number;
      data: SubmissionData;
    }
  | {
      id: string;
      type: 'transition';
      submissionId: string;
      transition: string;
      baseRevision?: number;
      /** Modifications enregistrées avec la transition. */
      data?: SubmissionData;
    }
  | { id: string; type: 'delete'; submissionId: string };

export type MutationResult =
  | {
      id: string;
      status: 'applied' | 'duplicate';
      submission?: PulledSubmission;
      conflicts?: string[];
    }
  | {
      id: string;
      status: 'rejected';
      error: { status: number; code: string; message: string; details?: unknown };
    };

export interface UploadTask {
  fileId: string;
  uri: string;
  name: string;
  mimeType: string;
  size: number;
}

/** Transport réseau, fourni par la plateforme (SDK + système de fichiers). */
export interface SyncTransport {
  pull(cursor: string | undefined): Promise<PullResponse>;
  push(mutations: MutationPayload[]): Promise<MutationResult[]>;
  upload(task: UploadTask): Promise<void>;
}

/** Erreur réseau ou serveur : l'opération sera retentée plus tard. */
export class TransientError extends Error {
  override readonly name = 'TransientError';
}
