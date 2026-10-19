import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { type Dashboard, type Widget } from '@tesserax/sdk';
import { ArrowLeft, ArrowRight, LayoutDashboard, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, ErrorMessage, Loading, PageHeader } from '@/components/ui/display';
import { FormRow, Input } from '@/components/ui/form-controls';
import { Dialog } from '@/components/ui/overlays';
import { useToast } from '@/components/ui/toast';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';
import { newWidget, WidgetDialog } from './widget-dialog';
import { WidgetView } from './widget-view';

const SPAN = ['', 'md:col-span-1', 'md:col-span-2', 'md:col-span-3', 'md:col-span-4'];

/** Tableaux de bord de l'instance (P6.2) : liste et création. */
export function DashboardsPage() {
  const { api, short, can } = useApp();
  const navigate = useNavigate();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const dashboards = useQuery({
    queryKey: [short, 'dashboards'],
    queryFn: () => api.dashboards.list(),
  });
  const create = useMutation({
    mutationFn: () => api.dashboards.create({ name: name.trim(), widgets: [] }),
    onSuccess: (dashboard) =>
      navigate({
        to: '/$app/dashboards/$dashboardId',
        params: { app: short, dashboardId: dashboard.id },
        search: { edit: true },
      }),
    onError: (error) => toast.error(error),
  });

  return (
    <>
      <PageHeader
        title="Tableaux de bord"
        description="Indicateurs calculés sur les fiches que chacun peut consulter."
        actions={
          can('dashboard:manage') && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Nouveau tableau de bord
            </Button>
          )
        }
      />
      {dashboards.error && <ErrorMessage error={dashboards.error} />}
      {dashboards.isPending && <Loading />}
      {dashboards.data?.data.length === 0 && (
        <EmptyState title="Aucun tableau de bord">
          {can('dashboard:manage')
            ? 'Créez un tableau de bord pour suivre vos indicateurs.'
            : 'Aucun tableau de bord n’a encore été partagé.'}
        </EmptyState>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {dashboards.data?.data.map((dashboard) => (
          <Link
            key={dashboard.id}
            to="/$app/dashboards/$dashboardId"
            params={{ app: short, dashboardId: dashboard.id }}
            className="rounded-lg border border-border bg-surface p-4 hover:border-primary"
          >
            <p className="flex items-center gap-2 font-medium">
              <LayoutDashboard className="size-4 text-primary" /> {dashboard.name}
            </p>
            <p className="mt-1 text-sm text-muted">
              {dashboard.description || `${dashboard.widgets.length} widget(s)`}
            </p>
          </Link>
        ))}
      </div>
      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="Nouveau tableau de bord"
        footer={
          <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
            Créer
          </Button>
        }
      >
        <FormRow label="Nom" htmlFor="dashboard-name" required>
          <Input id="dashboard-name" value={name} onChange={(e) => setName(e.target.value)} />
        </FormRow>
      </Dialog>
    </>
  );
}

/**
 * Un tableau de bord (P6.2.2) : grille de 4 colonnes. En édition, ajout, configuration,
 * largeur et ordre des widgets ; l'enregistrement remplace la liste en une fois.
 */
export function DashboardPage() {
  const { dashboardId } = useParams({ strict: false }) as { dashboardId: string };
  const { edit: startEditing } = useSearch({ strict: false }) as { edit?: boolean };
  const { api, short, can } = useApp();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const dashboard = useQuery({
    queryKey: [short, 'dashboards', dashboardId],
    queryFn: () => api.dashboards.get(dashboardId),
  });
  const structures = useQuery({
    queryKey: [short, 'structures', 'list'],
    queryFn: () => api.structures.list({ perPage: 100 }),
  });
  const names = useMemo(
    () => new Map((structures.data?.data ?? []).map((s) => [s.id, s.name])),
    [structures.data],
  );
  const [draft, setDraft] = useState<Dashboard | null>(null);
  const [editing, setEditing] = useState<{ widget: Widget; index: number | null } | null>(null);
  const isEditing = draft !== null;
  const canManage = can('dashboard:manage');
  useEffect(() => {
    if (startEditing && dashboard.data && canManage) setDraft((d) => d ?? dashboard.data);
  }, [startEditing, dashboard.data, canManage]);
  const shown = draft ?? dashboard.data;

  const save = useMutation({
    mutationFn: (value: Dashboard) =>
      api.dashboards.update(value.id, {
        name: value.name,
        description: value.description ?? null,
        widgets: value.widgets,
      }),
    onSuccess: async (saved) => {
      queryClient.setQueryData([short, 'dashboards', dashboardId], saved);
      await queryClient.invalidateQueries({ queryKey: [short, 'dashboards'], exact: true });
      setDraft(null);
      toast.success('Tableau de bord enregistré');
    },
    onError: (error) => toast.error(error),
  });
  const remove = useMutation({
    mutationFn: () => api.dashboards.remove(dashboardId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [short, 'dashboards'], exact: true });
      await navigate({ to: '/$app/dashboards', params: { app: short } });
    },
    onError: (error) => toast.error(error),
  });

  const updateWidgets = (widgets: Widget[]) => setDraft((d) => (d ? { ...d, widgets } : d));
  const move = (index: number, delta: -1 | 1) => {
    const widgets = [...draft!.widgets];
    const [item] = widgets.splice(index, 1);
    widgets.splice(index + delta, 0, item!);
    updateWidgets(widgets);
  };
  // Nouveau widget : même formulaire que les widgets existants, sinon le premier disponible.
  const firstStructure = shown?.widgets[0]?.structureId ?? structures.data?.data[0]?.id;

  if (dashboard.error) return <ErrorMessage error={dashboard.error} />;
  if (!shown) return <Loading />;
  return (
    <>
      <PageHeader
        title={shown.name}
        {...(shown.description ? { description: shown.description } : {})}
        actions={
          can('dashboard:manage') &&
          (isEditing ? (
            <>
              <Button variant="outline" onClick={() => setDraft(null)}>
                Annuler
              </Button>
              <Button
                variant="outline"
                disabled={!firstStructure}
                onClick={() => setEditing({ widget: newWidget(firstStructure!), index: null })}
              >
                <Plus /> Widget
              </Button>
              <Button onClick={() => save.mutate(draft)} disabled={save.isPending}>
                Enregistrer
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  if (window.confirm('Supprimer ce tableau de bord ?')) remove.mutate();
                }}
              >
                <Trash2 /> Supprimer
              </Button>
              <Button onClick={() => setDraft(dashboard.data!)}>
                <Pencil /> Modifier
              </Button>
            </>
          ))
        }
      />
      {isEditing && (
        <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-2">
          <FormRow label="Nom" htmlFor="dashboard-edit-name">
            <Input
              id="dashboard-edit-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </FormRow>
          <FormRow label="Description" htmlFor="dashboard-edit-description">
            <Input
              id="dashboard-edit-description"
              value={draft.description ?? ''}
              onChange={(e) => setDraft({ ...draft, description: e.target.value || null })}
            />
          </FormRow>
        </Card>
      )}
      {shown.widgets.length === 0 && (
        <EmptyState title="Tableau de bord vide">
          {isEditing ? 'Ajoutez un premier widget.' : 'Modifiez-le pour ajouter des widgets.'}
        </EmptyState>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {shown.widgets.map((widget, index) => (
          <Card
            key={widget.id}
            className={cn('flex min-h-40 flex-col p-4', SPAN[widget.width] ?? SPAN[1])}
          >
            <div className="flex-1">
              <WidgetView widget={widget} structureName={names.get(widget.structureId)} />
            </div>
            {isEditing && (
              <div className="mt-3 flex items-center justify-end gap-1 border-t border-border pt-2">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Déplacer « ${widget.title} » avant`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowLeft />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Déplacer « ${widget.title} » après`}
                  disabled={index === shown.widgets.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowRight />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing({ widget, index })}>
                  <Pencil /> Configurer
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Retirer « ${widget.title} »`}
                  onClick={() => updateWidgets(draft!.widgets.filter((_, i) => i !== index))}
                >
                  <Trash2 />
                </Button>
              </div>
            )}
          </Card>
        ))}
      </div>
      {editing && (
        <WidgetDialog
          open
          initial={editing.widget}
          onClose={() => setEditing(null)}
          onSave={(widget) => {
            const widgets = [...draft!.widgets];
            if (editing.index === null) widgets.push(widget);
            else widgets[editing.index] = widget;
            updateWidgets(widgets);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
