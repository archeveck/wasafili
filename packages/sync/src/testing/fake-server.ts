import { type SubmissionData } from '@tesserax/form-schema';
import {
  type MutationPayload,
  type MutationResult,
  type NotificationDto,
  type PulledTask,
  type PulledSubmission,
  type PullResponse,
  type SyncTransport,
  TransientError,
  type UploadTask,
} from '../protocol.js';

export const STRUCTURE = 'structure-1';
export const VERSION = 'version-1';
export const LIST = 'list-1';

/**
 * Serveur de synchronisation simulé : idempotence par identifiant de mutation, révisions,
 * curseur par numéro d'écriture, tombstones. Pannes réseau et réponses perdues pilotables.
 */
export class FakeServer implements SyncTransport {
  online = true;
  /** La prochaine réponse de push est perdue après application côté serveur. */
  loseNextPushResponse = false;
  /** Échec de l'upload après N octets envoyés (coupure en plein transfert). */
  failUploads = 0;
  readonly submissions = new Map<string, PulledSubmission & { seq: number }>();
  readonly files = new Set<string>();
  readonly applied = new Set<string>();
  readonly tasks = new Map<string, PulledTask & { seq: number }>();
  readonly notifications: (NotificationDto & { seq: number })[] = [];
  /** Workflow simulé : état à la création et transitions (`from` → `to`). */
  initialState: string | null = null;
  workflow: Record<string, { from: string[]; to: string }> = {
    soumettre: { from: ['brouillon'], to: 'soumis' },
    valider: { from: ['soumis'], to: 'valide' },
  };
  pushCalls = 0;
  private seq = 0;

  private offline() {
    if (!this.online) throw new TransientError('Réseau indisponible');
  }

  async pull(cursor: string | undefined): Promise<PullResponse> {
    this.offline();
    const since = cursor ? Number(cursor) : 0;
    const changed = [...this.submissions.values()].filter((s) => s.seq > since);
    return {
      cursor: String(this.seq),
      hasMore: false,
      settings: { name: 'Démo' },
      structures: [
        {
          id: STRUCTURE,
          name: 'Inspection',
          description: null,
          currentVersionId: VERSION,
          rights: ['create', 'read:own', 'update'],
        },
      ],
      versions:
        since === 0
          ? [
              {
                id: VERSION,
                structureId: STRUCTURE,
                version: 1,
                definition: { schemaVersion: 1, fields: [] },
              },
            ]
          : [],
      lists: [{ id: LIST, name: 'Sites', levels: ['Site', 'Équipement'] }],
      listItems:
        since === 0
          ? [
              {
                id: 'site-1',
                listId: LIST,
                parentId: null,
                level: 0,
                code: 'S1',
                label: 'Plateau',
                attributes: {},
                position: 0,
                archived: false,
              },
              {
                id: 'eq-1',
                listId: LIST,
                parentId: 'site-1',
                level: 1,
                code: 'EQ-1',
                label: 'Groupe électrogène',
                attributes: {},
                position: 0,
                archived: false,
              },
            ]
          : [],
      submissions: changed.map(({ seq: _seq, ...s }) => s),
      tasks: [...this.tasks.values()]
        .filter((t) => t.seq > since)
        .map(({ seq: _seq, ...t }) => t as PulledTask),
      notifications: this.notifications
        .filter((n) => n.seq > since)
        .map(({ seq: _seq, ...n }) => n),
    };
  }

  async push(mutations: MutationPayload[]): Promise<MutationResult[]> {
    this.offline();
    this.pushCalls++;
    const results = mutations.map((m) => this.apply(m));
    if (this.loseNextPushResponse) {
      this.loseNextPushResponse = false;
      throw new TransientError('Réponse perdue');
    }
    return results;
  }

  async upload(task: UploadTask): Promise<void> {
    this.offline();
    if (this.failUploads > 0) {
      this.failUploads--;
      throw new TransientError('Coupure pendant l envoi');
    }
    this.files.add(task.fileId);
  }

  /** Tâche planifiée (ou réassignée ailleurs avec `deleted`) depuis le back-office. */
  planTask(task: PulledTask) {
    this.tasks.set(task.id, { ...task, seq: ++this.seq } as PulledTask & { seq: number });
  }

  notify(notification: NotificationDto) {
    this.notifications.push({ ...notification, seq: ++this.seq });
  }

  /** Changement d'état fait par quelqu'un d'autre (back-office). */
  moveRemotely(id: string, state: string) {
    const current = this.submissions.get(id)!;
    this.submissions.set(id, {
      ...current,
      state,
      revision: current.revision! + 1,
      seq: ++this.seq,
    });
  }

  /** Modification faite par quelqu'un d'autre (back-office). */
  editRemotely(id: string, data: SubmissionData) {
    const current = this.submissions.get(id)!;
    this.submissions.set(id, {
      ...current,
      data: { ...current.data, ...data },
      revision: current.revision! + 1,
      seq: ++this.seq,
    });
  }

  deleteRemotely(id: string) {
    const current = this.submissions.get(id)!;
    this.submissions.set(id, {
      id,
      structureId: current.structureId,
      deleted: true,
      seq: ++this.seq,
    });
  }

  private apply(m: MutationPayload): MutationResult {
    const view = (id: string) => {
      const { seq: _seq, ...s } = this.submissions.get(id)!;
      return s;
    };
    if (this.applied.has(m.id))
      return {
        id: m.id,
        status: 'duplicate',
        ...(m.type !== 'delete' ? { submission: view(m.submissionId) } : {}),
      };
    const existing = this.submissions.get(m.submissionId);
    if (m.type === 'create') {
      if (existing)
        return {
          id: m.id,
          status: 'rejected',
          error: { status: 409, code: 'conflict', message: 'Cette fiche existe déjà' },
        };
      if (m.data['invalide'])
        return {
          id: m.id,
          status: 'rejected',
          error: { status: 422, code: 'invalid_data', message: 'Données de fiche invalides' },
        };
      this.submissions.set(m.submissionId, {
        id: m.submissionId,
        structureId: m.structureId,
        structureVersionId: VERSION,
        deleted: false,
        revision: 1,
        state: this.initialState,
        authorId: 'u1',
        data: { ...m.data, calcule: 'serveur' },
        location: null,
        createdAt: '2026-10-18T10:00:00.000Z',
        updatedAt: '2026-10-18T10:00:00.000Z',
        seq: ++this.seq,
      });
      const task = m.taskId ? this.tasks.get(m.taskId) : undefined;
      if (task && !task.deleted && task.status === 'todo') {
        this.tasks.set(task.id, {
          ...task,
          status: 'done',
          submissionId: m.submissionId,
          seq: ++this.seq,
        });
      }
    } else if (!existing || existing.deleted) {
      return {
        id: m.id,
        status: 'rejected',
        error: { status: 404, code: 'not_found', message: 'Fiche introuvable' },
      };
    } else if (m.type === 'transition') {
      const transition = this.workflow[m.transition];
      if (!transition?.from.includes(existing.state ?? '')) {
        return {
          id: m.id,
          status: 'rejected',
          error: {
            status: 409,
            code: 'invalid_state',
            message: `La fiche est à l’état « ${existing.state} »`,
          },
        };
      }
      this.submissions.set(m.submissionId, {
        ...existing,
        data: { ...existing.data, ...m.data },
        state: transition.to,
        revision: existing.revision! + 1,
        seq: ++this.seq,
      });
    } else if (m.type === 'update') {
      this.submissions.set(m.submissionId, {
        ...existing,
        data: { ...existing.data, ...m.data },
        revision: existing.revision! + 1,
        seq: ++this.seq,
      });
    } else {
      this.submissions.set(m.submissionId, {
        id: m.submissionId,
        structureId: existing.structureId,
        deleted: true,
        seq: ++this.seq,
      });
    }
    this.applied.add(m.id);
    return {
      id: m.id,
      status: 'applied',
      ...(m.type !== 'delete' ? { submission: view(m.submissionId) } : {}),
    };
  }
}
