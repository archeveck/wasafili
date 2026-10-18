import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { type StructureDefinition, type SubmissionData, walkFields } from '@tesserax/form-schema';
import { ApiError, type Submission } from '@tesserax/sdk';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, ErrorMessage, Loading, PageHeader } from '@/components/ui/display';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlays';
import { useToast } from '@/components/ui/toast';
import { displayValue, listItemIds, useItemLabels, useUserLabels } from '@/form/display';
import { FormRenderer } from '@/form/form-renderer';
import { fieldServices } from '@/form/services';
import { useFormRenderer } from '@/form/use-form';
import { useApp } from '@/lib/use-app';
import { formatDateTime } from '@/lib/utils';

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
  const { api, me } = useApp();
  const toast = useToast();
  const [clientMutationId] = useState(() => crypto.randomUUID());
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
      onDone(saved);
    },
    onError: (error) => {
      // Erreurs du serveur (référentiel, lecture seule…) : message détaillé.
      if (error instanceof ApiError && Array.isArray(error.details)) {
        toast.error(
          new Error(
            `${error.message} : ${(error.details as { field: string; code: string }[]).map((d) => `${d.field} (${d.code})`).join(', ')}`,
          ),
        );
      } else toast.error(error);
    },
  });
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
      <div className="mt-8 flex justify-end gap-2">
        <Button type="submit" disabled={save.isPending}>
          Enregistrer
        </Button>
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
  const ACTIONS = { create: 'Création', update: 'Modification', delete: 'Suppression' };
  return (
    <ol className="space-y-4">
      {revisions.data.data.map((revision) => (
        <li key={revision.id}>
          <Card className="p-4">
            <p className="text-sm">
              <span className="font-medium">{ACTIONS[revision.action]}</span> · révision{' '}
              {revision.revision} · {author(revision.authorId)} ·{' '}
              <span className="text-muted">{formatDateTime(revision.createdAt, timeZone)}</span>
            </p>
            {revision.action !== 'create' && revision.changes.length > 0 && (
              <table className="mt-3 w-full text-sm">
                <tbody>
                  {revision.changes.map((change) => {
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

/** Détail d'une fiche (P2.5.2) : lecture, édition (P2.5.3) et historique champ par champ. */
export function SubmissionPage() {
  const { submissionId } = useParams({ strict: false }) as { submissionId: string };
  const { short, api, timeZone, can } = useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const submission = useQuery({
    queryKey: [short, 'submission', submissionId],
    queryFn: () => api.submissions.get(submissionId),
  });
  const version = useQuery({
    queryKey: [short, 'version', submission.data?.structureId, submission.data?.version],
    queryFn: () => api.structures.version(submission.data!.structureId, submission.data!.version),
    enabled: !!submission.data,
  });
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

  if (submission.error) return <ErrorMessage error={submission.error} />;
  if (!submission.data || !version.data) return <Loading />;
  const data = submission.data;
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
            {!editing && can('submission:update') && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> Modifier
              </Button>
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
      <Tabs defaultValue="fiche">
        <TabsList className="mb-6">
          <TabsTrigger value="fiche">Fiche</TabsTrigger>
          <TabsTrigger value="history">Historique</TabsTrigger>
        </TabsList>
        <TabsContent value="fiche">
          <Card className="p-6">
            {editing ? (
              <SubmissionForm
                definition={version.data.definition}
                submission={data}
                structureId={data.structureId}
                onDone={async (saved) => {
                  queryClient.setQueryData([short, 'submission', submissionId], saved);
                  await queryClient.invalidateQueries({
                    queryKey: [short, 'revisions', submissionId],
                  });
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
