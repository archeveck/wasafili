import { type StructureDefinition, type SubmissionData } from '@tesserax/form-schema';

/** Contrat du protocole `/v1/{app}/sync` (ADR 0007), côté client. */

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
}

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
}

export type MutationPayload =
  | {
      id: string;
      type: 'create';
      submissionId: string;
      structureId: string;
      data: SubmissionData;
      location?: { lat: number; lng: number; accuracy?: number };
    }
  | {
      id: string;
      type: 'update';
      submissionId: string;
      baseRevision?: number;
      data: SubmissionData;
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
