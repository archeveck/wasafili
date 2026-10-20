import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { analyzeDefinition } from '@wasafili/form-engine';
import {
  type Field,
  type FieldType,
  type StructureDefinition,
  walkFields,
} from '@wasafili/form-schema';
import { ApiError } from '@wasafili/sdk';
import {
  AlertTriangle,
  ArrowLeft,
  Eye,
  GitBranch,
  GitCompare,
  LayoutList,
  MousePointerClick,
  Rocket,
  Save,
  SlidersHorizontal,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, ErrorMessage, Loading } from '@/components/ui/display';
import { Dialog, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlays';
import { useToast } from '@/components/ui/toast';
import { useApp } from '@/lib/use-app';
import { Canvas } from './canvas';
import {
  allKeys,
  childrenOf,
  createField,
  diffDefinitions,
  findField,
  insertField,
  moveField,
  removeField,
  ROOT,
  typeLabel,
  uniqueKey,
  updateField,
} from './model';
import { Palette } from './palette';
import { MobilePreview } from './preview';
import { PropertiesPanel } from './properties';
import { WorkflowEditor } from './workflow-editor';

const newId = () => crypto.randomUUID();

// Survol précis des conteneurs imbriqués, avec repli sur l'intersection.
const collision: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : rectIntersection(args);
};

function DiffDialog({
  open,
  onOpenChange,
  before,
  after,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  before?: StructureDefinition | undefined;
  after: StructureDefinition;
}) {
  const diff = diffDefinitions(before, after);
  const empty =
    !diff.added.length && !diff.removed.length && !diff.changed.length && !diff.workflowChanged;
  const list = (title: string, color: string, fields: Field[]) =>
    fields.length > 0 && (
      <div>
        <p className="mb-1 text-sm font-medium" style={{ color }}>
          {title} ({fields.length})
        </p>
        <ul className="space-y-0.5 text-sm">
          {fields.map((f) => (
            <li key={f.key}>
              {f.label}{' '}
              <span className="text-xs text-muted">
                ({typeLabel(f.type)} · {f.key})
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Modifications par rapport à la version publiée"
      wide
    >
      {!before && (
        <p className="text-sm text-muted">
          Aucune version publiée : tout le formulaire sera publié.
        </p>
      )}
      {before && empty && <p className="text-sm text-muted">Aucune différence.</p>}
      <div className="space-y-4">
        {list('Champs ajoutés', '#2E8B57', diff.added)}
        {list('Champs retirés', '#C4372D', diff.removed)}
        {list(
          'Champs modifiés',
          '#D98A1B',
          diff.changed.map((c) => c.after),
        )}
        {diff.removed.length > 0 && (
          <p className="flex items-center gap-2 rounded-md bg-warning/10 p-2 text-xs text-warning">
            <AlertTriangle className="size-4" /> Les fiches existantes conservent leurs valeurs :
            elles restent liées à leur version.
          </p>
        )}
      </div>
    </Dialog>
  );
}

export function DesignerPage() {
  const { structureId } = useParams({ strict: false }) as { structureId: string };
  const { short, api } = useApp();
  const queryClient = useQueryClient();
  const toast = useToast();

  const structure = useQuery({
    queryKey: [short, 'structure', structureId],
    queryFn: () => api.structures.get(structureId),
  });
  const versions = structure.data?.versions ?? [];
  const hasDraft = versions.some((v) => v.status === 'DRAFT');
  const hasCurrent = versions.some((v) => v.status === 'PUBLISHED');
  const draft = useQuery({
    queryKey: [short, 'version', structureId, 'draft'],
    queryFn: () => api.structures.version(structureId, 'draft'),
    enabled: hasDraft,
  });
  const current = useQuery({
    queryKey: [short, 'version', structureId, 'current'],
    queryFn: () => api.structures.version(structureId, 'current'),
    enabled: hasCurrent,
  });

  const [definition, setDefinition] = useState<StructureDefinition>();
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [dragging, setDragging] = useState<string>();
  const [showDiff, setShowDiff] = useState(false);
  const [tab, setTab] = useState('properties');
  const [view, setView] = useState<'form' | 'workflow'>('form');

  // Point de départ : le brouillon, sinon la version publiée (nouveau brouillon à l'enregistrement).
  useEffect(() => {
    if (definition || !structure.data) return;
    if (hasDraft && draft.data) setDefinition(draft.data.definition);
    else if (!hasDraft && hasCurrent && current.data) setDefinition(current.data.definition);
    else if (!hasDraft && !hasCurrent) setDefinition({ schemaVersion: 1, fields: [] });
  }, [structure.data, draft.data, current.data, hasDraft, hasCurrent, definition]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const analysis = useMemo(
    () => (definition ? analyzeDefinition(definition) : undefined),
    [definition],
  );
  const issues = analysis && !analysis.ok ? analysis.issues : [];
  const invalid = useMemo(
    () => new Set(issues.flatMap((i) => (i.field ? [i.field] : []))),
    [issues],
  );
  const lockedKeys = useMemo(
    () => (current.data ? allKeys(current.data.definition) : new Set<string>()),
    [current.data],
  );
  const lockedStates = useMemo(
    () => new Set((current.data?.definition.workflow?.states ?? []).map((s) => s.key)),
    [current.data],
  );

  const change = (next: StructureDefinition) => {
    setDefinition(next);
    setDirty(true);
  };

  const save = useMutation({
    mutationFn: () => api.structures.saveDraft(structureId, definition!),
    onSuccess: async () => {
      setDirty(false);
      toast.success('Brouillon enregistré');
      await queryClient.invalidateQueries({ queryKey: [short, 'structure', structureId] });
    },
    onError: (error) => toast.error(error),
  });
  const publish = useMutation({
    mutationFn: async () => {
      await api.structures.saveDraft(structureId, definition!);
      return api.structures.publish(structureId);
    },
    onSuccess: async (version) => {
      setDirty(false);
      toast.success(`Version ${version.version} publiée`);
      await queryClient.invalidateQueries({ queryKey: [short] });
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error : new Error('Publication impossible')),
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (!structure.data || !definition)
    return structure.error ? <ErrorMessage error={structure.error} /> : <Loading />;

  const add = (type: FieldType, container = ROOT, index?: number) => {
    const field = createField(type, definition, newId);
    const next = insertField(definition, field, container, index);
    if (next === definition) return;
    change(next);
    setSelected(field.id);
    setTab('properties');
  };

  const duplicate = (id: string) => {
    const found = findField(definition, id);
    if (!found) return;
    let taken = allKeys(definition);
    const copy = (field: Field): Field => {
      const key = uniqueKey(`${field.key}_copie`, taken);
      taken = new Set([...taken, key]);
      const clone = { ...structuredClone(field), id: newId(), key } as Field;
      if (clone.type === 'section' || clone.type === 'table')
        (clone as { fields: Field[] }).fields = (clone.fields as Field[]).map(copy);
      return clone;
    };
    const siblings = childrenOf(definition, found.container);
    change(
      insertField(
        definition,
        copy(found.field),
        found.container,
        siblings.findIndex((f) => f.id === id) + 1,
      ),
    );
  };

  const onDragStart = (event: DragStartEvent) => setDragging(String(event.active.id));
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(undefined);
    if (!over) return;
    const target = over.data.current as
      | { kind: 'container'; container: string }
      | { kind: 'field'; container: string; index: number };
    const source = active.data.current as
      { kind: 'palette'; type: FieldType } | { kind: 'field'; container: string; index: number };
    const index =
      target.kind === 'container' ? childrenOf(definition, target.container).length : target.index;
    if (source.kind === 'palette') {
      add(source.type, target.container, index);
      return;
    }
    if (active.id === over.id) return;
    // Dans un même conteneur, survoler un élément plus bas place le champ après lui.
    const sameContainer = source.container === target.container && target.kind === 'field';
    const insertion = sameContainer && source.index < index ? index + 1 : index;
    change(moveField(definition, String(active.id), target.container, insertion));
  };

  const draggedLabel = dragging?.startsWith('palette:')
    ? typeLabel(dragging.slice('palette:'.length) as FieldType)
    : dragging && findField(definition, dragging)?.field.label;
  const status = hasDraft
    ? `Brouillon v${draft.data?.version ?? '…'}`
    : hasCurrent
      ? 'Nouveau brouillon'
      : 'Brouillon v1';
  const fieldCount = [...walkFields(definition.fields)].length;

  return (
    <div className="-m-4 flex h-[calc(100dvh-3.5rem)] flex-col sm:-m-6 lg:-m-8 lg:h-screen">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-4 py-3 shadow-xs">
        <Button asChild size="icon" variant="ghost" aria-label="Retour aux formulaires">
          <Link to="/$app/structures" params={{ app: short }}>
            <ArrowLeft />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold tracking-tight">{structure.data.name}</h1>
          <p className="flex flex-wrap items-center text-xs text-muted">
            {status}
            {structure.data.currentVersion &&
              ` · publiée : v${structure.data.currentVersion}`} · {fieldCount} champ(s)
            {dirty && (
              <Badge className="ml-2" color="#D98A1B">
                Non enregistré
              </Badge>
            )}
          </p>
        </div>
        <Tabs value={view} onValueChange={(v) => setView(v as 'form' | 'workflow')}>
          <TabsList>
            <TabsTrigger value="form">
              <LayoutList className="mr-1 inline size-4" />
              Formulaire
            </TabsTrigger>
            <TabsTrigger value="workflow">
              <GitBranch className="mr-1 inline size-4" />
              Workflow
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {issues.length > 0 && (
          <Badge color="#C4372D" title={issues.map((i) => i.message).join('\n')}>
            <AlertTriangle className="mr-1 size-3" /> {issues.length} problème(s)
          </Badge>
        )}
        <Button variant="outline" onClick={() => setShowDiff(true)}>
          <GitCompare /> Comparer
        </Button>
        <Button
          variant="outline"
          onClick={() => save.mutate()}
          disabled={!dirty || issues.length > 0 || save.isPending}
        >
          <Save /> Enregistrer
        </Button>
        <Button onClick={() => publish.mutate()} disabled={issues.length > 0 || publish.isPending}>
          <Rocket /> Publier
        </Button>
      </header>

      {view === 'workflow' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <WorkflowEditor definition={definition} lockedStates={lockedStates} onChange={change} />
          {issues.some((i) => !i.field) && (
            <div className="border-t border-danger/40 bg-surface px-4 py-2" role="alert">
              {issues
                .filter((i) => !i.field)
                .map((issue, index) => (
                  <p key={index} className="text-xs text-danger">
                    {issue.message}
                  </p>
                ))}
            </div>
          )}
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={collision}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDragging(undefined)}
        >
          <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)_380px]">
            <aside
              className="overflow-y-auto border-r border-border bg-surface px-3 py-4"
              aria-label="Types de champs"
            >
              <Palette onAdd={(type) => add(type)} />
            </aside>
            <section
              className="overflow-y-auto bg-background bg-[radial-gradient(circle,var(--color-border)_1px,transparent_1px)] bg-size-[18px_18px] p-6 lg:p-8"
              aria-label="Formulaire"
            >
              <div className="mx-auto max-w-2xl">
                <Canvas
                  fields={definition.fields}
                  selected={selected}
                  onSelect={(id) => {
                    setSelected(id);
                    setTab('properties');
                  }}
                  onRemove={(id) => {
                    change(removeField(definition, id));
                    if (selected === id) setSelected(undefined);
                  }}
                  onDuplicate={duplicate}
                  invalid={invalid}
                />
                {issues.some((i) => !i.field) && (
                  <Card className="mt-4 space-y-1 border-danger/40 p-3">
                    {issues
                      .filter((i) => !i.field)
                      .map((issue, index) => (
                        <p key={index} className="text-xs text-danger">
                          {issue.message}
                        </p>
                      ))}
                  </Card>
                )}
              </div>
            </section>
            <aside className="overflow-y-auto border-l border-border bg-surface p-4">
              <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="mb-4">
                  <TabsTrigger value="properties">
                    <SlidersHorizontal className="mr-1 inline size-4" />
                    Propriétés
                  </TabsTrigger>
                  <TabsTrigger value="preview">
                    <Eye className="mr-1 inline size-4" />
                    Aperçu mobile
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="properties">
                  {selected && findField(definition, selected) ? (
                    <PropertiesPanel
                      definition={definition}
                      fieldId={selected}
                      lockedKeys={lockedKeys}
                      issues={issues}
                      onChange={(patch) =>
                        change(updateField(definition, selected, patch as Partial<Field>))
                      }
                    />
                  ) : (
                    <div className="flex flex-col items-center rounded-lg border border-dashed border-foreground/15 px-6 py-12 text-center">
                      <span className="mb-3 flex size-10 items-center justify-center rounded-full bg-subtle text-muted">
                        <MousePointerClick className="size-5" aria-hidden />
                      </span>
                      <p className="text-sm text-muted">
                        Sélectionnez un champ pour le configurer.
                      </p>
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="preview">
                  <MobilePreview definition={definition} />
                </TabsContent>
              </Tabs>
            </aside>
          </div>
          <DragOverlay>
            {draggedLabel ? (
              <div className="rounded-lg border border-accent bg-surface px-3 py-2 text-sm font-medium shadow-lg ring-3 ring-accent/15">
                {draggedLabel}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
      <DiffDialog
        open={showDiff}
        onOpenChange={setShowDiff}
        before={current.data?.definition}
        after={definition}
      />
    </div>
  );
}
