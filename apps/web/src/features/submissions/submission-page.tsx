import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import {
  initialState,
  type StructureDefinition,
  type SubmissionData,
  walkFields,
  type WorkflowTransition,
} from '@tesserax/form-schema';
import { ApiError, type Submission } from '@tesserax/sdk';
import { ArrowLeft, FileText, Pencil, Trash2, Workflow } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, ErrorMessage, Loading, PageHeader } from '@/components/ui/display';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/overlays';
import { useToast } from '@/components/ui/toast';
import { displayValue, listItemIds, useItemLabels, useUserLabels } from '@/form/display';
import { FormRenderer } from '@/form/form-renderer';
import { fieldServices } from '@/form/services';
import { useFormRenderer } from '@/form/use-form';
import { useApp } from '@/lib/use-app';
import { formatDateTime, pendingTab } from '@/lib/utils';
import { StateBadge, stateLabel, transitionProblem, TransitionButtons } from './workflow';

/** Rapports PDF de la fiche (P5.1) : générés à la demande, mis en cache par révision. */
function ReportButton({ submission }: { submission: Submission }) {
  const { api, short } = useApp();
  const toast = useToast();
  const reports = useQuery({
    queryKey: [short, 'reports', submission.structureId],
    queryFn: () => api.reports.list(submission.structureId),
  });
  const render = useMutation({
    mutationFn: ({ reportId }: { reportId: string; tab: ReturnType<typeof pendingTab> }) =>
      api.reports.render(reportId, submission.id),
    onSuccess: ({ url }, { tab }) => tab.go(url),
    onError: (error, { tab }) => {
      tab.close();
      toast.error(error);
    },
  });
  const templates = reports.data?.data ?? [];
  if (templates.length === 0) return null;
  const label = render.isPending ? 'Génération…' : 'Rapport PDF';
  if (templates.length === 1) {
    return (
      <Button
        variant="outline"
        disabled={render.isPending}
        onClick={() => render.mutate({ reportId: templates[0]!.id, tab: pendingTab() })}
      >
        <FileText /> {label}
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={render.isPending}>
          <FileText /> {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {templates.map((t) => (
          <DropdownMenuItem
            key={t.id}
            onSelect={() => render.mutate({ reportId: t.id, tab: pendingTab() })}
          >
            {t.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Message d'erreur de l'API, avec les champs en cause. */
function apiError(error: unknown): unknown {
  if (error instanceof ApiError && Array.isArray(error.details)) {
    return new Error(
      `${error.message} : ${(error.details as { field: string; code: string }[]).map((d) => `${d.field} (${d.code})`).join(', ')}`,
    );
  }
  return error;
}

/** Valeurs modifiées par rapport à la fiche d'origine (mise à jour partielle, D9). */
function changedValues(before: SubmissionData, after: SubmissionData): SubmissionData {
  return Object.fromEntries(
    Object.entries(after).filter(
      ([key, value]) => JSON.stringify(value ?? null) !== JSON.stringify(before[key] ?? null),
    ),
  );
}

function SubmissionForm({
  definition,
  submission,
  structureId,
  onDone,
}: {
  definition: StructureDefinition;
  submission?: Submission | undefined;
  structureId: string;
  onDone: (submission: Submission) => void;
}) {
  const { api, me, short } = useApp();
  const toast = useToast();
  const queryClient = useQueryClient();
  // Liste, compteurs et calendrier des fiches de la structure à rafraîchir après écriture.
  const refreshList = () =>
    queryClient.invalidateQueries({ queryKey: [short, 'submissions', structureId] });
  const [clientMutationId] = useState(() => crypto.randomUUID());
  const [transitionMutationId] = useState(() => crypto.randomUUID());
  const state = submission ? submission.state : initialState(definition.workflow);
  const form = useFormRenderer(definition, {
    isNew: !submission,
    ...(submission ? { initialValues: submission.data, state: submission.state } : {}),
    ...(me ? { userId: me.id, roles: me.roles } : {}),
  });
  const save = useMutation({
    mutationFn: (values: SubmissionData) =>
      submission
        ? api.submissions.update(submission.id, {
            data: changedValues(submission.data, values),
            clientMutationId,
          })
        : api.submissions.create(structureId, {
            id: crypto.randomUUID(),
            data: values,
            clientMutationId,
          }),
    onSuccess: (saved) => {
      toast.success(submission ? 'Fiche modifiée' : 'Fiche enregistrée');
      void refreshList();
      onDone(saved);
    },
    // Erreurs du serveur (référentiel, lecture seule…) : message détaillé.
    onError: (error) => toast.error(apiError(error)),
  });
  // Bouton de workflow : enregistre les données et change l'état (création puis transition
  // pour une nouvelle fiche, chaque étape rejouable sans doublon).
  const move = useMutation({
    mutationFn: async ({
      transition,
      values,
    }: {
      transition: WorkflowTransition;
      values: SubmissionData;
    }) => {
      if (submission) {
        return api.submissions.transition(submission.id, {
          transition: transition.key,
          data: changedValues(submission.data, values),
          clientMutationId: transitionMutationId,
        });
      }
      const created = await api.submissions.create(structureId, {
        id: crypto.randomUUID(),
        data: values,
        clientMutationId,
      });
      return api.submissions.transition(created.id, {
        transition: transition.key,
        clientMutationId: transitionMutationId,
      });
    },
    onSuccess: (saved, { transition }) => {
      toast.success(
        `${transition.label} : fiche ${stateLabel(definition.workflow, saved.state).toLowerCase()}`,
      );
      void refreshList();
      onDone(saved);
    },
    onError: (error) => toast.error(apiError(error)),
  });
  const runTransition = (transition: WorkflowTransition) => {
    const result = form.submit();
    if (!result.valid) {
      toast.error(new Error(`${result.errors.length} champ(s) à corriger`));
      return;
    }
    const problem = transitionProblem(definition, result.values, transition, {
      state,
      userId: me?.id,
      roles: me?.roles ?? [],
    });
    if (problem) toast.error(new Error(problem));
    else move.mutate({ transition, values: result.values });
  };
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const result = form.submit();
        if (result.valid) save.mutate(result.values);
        else toast.error(new Error(`${result.errors.length} champ(s) à corriger`));
      }}
    >
      <FormRenderer definition={definition} form={form} services={fieldServices(api)} />
      <div className="mt-8 flex flex-wrap justify-end gap-2">
        <Button
          type="submit"
          variant={definition.workflow ? 'outline' : 'default'}
          disabled={save.isPending}
        >
          Enregistrer
        </Button>
        <TransitionButtons
          workflow={definition.workflow}
          state={state}
          roles={me?.roles ?? []}
          disabled={move.isPending}
          onRun={runTransition}
        />
      </div>
    </form>
  );
}

function History({
  submissionId,
  definition,
}: {
  submissionId: string;
  definition: StructureDefinition;
}) {
  const { short, api, timeZone } = useApp();
  const revisions = useQuery({
    queryKey: [short, 'revisions', submissionId],
    queryFn: () => api.submissions.revisions(submissionId, { perPage: 100 }),
  });
  const users = useUserLabels(api, short);
  const fields = new Map([...walkFields(definition.fields)].map(({ field }) => [field.key, field]));
  const changes = (revisions.data?.data ?? []).flatMap((r) => r.changes);
  const labels = useItemLabels(
    api,
    short,
    listItemIds(
      [...fields.values()],
      changes.flatMap((c) => [{ [c.field]: c.before }, { [c.field]: c.after }]),
    ),
  );
  if (revisions.isPending) return <Loading />;
  if (revisions.error) return <ErrorMessage error={revisions.error} />;
  const author = (id: string | null) => (id ? (users.get(id) ?? 'Utilisateur') : 'Intégration');
  const ACTIONS = {
    create: 'Création',
    update: 'Modification',
    transition: 'Changement d’état',
    delete: 'Suppression',
  };
  return (
    <ol className="space-y-4">
      {revisions.data.data.map((revision) => (
        <li key={revision.id}>
          <Card className="p-4">
            <p className="text-sm">
              <span className="font-medium">{ACTIONS[revision.action]}</span> · révision{' '}
              {revision.revision} ·{' '}
              {revision.automation ? (
                <span className="inline-flex items-center gap-1">
                  <Workflow className="size-3" /> Automatisation « {revision.automation.name} »
                </span>
              ) : (
                author(revision.authorId)
              )}{' '}
              · <span className="text-muted">{formatDateTime(revision.createdAt, timeZone)}</span>
            </p>
            {revision.action !== 'create' && revision.changes.length > 0 && (
              <table className="mt-3 w-full text-sm">
                <tbody>
                  {revision.changes.map((change) => {
                    if (change.field === '$state') {
                      return (
                        <tr key={change.field} className="border-t border-border">
                          <td className="py-1.5 pr-3 font-medium">État</td>
                          <td className="py-1.5 pr-3 text-danger line-through">
                            {stateLabel(definition.workflow, change.before as string | null)}
                          </td>
                          <td className="py-1.5 text-success">
                            {stateLabel(definition.workflow, change.after as string | null)}
                          </td>
                        </tr>
                      );
                    }
                    const field = fields.get(change.field);
                    return (
                      <tr key={change.field} className="border-t border-border">
                        <td className="py-1.5 pr-3 font-medium">{field?.label ?? change.field}</td>
                        <td className="py-1.5 pr-3 text-danger line-through">
                          {displayValue(field, change.before, labels, timeZone, users)}
                        </td>
                        <td className="py-1.5 text-success">
                          {displayValue(field, change.after, labels, timeZone, users)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {revision.action === 'create' && (
              <p className="mt-1 text-xs text-muted">
                {revision.changes.length} champ(s) renseigné(s)
              </p>
            )}
          </Card>
        </li>
      ))}
    </ol>
  );
}

/** Conflits de modification (P3.7) : valeur appliquée, valeur écrasée, résolution manuelle. */
function Conflicts({
  submissionId,
  definition,
}: {
  submissionId: string;
  definition: StructureDefinition;
}) {
  const { short, api, timeZone, can } = useApp();
  const queryClient = useQueryClient();
  const toast = useToast();
  const conflicts = useQuery({
    queryKey: [short, 'conflicts', submissionId],
    queryFn: () => api.submissions.conflicts(submissionId),
  });
  const users = useUserLabels(api, short);
  const fields = new Map([...walkFields(definition.fields)].map(({ field }) => [field.key, field]));
  const values = (conflicts.data?.data ?? []).flatMap((c) => [
    { [c.field]: c.appliedValue.value },
    { [c.field]: c.overwrittenValue.value },
  ]);
  const labels = useItemLabels(api, short, listItemIds([...fields.values()], values));
  const resolve = useMutation({
    mutationFn: ({ id, resolution }: { id: string; resolution: 'kept' | 'restored' }) =>
      api.submissions.resolveConflict(submissionId, id, resolution),
    onSuccess: async () => {
      toast.success('Conflit résolu');
      await queryClient.invalidateQueries({ queryKey: [short] });
    },
    onError: toast.error,
  });
  if (conflicts.isPending) return <Loading />;
  if (conflicts.error) return <ErrorMessage error={conflicts.error} />;
  if (conflicts.data.data.length === 0)
    return <p className="text-sm text-muted">Aucun conflit sur cette fiche.</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Deux modifications concurrentes du même champ : la dernière reçue par le serveur a été
        appliquée, l’autre est conservée ici.
      </p>
      {conflicts.data.data.map((conflict) => {
        const field = fields.get(conflict.field);
        return (
          <Card key={conflict.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium">{field?.label ?? conflict.field}</p>
                <p className="text-xs text-muted">
                  Révision {conflict.baseRevision} → {conflict.appliedRevision} ·{' '}
                  {conflict.authorId
                    ? (users.get(conflict.authorId) ?? 'Utilisateur')
                    : 'Intégration'}{' '}
                  · {formatDateTime(conflict.createdAt, timeZone)}
                </p>
              </div>
              {conflict.resolvedAt ? (
                <Badge color="#2E8B57">
                  {conflict.resolution === 'restored'
                    ? 'Valeur écrasée rétablie'
                    : 'Valeur appliquée conservée'}
                </Badge>
              ) : (
                <Badge color="#D98A1B">À traiter</Badge>
              )}
            </div>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div className="rounded-md bg-success/5 p-2">
                <dt className="text-xs text-muted">Appliquée</dt>
                <dd>{displayValue(field, conflict.appliedValue.value, labels, timeZone, users)}</dd>
              </div>
              <div className="rounded-md bg-danger/5 p-2">
                <dt className="text-xs text-muted">Écrasée</dt>
                <dd>
                  {displayValue(field, conflict.overwrittenValue.value, labels, timeZone, users)}
                </dd>
              </div>
            </dl>
            {!conflict.resolvedAt && can('submission:update') && (
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={resolve.isPending}
                  onClick={() => resolve.mutate({ id: conflict.id, resolution: 'kept' })}
                >
                  Conserver la valeur appliquée
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={resolve.isPending}
                  onClick={() => resolve.mutate({ id: conflict.id, resolution: 'restored' })}
                >
                  Rétablir la valeur écrasée
                </Button>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

/** Détail d'une fiche (P2.5.2) : lecture, édition (P2.5.3) et historique champ par champ. */
export function SubmissionPage() {
  const { submissionId } = useParams({ strict: false }) as { submissionId: string };
  const { short, api, timeZone, can, me } = useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [transitionMutationId, setTransitionMutationId] = useState(() => crypto.randomUUID());
  const submission = useQuery({
    queryKey: [short, 'submission', submissionId],
    queryFn: () => api.submissions.get(submissionId),
  });
  const version = useQuery({
    queryKey: [short, 'version', submission.data?.structureId, submission.data?.version],
    queryFn: () => api.structures.version(submission.data!.structureId, submission.data!.version),
    enabled: !!submission.data,
  });
  const conflicts = useQuery({
    queryKey: [short, 'conflicts', submissionId],
    queryFn: () => api.submissions.conflicts(submissionId),
  });
  const openConflicts = (conflicts.data?.data ?? []).filter((c) => !c.resolvedAt).length;
  const remove = useMutation({
    mutationFn: () => api.submissions.remove(submissionId),
    onSuccess: () => {
      toast.success('Fiche supprimée');
      void navigate({
        to: '/$app/structures/$structureId/submissions',
        params: { app: short, structureId: submission.data!.structureId },
      });
    },
    onError: toast.error,
  });

  const saved = async (next: Submission) => {
    queryClient.setQueryData([short, 'submission', submissionId], next);
    await queryClient.invalidateQueries({ queryKey: [short, 'revisions', submissionId] });
    await queryClient.invalidateQueries({ queryKey: [short, 'submissions', next.structureId] });
  };
  const move = useMutation({
    mutationFn: (transition: WorkflowTransition) =>
      api.submissions.transition(submissionId, {
        transition: transition.key,
        clientMutationId: transitionMutationId,
      }),
    onSuccess: async (next, transition) => {
      toast.success(
        `${transition.label} : fiche ${stateLabel(version.data?.definition.workflow, next.state).toLowerCase()}`,
      );
      setTransitionMutationId(crypto.randomUUID());
      await saved(next);
    },
    onError: (error) => toast.error(apiError(error)),
  });

  if (submission.error) return <ErrorMessage error={submission.error} />;
  if (!submission.data || !version.data) return <Loading />;
  const data = submission.data;
  const definition = version.data.definition;
  const back = () =>
    navigate({
      to: '/$app/structures/$structureId/submissions',
      params: { app: short, structureId: data.structureId },
    });

  return (
    <div className="mx-auto max-w-3xl">
      <Button variant="ghost" className="mb-2 -ml-3" onClick={back}>
        <ArrowLeft /> Retour aux fiches
      </Button>
      <PageHeader
        title="Fiche"
        description={`Créée le ${formatDateTime(data.createdAt, timeZone)} · modifiée le ${formatDateTime(data.updatedAt, timeZone)} · version v${data.version} · révision ${data.revision}`}
        actions={
          <>
            {!editing && <ReportButton submission={data} />}
            {!editing && can('submission:update') && (
              <>
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <Pencil /> Modifier
                </Button>
                <TransitionButtons
                  workflow={definition.workflow}
                  state={data.state}
                  roles={me?.roles ?? []}
                  disabled={move.isPending}
                  onRun={(transition) => {
                    const problem = transitionProblem(definition, data.data, transition, {
                      state: data.state,
                      userId: me?.id,
                      roles: me?.roles ?? [],
                    });
                    if (!problem) return move.mutate(transition);
                    // Champs à compléter : la fiche passe en modification.
                    toast.error(new Error(problem));
                    setEditing(true);
                  }}
                />
              </>
            )}
            {can('submission:delete') && (
              <Button
                variant="danger"
                onClick={() => confirm('Supprimer cette fiche ?') && remove.mutate()}
              >
                <Trash2 /> Supprimer
              </Button>
            )}
          </>
        }
      />
      {definition.workflow && (
        <p className="-mt-2 mb-4 flex items-center gap-2 text-sm text-muted">
          État <StateBadge workflow={definition.workflow} state={data.state} />
        </p>
      )}
      <Tabs defaultValue="fiche">
        <TabsList className="mb-6">
          <TabsTrigger value="fiche">Fiche</TabsTrigger>
          <TabsTrigger value="history">Historique</TabsTrigger>
          <TabsTrigger value="conflicts">
            Conflits
            {openConflicts > 0 && (
              <Badge className="ml-1.5" color="#D98A1B">
                {openConflicts}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="fiche">
          <Card className="p-6">
            {editing ? (
              <SubmissionForm
                definition={version.data.definition}
                submission={data}
                structureId={data.structureId}
                onDone={async (next) => {
                  await saved(next);
                  setEditing(false);
                }}
              />
            ) : (
              <ReadOnlySubmission definition={version.data.definition} submission={data} />
            )}
          </Card>
        </TabsContent>
        <TabsContent value="history">
          <History submissionId={submissionId} definition={version.data.definition} />
        </TabsContent>
        <TabsContent value="conflicts">
          <Conflicts submissionId={submissionId} definition={version.data.definition} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ReadOnlySubmission({
  definition,
  submission,
}: {
  definition: StructureDefinition;
  submission: Submission;
}) {
  const { api, me } = useApp();
  // Rendu du formulaire avec tous les champs en lecture seule.
  const readOnly: StructureDefinition = {
    ...definition,
    fields: definition.fields.map(function lock(field): typeof field {
      const locked = { ...field, readOnly: true } as typeof field;
      if (locked.type === 'section' || locked.type === 'table') {
        (locked as { fields: (typeof field)[] }).fields = (locked.fields as (typeof field)[]).map(
          lock,
        );
      }
      return locked;
    }),
  };
  const form = useFormRenderer(readOnly, {
    initialValues: submission.data,
    state: submission.state,
    ...(me ? { userId: me.id, roles: me.roles } : {}),
  });
  return <FormRenderer definition={readOnly} form={form} services={fieldServices(api)} />;
}

/** Saisie d'une nouvelle fiche depuis le back-office. */
export function NewSubmissionPage() {
  const { structureId } = useParams({ strict: false }) as { structureId: string };
  const { short, api } = useApp();
  const navigate = useNavigate();
  const structure = useQuery({
    queryKey: [short, 'structure', structureId],
    queryFn: () => api.structures.get(structureId),
  });
  const version = useQuery({
    queryKey: [short, 'version', structureId, 'current'],
    queryFn: () => api.structures.version(structureId, 'current'),
  });
  if (version.error) return <ErrorMessage error={version.error} />;
  if (!version.data) return <Loading />;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={`Nouvelle fiche — ${structure.data?.name ?? ''}`} />
      <Card className="p-6">
        <SubmissionForm
          definition={version.data.definition}
          structureId={structureId}
          onDone={(saved) =>
            navigate({
              to: '/$app/submissions/$submissionId',
              params: { app: short, submissionId: saved.id },
            })
          }
        />
      </Card>
    </div>
  );
}
