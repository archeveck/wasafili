import { useQuery } from '@tanstack/react-query';
import {
  COMPUTED_TYPES,
  type StructureDefinition,
  walkFields,
  type WorkflowState,
  type WorkflowTransition,
  hasValue,
} from '@tesserax/form-schema';
import {
  Background,
  type Connection,
  Controls,
  type Edge,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  applyNodeChanges,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Flag, GitBranch, Lock, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checklist } from '@/components/ui/checklist';
import { Badge, Card } from '@/components/ui/display';
import { FormRow, Input, Select, Textarea } from '@/components/ui/form-controls';
import { useApp } from '@/lib/use-app';
import {
  addState,
  addTransition,
  defaultWorkflow,
  layoutStates,
  removeState,
  removeTransition,
  removeWorkflow,
  updateState,
  updateTransition,
} from './workflow-model';

const GREY = '#5B6470';

type StateNode = Node<{ state: WorkflowState }, 'state'>;

function StateNodeView({ data, selected }: NodeProps<StateNode>) {
  const { state } = data;
  const color = state.color ?? GREY;
  return (
    <div
      className="min-w-36 rounded-lg border-2 bg-surface px-3 py-2 text-sm shadow-sm"
      style={{ borderColor: selected ? 'var(--color-primary)' : `${color}99` }}
    >
      <Handle type="target" position={Position.Left} id="in" />
      {/* Transitions vers un état antérieur : tracées par le bas, sans croiser les autres. */}
      <Handle type="target" position={Position.Bottom} id="back-in" className="!opacity-0" />
      <div className="flex items-center gap-2">
        <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="font-medium">{state.label}</span>
      </div>
      <div className="mt-1 flex gap-1">
        {state.initial && <Badge>Initial</Badge>}
        {state.final && <Badge>Final</Badge>}
      </div>
      {!state.final && <Handle type="source" position={Position.Right} id="out" />}
      {!state.final && (
        <Handle type="source" position={Position.Bottom} id="back-out" className="!opacity-0" />
      )}
    </div>
  );
}

const nodeTypes = { state: StateNodeView };

type Selection = { kind: 'state'; key: string } | { kind: 'transition'; key: string } | null;

function ColorInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value?: string | undefined;
  onChange: (v: string) => void;
}) {
  return (
    <Input
      id={id}
      type="color"
      className="h-9 w-16 p-1"
      value={value ?? GREY}
      onChange={(e) => onChange(e.target.value.toUpperCase())}
    />
  );
}

function StatePanel({
  definition,
  state,
  locked,
  onChange,
  onSelectTransition,
}: {
  definition: StructureDefinition;
  state: WorkflowState;
  locked: boolean;
  /** `select` : nouvelle sélection (clé renommée, ou `null` après suppression). */
  onChange: (next: StructureDefinition, select?: string | null) => void;
  onSelectTransition: (key: string) => void;
}) {
  const workflow = definition.workflow!;
  const [target, setTarget] = useState('');
  const outgoing = workflow.transitions.filter((t) => t.from.includes(state.key));
  const targets = workflow.states.filter((s) => s.key !== state.key);
  return (
    <div className="space-y-4" aria-label="Propriétés de l'état">
      <FormRow label="Libellé" htmlFor="state-label" required>
        <Input
          id="state-label"
          value={state.label}
          onChange={(e) => onChange(updateState(definition, state.key, { label: e.target.value }))}
        />
      </FormRow>
      <FormRow
        label="Clé"
        htmlFor="state-key"
        help={locked ? 'Utilisée par des fiches publiées : non modifiable.' : undefined}
      >
        <div className="relative">
          <Input
            id="state-key"
            className="pr-8 font-mono text-xs"
            value={state.key}
            disabled={locked}
            onChange={(e) =>
              onChange(updateState(definition, state.key, { key: e.target.value }), e.target.value)
            }
          />
          {locked && <Lock className="absolute right-2.5 top-2.5 size-4 text-muted" />}
        </div>
      </FormRow>
      <FormRow label="Couleur" htmlFor="state-color">
        <ColorInput
          id="state-color"
          value={state.color}
          onChange={(color) => onChange(updateState(definition, state.key, { color }))}
        />
      </FormRow>
      <div className="flex flex-wrap gap-2">
        {!state.initial && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onChange(updateState(definition, state.key, { initial: true, final: undefined }))
            }
          >
            <Flag /> Définir comme état initial
          </Button>
        )}
        {!state.initial && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onChange(
                updateState(definition, state.key, { final: state.final ? undefined : true }),
              )
            }
          >
            {state.final ? 'Ne plus être final' : 'Marquer comme final'}
          </Button>
        )}
      </div>

      {!state.final && (
        <div className="space-y-2 border-t border-border pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Transitions sortantes
          </p>
          {outgoing.length === 0 && <p className="text-xs text-muted">Aucune.</p>}
          {outgoing.map((t) => (
            <button
              key={t.key}
              type="button"
              className="block w-full rounded-md border border-border px-3 py-1.5 text-left text-sm hover:bg-subtle"
              onClick={() => onSelectTransition(t.key)}
            >
              {t.label} → {workflow.states.find((s) => s.key === t.to)?.label}
            </button>
          ))}
          <div className="flex gap-2">
            <Select
              aria-label="État cible"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="flex-1"
            >
              <option value="">Vers l'état…</option>
              {targets.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              variant="outline"
              disabled={!target}
              onClick={() => {
                const created = addTransition(definition, state.key, target);
                onChange(created.definition);
                setTarget('');
                onSelectTransition(created.key);
              }}
            >
              <Plus /> Transition
            </Button>
          </div>
        </div>
      )}

      <Button
        size="sm"
        variant="ghost"
        className="text-danger"
        disabled={locked || workflow.states.length === 1}
        title={locked ? 'Des fiches publiées peuvent être dans cet état' : undefined}
        onClick={() => onChange(removeState(definition, state.key), null)}
      >
        <Trash2 /> Supprimer l'état
      </Button>
    </div>
  );
}

function TransitionPanel({
  definition,
  transition,
  onChange,
  onRemove,
}: {
  definition: StructureDefinition;
  transition: WorkflowTransition;
  onChange: (next: StructureDefinition) => void;
  onRemove: () => void;
}) {
  const { api, short, can } = useApp();
  const roles = useQuery({
    queryKey: [short, 'roles'],
    queryFn: () => api.roles.list({ perPage: 100 }),
    enabled: can('role:read'),
  });
  const workflow = definition.workflow!;
  const patch = (p: Partial<WorkflowTransition>) =>
    onChange(updateTransition(definition, transition.key, p));
  const sources = workflow.states
    .filter((s) => !s.final)
    .map((s) => ({ value: s.key, label: s.label }));
  // Champs exigibles : champs racines porteurs d'une valeur.
  const fields = [...walkFields(definition.fields)]
    // Champs saisis à la racine (les champs calculés ou automatiques sont remplis par le serveur).
    .filter(
      ({ field, table }) =>
        !table && hasValue(field) && field.type !== 'table' && !COMPUTED_TYPES.has(field.type),
    )
    .map(({ field }) => ({ value: field.key, label: field.label }));

  return (
    <div className="space-y-4" aria-label="Propriétés de la transition">
      <p className="text-xs text-muted">
        Bouton d'enregistrement proposé sur la fiche (web et mobile) dans les états de départ.
      </p>
      <FormRow label="Libellé du bouton" htmlFor="transition-label" required>
        <Input
          id="transition-label"
          value={transition.label}
          onChange={(e) => patch({ label: e.target.value })}
        />
      </FormRow>
      <FormRow label="Clé" htmlFor="transition-key">
        <Input
          id="transition-key"
          className="font-mono text-xs"
          value={transition.key}
          onChange={(e) => patch({ key: e.target.value })}
        />
      </FormRow>
      <FormRow label="Couleur du bouton" htmlFor="transition-color">
        <ColorInput
          id="transition-color"
          value={transition.color}
          onChange={(color) => patch({ color })}
        />
      </FormRow>
      <div className="space-y-1">
        <p className="text-sm">Depuis les états</p>
        <Checklist
          label="États de départ"
          options={sources}
          value={transition.from}
          onChange={(from) => (from ? patch({ from }) : undefined)}
        />
      </div>
      <FormRow label="Vers l'état" htmlFor="transition-to">
        <Select
          id="transition-to"
          value={transition.to}
          onChange={(e) => patch({ to: e.target.value })}
        >
          {workflow.states.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </Select>
      </FormRow>
      <div className="space-y-1">
        <p className="text-sm">Rôles autorisés</p>
        <p className="text-xs text-muted">
          Rien de coché : tous les rôles qui peuvent modifier la fiche.
        </p>
        <Checklist
          label="Rôles autorisés"
          options={(roles.data?.data ?? []).map((r) => ({ value: r.key, label: r.name }))}
          value={transition.roles}
          onChange={(roles) => patch({ roles })}
        />
      </div>
      <div className="space-y-1">
        <p className="text-sm">Champs à renseigner</p>
        <Checklist
          label="Champs à renseigner"
          options={fields}
          value={transition.requiredFields}
          onChange={(requiredFields) => patch({ requiredFields })}
          empty="Aucun champ dans le formulaire."
        />
      </div>
      <FormRow
        label="Confirmation"
        htmlFor="transition-confirm"
        help="Question posée avant la transition (facultatif)."
      >
        <Textarea
          id="transition-confirm"
          rows={2}
          value={transition.confirm ?? ''}
          onChange={(e) => patch({ confirm: e.target.value || undefined })}
        />
      </FormRow>
      <Button size="sm" variant="ghost" className="text-danger" onClick={onRemove}>
        <Trash2 /> Supprimer la transition
      </Button>
    </div>
  );
}

/**
 * Éditeur de workflow visuel (P4.2) : états en nœuds, transitions en flèches. Relier deux
 * états crée une transition ; le panneau de droite règle le bouton (libellé, couleur, rôles,
 * champs exigés). Chaque modification passe par `workflow-model` (définition toujours cohérente).
 */
export function WorkflowEditor({
  definition,
  lockedStates,
  onChange,
}: {
  definition: StructureDefinition;
  /** États de la version publiée : des fiches peuvent y être, clé et suppression bloquées. */
  lockedStates: Set<string>;
  onChange: (next: StructureDefinition) => void;
}) {
  const workflow = definition.workflow;
  const [selection, setSelection] = useState<Selection>(null);

  const positions = useMemo(
    () => (workflow ? layoutStates(workflow) : new Map<string, { x: number; y: number }>()),
    [workflow],
  );
  const graphNodes = useMemo<StateNode[]>(() => {
    return (workflow?.states ?? []).map((state) => ({
      id: state.key,
      type: 'state',
      position: positions.get(state.key)!,
      data: { state },
      selected: selection?.kind === 'state' && selection.key === state.key,
    }));
  }, [workflow, positions, selection]);
  // Les positions vivent localement pendant le glisser, puis sont enregistrées à la fin.
  const [nodes, setNodes] = useState(graphNodes);
  useEffect(() => setNodes(graphNodes), [graphNodes]);

  const edges = useMemo<Edge[]>(
    () =>
      (workflow?.transitions ?? []).flatMap((t) =>
        t.from.map((from) => {
          const back = (positions.get(t.to)?.x ?? 0) <= (positions.get(from)?.x ?? 0);
          return {
            id: `${t.key}:${from}`,
            source: from,
            target: t.to,
            sourceHandle: back ? 'back-out' : 'out',
            targetHandle: back ? 'back-in' : 'in',
            ...(back ? { type: 'smoothstep', pathOptions: { offset: 30 } } : {}),
            label: t.label,
            data: { transition: t.key },
            selected: selection?.kind === 'transition' && selection.key === t.key,
            markerEnd: { type: MarkerType.ArrowClosed, color: t.color ?? GREY },
            style: { stroke: t.color ?? GREY, strokeWidth: 2 },
            labelStyle: { fontSize: 12, fontWeight: 500 },
          };
        }),
      ),
    [workflow, positions, selection],
  );

  if (!workflow) {
    return (
      <div className="grid flex-1 place-items-center p-6">
        <Card className="max-w-md space-y-3 p-6 text-center">
          <GitBranch className="mx-auto size-8 text-muted" />
          <h2 className="font-semibold">Pas de workflow</h2>
          <p className="text-sm text-muted">
            Un workflow fait passer les fiches par des états (Brouillon, Soumis, Validé…). Ses
            transitions deviennent des boutons d'enregistrement sur le web et le mobile.
          </p>
          <Button onClick={() => onChange({ ...definition, workflow: defaultWorkflow() })}>
            <Plus /> Ajouter un workflow
          </Button>
        </Card>
      </div>
    );
  }

  const selectedState =
    selection?.kind === 'state' ? workflow.states.find((s) => s.key === selection.key) : undefined;
  const selectedTransition =
    selection?.kind === 'transition'
      ? workflow.transitions.find((t) => t.key === selection.key)
      : undefined;
  const statesInUse = workflow.states.some((s) => lockedStates.has(s.key));

  const connect = ({ source, target }: Connection) => {
    if (!source || !target || source === target) return;
    const created = addTransition(definition, source, target);
    onChange(created.definition);
    setSelection({ kind: 'transition', key: created.key });
  };

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_360px]">
      <section className="relative" aria-label="Graphe du workflow">
        <div className="absolute left-3 top-3 z-10 flex gap-2">
          <Button
            size="sm"
            onClick={() => {
              const created = addState(definition, 'Nouvel état');
              onChange(created.definition);
              setSelection({ kind: 'state', key: created.key });
            }}
          >
            <Plus /> État
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={statesInUse}
            title={statesInUse ? 'Des fiches publiées utilisent ce workflow' : undefined}
            onClick={() => {
              onChange(removeWorkflow(definition));
              setSelection(null);
            }}
          >
            Retirer le workflow
          </Button>
        </div>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={(changes: NodeChange<StateNode>[]) =>
            setNodes((current) => applyNodeChanges(changes, current))
          }
          onNodeDragStop={(_event, node) =>
            onChange(
              updateState(definition, node.id, {
                position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
              }),
            )
          }
          onConnect={connect}
          onNodeClick={(_event, node) => setSelection({ kind: 'state', key: node.id })}
          onEdgeClick={(_event, edge) =>
            setSelection({
              kind: 'transition',
              key: (edge.data as { transition: string }).transition,
            })
          }
          onPaneClick={() => setSelection(null)}
          deleteKeyCode={null}
          fitView
          fitViewOptions={{ maxZoom: 1 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </section>
      <aside className="overflow-y-auto border-l border-border bg-surface p-4">
        {selectedState ? (
          <StatePanel
            key={selectedState.key}
            definition={definition}
            state={selectedState}
            locked={lockedStates.has(selectedState.key)}
            onChange={(next, select) => {
              onChange(next);
              if (select === null) setSelection(null);
              else if (select !== undefined) setSelection({ kind: 'state', key: select });
            }}
            onSelectTransition={(key) => setSelection({ kind: 'transition', key })}
          />
        ) : selectedTransition ? (
          <TransitionPanel
            definition={definition}
            transition={selectedTransition}
            onChange={(next) => {
              onChange(next);
              // La sélection suit une transition renommée (même position dans la liste).
              const index = workflow.transitions.indexOf(selectedTransition);
              const renamed = next.workflow?.transitions[index];
              if (renamed && renamed.key !== selectedTransition.key)
                setSelection({ kind: 'transition', key: renamed.key });
            }}
            onRemove={() => {
              onChange(removeTransition(definition, selectedTransition.key));
              setSelection(null);
            }}
          />
        ) : (
          <div className="space-y-2 text-sm text-muted">
            <p className="font-medium text-foreground">
              {workflow.states.length} état(s), {workflow.transitions.length} transition(s)
            </p>
            <p>Cliquez sur un état ou une flèche pour le configurer.</p>
            <p>Reliez la poignée droite d'un état à un autre pour créer une transition.</p>
          </div>
        )}
      </aside>
    </div>
  );
}
