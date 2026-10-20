import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { type ReportTemplate } from '@wasafili/sdk';
import {
  AlertTriangle,
  Code,
  Copy,
  Download,
  Eye,
  FileUp,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Badge,
  Card,
  EmptyState,
  ErrorMessage,
  Loading,
  PageHeader,
} from '@/components/ui/display';
import { FormRow, Input } from '@/components/ui/form-controls';
import { Dialog } from '@/components/ui/overlays';
import { useToast } from '@/components/ui/toast';
import { useApp } from '@/lib/use-app';
import { formatDateTime, pendingTab } from '@/lib/utils';
import { HtmlTemplateDialog, STARTER_HTML } from './html-template-dialog';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Dépôt d'un DOCX par le flux des fichiers (URL signée), type forcé si le navigateur l'ignore. */
function asDocx(file: File): File {
  return file.type ? file : new File([file], file.name, { type: DOCX });
}

function TagHelp({ structureId }: { structureId: string }) {
  const { api, short } = useApp();
  const toast = useToast();
  const tags = useQuery({
    queryKey: [short, 'report-tags', structureId],
    queryFn: () => api.reports.tags(structureId),
  });
  const copy = (tag: string) =>
    navigator.clipboard.writeText(tag).then(() => toast.success(`${tag} copié`));
  if (!tags.data) return null;
  const row = (tag: string, label: string, indent = false) => (
    <li key={tag + label} className={indent ? 'pl-4' : undefined}>
      <button
        type="button"
        onClick={() => void copy(tag)}
        className="group flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-subtle"
        title="Copier la balise"
      >
        <code className="text-xs text-primary">{tag}</code>
        <span className="truncate text-xs text-muted">{label}</span>
        <Copy className="ml-auto size-3 opacity-0 group-hover:opacity-100" />
      </button>
    </li>
  );
  return (
    <Card className="space-y-3 p-4 text-sm">
      <div>
        <p className="font-medium">Balises disponibles</p>
        <p className="text-xs text-muted">
          Rédigez le modèle dans Word, LibreOffice ou en HTML. Valeur : <code>{'{{champ}}'}</code>.
          Tableau répété : <code>{'{{#tableau}}…{{/tableau}}'}</code> (dans une ligne de tableau
          Word, ou autour d’un <code>{'<tr>'}</code>). Image (photo, signature) :{' '}
          <code>{'{{@champ}}'}</code>, seule dans son paragraphe en Word, largeur en cm possible :{' '}
          <code>{'{{@photos:8}}'}</code>.
        </p>
      </div>
      <ul className="max-h-80 space-y-0.5 overflow-y-auto">
        {tags.data.fields.map((f) => row(f.tag, f.label, !!f.table))}
      </ul>
      <div>
        <p className="mb-1 text-xs font-medium text-muted">Fiche</p>
        <ul className="space-y-0.5">{tags.data.builtins.map((b) => row(b.tag, b.label))}</ul>
      </div>
    </Card>
  );
}

function TemplateCard({ template }: { template: ReportTemplate }) {
  const { api, short, timeZone } = useApp();
  const toast = useToast();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: [short, 'reports'] });
  const edit = useMutation({
    mutationFn: (values: { name: string; filename: string; html: string }) =>
      api.reports.update(template.id, {
        name: values.name,
        filename: values.filename || null,
        html: values.html,
      }),
    onSuccess: async () => {
      toast.success('Modèle enregistré');
      setEditing(false);
      await invalidate();
    },
    onError: toast.error,
  });

  const preview = useMutation({
    mutationFn: (_tab: ReturnType<typeof pendingTab>) => api.reports.render(template.id),
    onSuccess: ({ url }, tab) => tab.go(url),
    onError: (error, tab) => {
      tab.close();
      toast.error(error);
    },
  });
  const download = useMutation({
    mutationFn: (_tab: ReturnType<typeof pendingTab>) => api.reports.template(template.id),
    onSuccess: ({ url }, tab) => tab.go(url),
    onError: (error, tab) => {
      tab.close();
      toast.error(error);
    },
  });
  const replace = useMutation({
    mutationFn: async (file: File) => {
      const uploaded = await api.files.upload(asDocx(file));
      return api.reports.update(template.id, { fileId: uploaded.id });
    },
    onSuccess: async () => {
      toast.success('Modèle remplacé');
      await invalidate();
    },
    onError: toast.error,
  });
  const remove = useMutation({
    mutationFn: () => api.reports.remove(template.id),
    onSuccess: async () => {
      toast.success('Modèle supprimé');
      await invalidate();
    },
    onError: toast.error,
  });

  const counts = {
    value: template.tags.filter((t) => t.kind === 'value').length,
    loop: template.tags.filter((t) => t.kind === 'loop').length,
    image: template.tags.filter((t) => t.kind === 'image').length,
  };
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{template.name}</p>
          <p className="text-xs text-muted">
            {template.format === 'html' ? 'Modèle HTML' : template.fileName} · modifié le{' '}
            {formatDateTime(template.updatedAt, timeZone)}
            {template.filename && <> · PDF : « {template.filename} »</>}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={preview.isPending}
          onClick={() => preview.mutate(pendingTab())}
        >
          <Eye /> {preview.isPending ? 'Génération…' : 'Aperçu PDF'}
        </Button>
        {template.format === 'html' ? (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil /> Modifier
          </Button>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={() => download.mutate(pendingTab())}>
              <Download /> DOCX
            </Button>
            <Button variant="ghost" size="sm" onClick={() => input.current?.click()}>
              <FileUp /> Remplacer
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="text-danger"
          aria-label={`Supprimer ${template.name}`}
          onClick={() => confirm(`Supprimer le modèle « ${template.name} » ?`) && remove.mutate()}
        >
          <Trash2 />
        </Button>
        <input
          ref={input}
          type="file"
          accept=".docx"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) replace.mutate(file);
            e.target.value = '';
          }}
        />
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge>{counts.value} valeur(s)</Badge>
        <Badge>{counts.loop} tableau(x)</Badge>
        <Badge>{counts.image} image(s)</Badge>
        {template.issues.length === 0 ? (
          <Badge color="#2E8B57">Balises conformes au formulaire</Badge>
        ) : (
          <Badge color="#D98A1B">{template.issues.length} balise(s) à vérifier</Badge>
        )}
      </div>
      {template.format === 'html' && editing && (
        <HtmlTemplateDialog
          open
          onOpenChange={setEditing}
          title={`Modifier « ${template.name} »`}
          initial={{
            name: template.name,
            filename: template.filename ?? '',
            html: template.html ?? '',
          }}
          pending={edit.isPending}
          onSubmit={(values) => edit.mutate(values)}
        />
      )}
      {template.issues.length > 0 && (
        <ul className="space-y-1 rounded-md bg-warning/10 p-3 text-sm">
          {template.issues.map((issue) => (
            <li key={issue.tag + issue.message} className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
              <span>
                <code>{issue.tag}</code> — {issue.message}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Modèles de rapports d'un formulaire (P5.1) : DOCX ou HTML à balises, aperçu PDF. */
export function ReportsPage() {
  const { structureId } = useParams({ strict: false }) as { structureId: string };
  const { api, short, can } = useApp();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [creatingHtml, setCreatingHtml] = useState(false);
  const structure = useQuery({
    queryKey: [short, 'structure', structureId],
    queryFn: () => api.structures.get(structureId),
  });
  const reports = useQuery({
    queryKey: [short, 'reports', structureId],
    queryFn: () => api.reports.list(structureId),
  });
  const create = useMutation({
    mutationFn: async ({
      name,
      filename,
      file,
    }: {
      name: string;
      filename: string;
      file: File;
    }) => {
      const uploaded = await api.files.upload(asDocx(file));
      return api.reports.create(structureId, {
        name,
        fileId: uploaded.id,
        ...(filename ? { filename } : {}),
      });
    },
    onSuccess: async () => {
      toast.success('Modèle enregistré');
      setCreating(false);
      await queryClient.invalidateQueries({ queryKey: [short, 'reports'] });
    },
    onError: toast.error,
  });
  const createHtml = useMutation({
    mutationFn: (values: { name: string; filename: string; html: string }) =>
      api.reports.create(structureId, {
        name: values.name,
        html: values.html,
        ...(values.filename ? { filename: values.filename } : {}),
      }),
    onSuccess: async () => {
      toast.success('Modèle enregistré');
      setCreatingHtml(false);
      await queryClient.invalidateQueries({ queryKey: [short, 'reports'] });
    },
    onError: toast.error,
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) return;
    create.mutate({
      name: String(form.get('name')).trim(),
      filename: String(form.get('filename') ?? '').trim(),
      file,
    });
  };

  const manage = can('report:manage');
  return (
    <>
      <PageHeader
        title="Rapports"
        description={
          structure.data ? `Modèles PDF du formulaire « ${structure.data.name} »` : undefined
        }
        actions={
          manage && (
            <>
              <Button variant="outline" onClick={() => setCreatingHtml(true)}>
                <Code /> Modèle HTML
              </Button>
              <Button onClick={() => setCreating(true)}>
                <Plus /> Nouveau modèle Word
              </Button>
            </>
          )
        }
      />
      {reports.error && <ErrorMessage error={reports.error} />}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          {reports.isPending && <Loading />}
          {reports.data?.data.length === 0 && (
            <EmptyState title="Aucun modèle de rapport">
              Déposez un document Word (.docx) ou écrivez un modèle HTML contenant des balises{' '}
              <code>{'{{champ}}'}</code>.
            </EmptyState>
          )}
          {reports.data?.data.map((template) => (
            <TemplateCard key={template.id} template={template} />
          ))}
        </div>
        {manage && <TagHelp structureId={structureId} />}
      </div>
      {creatingHtml && (
        <HtmlTemplateDialog
          open
          onOpenChange={setCreatingHtml}
          title="Nouveau modèle HTML"
          initial={{ name: 'Rapport', filename: '', html: STARTER_HTML }}
          pending={createHtml.isPending}
          onSubmit={(values) => createHtml.mutate(values)}
        />
      )}
      <Dialog open={creating} onOpenChange={setCreating} title="Nouveau modèle Word">
        <form onSubmit={submit} className="space-y-4">
          <FormRow label="Nom" htmlFor="report-name" required>
            <Input id="report-name" name="name" required maxLength={200} defaultValue="Rapport" />
          </FormRow>
          <FormRow label="Document Word (.docx)" htmlFor="report-file" required>
            <Input id="report-file" name="file" type="file" accept=".docx" required />
          </FormRow>
          <FormRow
            label="Nom du PDF"
            htmlFor="report-filename"
            help="Balises admises, ex. Inspection {{equipement}}"
          >
            <Input id="report-filename" name="filename" maxLength={200} />
          </FormRow>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCreating(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Analyse…' : 'Enregistrer'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
