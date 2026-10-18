import { beforeEach, describe, expect, it } from 'vitest';
import { migrate, SCHEMA_VERSION } from './db.js';
import { SyncEngine } from './engine.js';
import { LocalStore } from './store.js';
import { FakeServer, LIST, STRUCTURE } from './testing/fake-server.js';
import { openNodeDatabase } from './testing/node-sqlite.js';

let n = 0;
const newId = () => `id-${++n}`;
let server: FakeServer;
let store: LocalStore;
let engine: SyncEngine;

/** Nouvelle fiche saisie et envoyée (brouillon puis « Envoyer »). */
const createSubmission = (data: Record<string, unknown> = { titre: 'Visite' }) => {
  const id = store.saveDraft({ structureId: STRUCTURE, data });
  store.submit(id);
  return id;
};

beforeEach(async () => {
  n = 0;
  server = new FakeServer();
  store = new LocalStore(openNodeDatabase(), {
    newId,
    now: () => new Date('2026-10-18T09:00:00Z'),
  });
  engine = new SyncEngine(store, server);
  await engine.sync(); // téléchargement initial des formulaires et référentiels
});

describe('base locale', () => {
  it('applique les migrations une seule fois', () => {
    const db = openNodeDatabase();
    migrate(db);
    migrate(db);
    expect(db.get<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(
      SCHEMA_VERSION,
    );
  });

  it('dispose hors ligne des formulaires et des référentiels en cascade', () => {
    expect(store.structures().map((s) => s.name)).toEqual(['Inspection']);
    expect(store.currentVersion(STRUCTURE)?.definition).toEqual({ schemaVersion: 1, fields: [] });
    expect(store.listItems(LIST, { parentId: null }).map((i) => i.label)).toEqual(['Plateau']);
    expect(store.listItems(LIST, { parentId: 'site-1' }).map((i) => i.code)).toEqual(['EQ-1']);
    expect(store.lookupCode('EQ-1')[0]?.label).toBe('Groupe électrogène');
    expect(store.listItems(LIST, { q: 'groupe' })).toHaveLength(1);
  });

  it('garde les brouillons en local et les retrouve par recherche plein texte', () => {
    const id = store.saveDraft({
      structureId: STRUCTURE,
      data: { site: 'site-1', note: 'Fuite d’huile électrique' },
    });
    store.saveDraft({
      id,
      structureId: STRUCTURE,
      data: { site: 'site-1', note: 'Fuite d’huile électrique', ok: true },
    });
    expect(store.stats()).toMatchObject({ drafts: 1, pending: 0 });
    expect(store.submissions({ q: 'electri' }).map((s) => s.id)).toEqual([id]); // sans accent, préfixe
    expect(store.submissions({ q: 'plateau' }).map((s) => s.id)).toEqual([id]); // libellé du référentiel
    expect(store.submissions({ q: 'inexistant' })).toEqual([]);
  });

  it('supprime un brouillon ou une création jamais envoyée sans appel serveur', async () => {
    const draft = store.saveDraft({ structureId: STRUCTURE, data: {} });
    const unsent = createSubmission();
    store.remove(draft);
    store.remove(unsent);
    expect(store.submissions()).toEqual([]);
    expect(store.stats().pending).toBe(0);
    await engine.sync();
    expect(server.pushCalls).toBe(0);
  });
});

describe('mode avion', () => {
  it('10 fiches avec photos saisies hors ligne : tout arrive au retour du réseau, sans doublon', async () => {
    server.online = false;
    for (let i = 0; i < 10; i++) {
      const photo = `photo-${i}`;
      const id = createSubmission({ titre: `Fiche ${i}`, photos: [{ fileId: photo }] });
      store.addUpload({
        fileId: photo,
        submissionId: id,
        uri: `file:///photos/${i}.jpg`,
        name: `${i}.jpg`,
        mimeType: 'image/jpeg',
        size: 1000,
      });
    }
    const offline = await engine.sync();
    expect(offline).toMatchObject({ error: 'Réseau indisponible', transient: true, pushed: 0 });
    expect(engine.retryDelay).toBe(5_000);
    expect(store.stats()).toMatchObject({ pending: 10, uploadsPending: 10 });

    server.online = true;
    const report = await engine.sync();
    expect(report).toMatchObject({ pushed: 10, uploaded: 10, rejected: 0 });
    expect(report.error).toBeUndefined();
    expect(engine.retryDelay).toBe(0);
    expect(server.submissions.size).toBe(10);
    expect(server.files.size).toBe(10);
    expect(store.stats()).toMatchObject({ pending: 0, uploadsPending: 0, failed: 0 });
    expect(
      store.submissions().every((s) => s.status === 'synced' && s.data['calcule'] === 'serveur'),
    ).toBe(true);
  });

  it('réponse perdue après application : le renvoi ne crée pas de doublon', async () => {
    const id = createSubmission();
    server.loseNextPushResponse = true;
    expect((await engine.sync()).transient).toBe(true);
    expect(server.submissions.size).toBe(1);
    expect(store.submission(id)?.status).toBe('pending');
    const report = await engine.sync();
    expect(report.pushed).toBe(1);
    expect(server.submissions.size).toBe(1);
    expect(store.submission(id)?.status).toBe('synced');
  });

  it('arrêt brutal pendant un envoi : la mutation repart au démarrage suivant', async () => {
    createSubmission();
    const batch = store.pendingMutations();
    store.markSending(batch.map((m) => m.id)); // l'application s'arrête ici
    const restarted = new SyncEngine(store, server);
    expect((await restarted.sync()).pushed).toBe(1);
    expect(server.submissions.size).toBe(1);
  });

  it('coupure en plein upload : le fichier est renvoyé ensuite', async () => {
    store.addUpload({
      fileId: 'f1',
      uri: 'file:///a.jpg',
      name: 'a.jpg',
      mimeType: 'image/jpeg',
      size: 10,
    });
    server.failUploads = 1;
    expect((await engine.sync()).uploaded).toBe(0);
    expect(store.stats().uploadsPending).toBe(1);
    expect((await engine.sync()).uploaded).toBe(1);
    expect(server.files.has('f1')).toBe(true);
    expect(store.localFileUri('f1')).toBe('file:///a.jpg');
  });

  it('une erreur d upload définitive n arrête pas la file', async () => {
    const permanent = new SyncEngine(store, server, {
      isPermanentUploadError: (e) => (e as Error).message.includes('coupure'),
    });
    store.addUpload({ fileId: 'f1', uri: 'file:///a', name: 'a', mimeType: 'image/jpeg', size: 1 });
    store.addUpload({ fileId: 'f2', uri: 'file:///b', name: 'b', mimeType: 'image/jpeg', size: 1 });
    server.upload = async (task) => {
      if (task.fileId === 'f1') throw new Error('Fichier refusé : coupure');
      server.files.add(task.fileId);
    };
    const report = await permanent.sync();
    expect(report).toMatchObject({ uploaded: 1, uploadFailures: 1 });
    expect(store.stats()).toMatchObject({ uploadsPending: 0, uploadsFailed: 1 });
  });

  it('une seule synchronisation à la fois', async () => {
    createSubmission();
    const [a, b] = [engine.sync(), engine.sync()];
    expect(a).toBe(b);
    await a;
    expect(server.pushCalls).toBe(1);
  });

  it('le délai de nouvel essai croît puis plafonne', async () => {
    server.online = false;
    for (let i = 0; i < 10; i++) await engine.sync();
    expect(engine.retryDelay).toBe(5 * 60_000);
  });
});

describe('modifications et fusion', () => {
  it('n envoie que les champs modifiés, regroupés tant qu ils ne sont pas partis', async () => {
    const id = createSubmission({ titre: 'A', note: 'x' });
    await engine.sync();
    store.edit(id, { ...store.submission(id)!.data, titre: 'B' });
    store.edit(id, { ...store.submission(id)!.data, note: 'y' });
    const queued = store.pendingMutations();
    expect(queued).toHaveLength(1);
    expect(queued[0]!.payload).toMatchObject({
      type: 'update',
      baseRevision: 1,
      data: { titre: 'B', note: 'y' },
    });
    store.edit(id, store.submission(id)!.data);
    expect(store.pendingMutations()).toHaveLength(1);
  });

  it('ne modifie jamais une mutation déjà tentée', async () => {
    const id = createSubmission({ titre: 'A' });
    server.online = false;
    await engine.sync(); // tentative : la création a pu atteindre le serveur
    store.edit(id, { ...store.submission(id)!.data, titre: 'B' });
    expect(store.pendingMutations().map((m) => m.type)).toEqual(['create', 'update']);
  });

  it('rebase les modifications locales en attente sur les changements du serveur', async () => {
    const id = createSubmission({ titre: 'A', note: 'x' });
    await engine.sync();
    server.editRemotely(id, { note: 'du bureau' });
    server.online = false;
    store.edit(id, { ...store.submission(id)!.data, titre: 'terrain' });
    server.online = true;
    // Pull d'abord (sans push) : la modification locale doit survivre.
    store.applyPull(await server.pull(store.cursor));
    expect(store.submission(id)?.data).toMatchObject({ titre: 'terrain', note: 'du bureau' });
    expect(store.submission(id)?.status).toBe('pending');
    await engine.sync();
    expect(server.submissions.get(id)?.data).toMatchObject({ titre: 'terrain', note: 'du bureau' });
    expect(store.submission(id)?.status).toBe('synced');
  });

  it('supprime localement une fiche supprimée sur le serveur', async () => {
    const id = createSubmission();
    await engine.sync();
    server.deleteRemotely(id);
    await engine.sync();
    expect(store.submission(id)).toBeUndefined();
  });

  it('envoie la suppression d une fiche synchronisée', async () => {
    const id = createSubmission();
    await engine.sync();
    store.remove(id);
    expect(store.submission(id)).toBeUndefined();
    await engine.sync();
    expect(server.submissions.get(id)?.deleted).toBe(true);
    expect(store.submission(id)).toBeUndefined();
  });
});

describe('refus du serveur', () => {
  it('signale la fiche en erreur sans bloquer les autres, puis permet de réessayer ou d abandonner', async () => {
    const bad = createSubmission({ invalide: true });
    const good = createSubmission({ titre: 'ok' });
    const report = await engine.sync();
    expect(report).toMatchObject({ pushed: 1, rejected: 1 });
    expect(store.submission(bad)).toMatchObject({
      status: 'error',
      error: 'Données de fiche invalides',
    });
    expect(store.submission(good)?.status).toBe('synced');
    expect(store.failedMutations()).toHaveLength(1);

    store.retryFailed();
    expect(store.stats()).toMatchObject({ pending: 1, failed: 0 });
    await engine.sync();
    expect(store.failedMutations()).toHaveLength(1);

    store.discardMutation(store.failedMutations()[0]!.id);
    expect(store.submission(bad)).toBeUndefined();
    expect(store.stats().failed).toBe(0);
  });

  it('abandonner une modification refusée rétablit la version du serveur', async () => {
    const id = createSubmission({ titre: 'A' });
    await engine.sync();
    store.edit(id, { ...store.submission(id)!.data, titre: 'B', invalide: true });
    server.push = async (mutations) =>
      mutations.map((m) => ({
        id: m.id,
        status: 'rejected',
        error: {
          status: 422,
          code: 'invalid_data',
          message: 'Refusé',
          details: [{ field: 'titre' }],
        },
      }));
    await engine.sync();
    expect(store.submission(id)).toMatchObject({ status: 'error', error: 'Refusé' });
    expect(store.failedMutations()[0]?.error).toContain('titre');
    store.discardMutation(store.failedMutations()[0]!.id);
    expect(store.submission(id)).toMatchObject({ status: 'synced', data: { titre: 'A' } });
  });
});

describe('session', () => {
  it('efface tout au changement d utilisateur', () => {
    createSubmission();
    store.reset();
    expect(store.structures()).toEqual([]);
    expect(store.stats()).toMatchObject({ pending: 0, drafts: 0 });
    expect(store.cursor).toBeUndefined();
  });
});

describe('workflow hors ligne', () => {
  beforeEach(() => {
    server.initialState = 'brouillon';
  });

  it('envoie la création puis la transition choisie, état affiché aussitôt', async () => {
    const id = store.saveDraft({ structureId: STRUCTURE, data: { titre: 'Pompe' } });
    server.online = false;
    store.submit(id, undefined, { key: 'soumettre', to: 'soumis' });
    await engine.sync();
    expect(store.submission(id)).toMatchObject({ status: 'pending', state: 'soumis' });

    server.online = true;
    await engine.sync();
    expect(server.submissions.get(id)).toMatchObject({ state: 'soumis', revision: 2 });
    expect(store.submission(id)).toMatchObject({ status: 'synced', state: 'soumis' });
  });

  it('revient à l’état serveur et explique un refus', async () => {
    const id = createSubmission();
    await engine.sync();
    server.online = false;
    store.transition(id, { key: 'soumettre', to: 'soumis' }, { titre: 'Visite', note: 'RAS' });
    expect(store.submission(id)).toMatchObject({ state: 'soumis', data: { note: 'RAS' } });

    server.online = true;
    server.moveRemotely(id, 'valide'); // validée entre-temps depuis le back-office
    const report = await engine.sync();
    expect(report.rejected).toBe(1);
    expect(store.submission(id)).toMatchObject({
      status: 'error',
      state: 'valide',
      error: 'La fiche est à l’état « valide »',
    });
    store.discardMutation(store.failedMutations()[0]!.id);
    expect(store.submission(id)).toMatchObject({ status: 'synced', state: 'valide' });
  });
});

describe('tâches et notifications', () => {
  const task = {
    id: 'task-1',
    structureId: STRUCTURE,
    title: 'Contrôle groupe',
    description: null,
    assigneeUserId: 'u1',
    assigneeGroupId: null,
    startAt: '2026-11-02T08:00:00.000Z',
    endAt: '2026-11-02T09:00:00.000Z',
    dueAt: null,
    locationLabel: 'Tour Alpha',
    location: null,
    prefill: { equipement: 'eq-1' },
    status: 'todo' as const,
    submissionId: null,
    createdAt: '2026-10-18T08:00:00.000Z',
    updatedAt: '2026-10-18T08:00:00.000Z',
    deleted: false as const,
  };

  it('reçoit les tâches assignées, les clôt par la fiche saisie et retire une tâche réassignée', async () => {
    server.planTask(task);
    server.planTask({
      ...task,
      id: 'task-2',
      startAt: '2026-11-03T08:00:00.000Z',
      endAt: '2026-11-03T09:00:00.000Z',
    });
    await engine.sync();
    expect(store.tasks({ to: '2026-11-03T00:00:00.000Z' }).map((t) => t.id)).toEqual(['task-1']);
    const local = store.task('task-1')!;
    expect(local).toMatchObject({ status: 'todo', prefill: { equipement: 'eq-1' } });

    server.online = false;
    const id = store.saveDraft({ structureId: STRUCTURE, data: local.prefill, taskId: local.id });
    store.saveDraft({ id, structureId: STRUCTURE, data: { ...local.prefill, ok: true } });
    store.submit(id);
    expect(store.task('task-1')).toMatchObject({ status: 'done', submissionId: id });
    expect(store.tasks({ open: true }).map((t) => t.id)).toEqual(['task-2']);

    server.online = true;
    server.planTask({ id: 'task-2', deleted: true });
    await engine.sync();
    expect(server.tasks.get('task-1')).toMatchObject({ status: 'done', submissionId: id });
    expect(store.task('task-1')).toMatchObject({ status: 'done', submissionId: id });
    expect(store.task('task-2')).toBeUndefined();
  });

  it('rouvre la tâche si la fiche saisie est abandonnée', async () => {
    server.planTask(task);
    await engine.sync();
    const id = store.saveDraft({
      structureId: STRUCTURE,
      data: { invalide: true },
      taskId: 'task-1',
    });
    store.submit(id);
    await engine.sync();
    store.discardMutation(store.failedMutations()[0]!.id);
    expect(store.task('task-1')?.status).toBe('todo');
  });

  it('garde les notifications lues localement', async () => {
    const notification = {
      id: 'n-1',
      type: 'task_assigned' as const,
      title: 'Nouvelle tâche',
      body: 'Contrôle groupe',
      data: { taskId: 'task-1' },
      readAt: null,
      createdAt: '2026-10-18T08:00:00.000Z',
    };
    server.notify(notification);
    server.notify({ ...notification, id: 'n-2', createdAt: '2026-10-18T09:00:00.000Z' });
    await engine.sync();
    expect(store.notifications().map((n) => n.id)).toEqual(['n-2', 'n-1']);
    expect(store.unreadNotifications()).toBe(2);
    store.markNotificationsRead('n-1');
    expect(store.unreadNotifications()).toBe(1);
    server.notify({ ...notification, title: 'Relance' }); // renvoyée par le serveur, non lue
    await engine.sync();
    expect(store.notifications().find((n) => n.id === 'n-1')).toMatchObject({ read: true });
    store.markNotificationsRead();
    expect(store.unreadNotifications()).toBe(0);
  });
});
