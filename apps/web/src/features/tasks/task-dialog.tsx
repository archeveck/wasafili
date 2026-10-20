import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type Field,
  type StructureDefinition,
  type SubmissionData,
  walkFields,
} from '@wasafili/form-schema';
import { type Task, type TaskStatus } from '@wasafili/sdk';
import { Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FormRow, Input, Select, Textarea } from '@/components/ui/form-controls';
import { Dialog } from '@/components/ui/overlays';
import { useToast } from '@/components/ui/toast';
import { FormRenderer } from '@/form/form-renderer';
import { fieldServices } from '@/form/services';
import { useFormRenderer } from '@/form/use-form';
import { fromZoned, zoned } from '@/lib/dates';
import { useApp } from '@/lib/use-app';

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'À faire',
  in_progress: 'En cours',
  done: 'Faite',
  cancelled: 'Annulée',
};

/** Assigné d'une tâche : `user:<id>`, `group:<id>` ou `none`. */
export type AssigneeRef = string;

export function assigneeOf(task: Pick<Task, 'assigneeUserId' | 'assigneeGroupId'>): AssigneeRef {
  if (task.assigneeUserId) return `user:${task.assigneeUserId}`;
  if (task.assigneeGroupId) return `group:${task.assigneeGroupId}`;
  return 'none';
}

export function assigneeFields(ref: AssigneeRef) {
  const [kind, id] = ref.split(':');
  return {
    assigneeUserId: kind === 'user' ? id! : null,
    assigneeGroupId: kind === 'group' ? id! : null,
  };
}

const PREFILL_TYPES = new Set<Field['type']>([
  'list',
  'select',
  'text',
  'number',
  'date',
  'barcode',
]);

/**
 * Champs pré-remplissables depuis la tâche (équipement, site, référence…) : champs simples hors
 * tableaux, sans conditions ni obligation, la fiche étant complétée sur le terrain.
 */
function prefillDefinition(definition: StructureDefinition): StructureDefinition {
  const fields = [...walkFields(definition.fields)]
    .filter(({ field, table }) => !table && PREFILL_TYPES.has(field.type))
    .map(({ field }) => {
      const {
        required: _r,
        requiredIf: _ri,
        visibleIf: _vi,
        visibleInStates: _vs,
        editableInStates: _es,
        visibleToRoles: _vr,
        editableByRoles: _er,
        readOnly: _ro,
        ...rest
      } = field;
      return { ...rest, ...('defaultNow' in rest ? { defaultNow: false } : {}) } as Field;
    });
  return { schemaVersion: definition.schemaVersion, fields };
}

function Prefill({
  definition,
  initial,
  onChange,
}: {
  definition: StructureDefinition;
  initial: SubmissionData;
  onChange: (values: SubmissionData) => void;
}) {
  const { api } = useApp();
  const subset = useMemo(() => prefillDefinition(definition), [definition]);
  const form = useFormRenderer(subset, { initialValues: initial });
  // Seules les valeurs renseignées sont transmises (le terrain complète le reste).
  const filled = JSON.stringify(
    Object.fromEntries(
      Object.entries(form.values).filter(([, v]) => v !== null && v !== undefined && v !== ''),
    ),
  );
  useEffect(() => onChange(JSON.parse(filled) as SubmissionData), [filled, onChange]);
  if (subset.fields.length === 0) return null;
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <p className="text-sm font-medium">Pré-remplir la fiche</p>
      <FormRenderer definition={subset} form={form} services={fieldServices(api)} />
    </div>
  );
}

export interface TaskDraft {
  assignee: AssigneeRef;
  date: string;
}

/** Création ou modification d'une tâche (agenda). */
export function TaskDialog({
  open,
  onOpenChange,
  task,
  draft,
  assignees,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: Task | undefined;
  draft?: TaskDraft | undefined;
  assignees: { value: AssigneeRef; label: string }[];
}) {
  const { api, short, timeZone } = useApp();
  const toast = useToast();
  const queryClient = useQueryClient();
  const structures = useQuery({
    queryKey: [short, 'structures', 'published'],
    queryFn: () => api.structures.list({ perPage: 100 }),
  });
  const published = (structures.data?.data ?? []).filter((s) => s.currentVersion);

  const start = task ? zoned(task.startAt, timeZone) : { date: draft?.date ?? '', time: '08:00' };
  const end = task ? zoned(task.endAt, timeZone) : { date: start.date, time: '09:00' };
  const [title, setTitle] = useState(task?.title ?? '');
  const [structureId, setStructureId] = useState(task?.structureId ?? '');
  const [assignee, setAssignee] = useState<AssigneeRef>(
    task ? assigneeOf(task) : (draft?.assignee ?? 'none'),
  );
  const [date, setDate] = useState(start.date);
  const [startTime, setStartTime] = useState(start.time);
  const [endTime, setEndTime] = useState(end.time);
  const [dueDate, setDueDate] = useState(task?.dueAt ? zoned(task.dueAt, timeZone).date : '');
  const [locationLabel, setLocationLabel] = useState(task?.locationLabel ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'todo');
  const [prefill, setPrefill] = useState<SubmissionData>(task?.prefill ?? {});

  const selected = published.find((s) => s.id === structureId);
  const version = useQuery({
    queryKey: [short, 'version', structureId, 'current'],
    queryFn: () => api.structures.version(structureId, 'current'),
    enabled: !!selected,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: [short, 'tasks'] });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: title.trim(),
        ...assigneeFields(assignee),
        startAt: fromZoned(date, startTime, timeZone).toISOString(),
        endAt: fromZoned(date, endTime, timeZone).toISOString(),
        // Échéance : fin de la journée choisie.
        dueAt: dueDate ? fromZoned(dueDate, '23:59', timeZone).toISOString() : null,
        locationLabel: locationLabel.trim() || null,
        description: description.trim() || null,
        prefill,
      };
      return task
        ? api.tasks.update(task.id, { ...body, status })
        : api.tasks.create({ ...body, structureId });
    },
    onSuccess: async () => {
      toast.success(task ? 'Tâche modifiée' : 'Tâche planifiée');
      await invalidate();
      onOpenChange(false);
    },
    onError: toast.error,
  });
  const remove = useMutation({
    mutationFn: () => api.tasks.remove(task!.id),
    onSuccess: async () => {
      toast.success('Tâche supprimée');
      await invalidate();
      onOpenChange(false);
    },
    onError: toast.error,
  });

  const valid = title.trim() && structureId && date && startTime < endTime;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={task ? 'Tâche' : 'Nouvelle tâche'}
      wide
      footer={
        <>
          {task && (
            <Button
              variant="ghost"
              className="mr-auto text-danger"
              onClick={() => confirm('Supprimer cette tâche ?') && remove.mutate()}
            >
              <Trash2 /> Supprimer
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormRow label="Titre" htmlFor="task-title" required className="sm:col-span-2">
          <Input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </FormRow>
        <FormRow label="Formulaire à remplir" htmlFor="task-structure" required>
          <Select
            id="task-structure"
            value={structureId}
            disabled={!!task}
            onChange={(e) => {
              setStructureId(e.target.value);
              setPrefill({});
            }}
          >
            <option value="">Choisir…</option>
            {published.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </FormRow>
        <FormRow label="Assignée à" htmlFor="task-assignee">
          <Select id="task-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            {assignees.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </Select>
        </FormRow>
        <FormRow label="Date" htmlFor="task-date" required>
          <Input
            id="task-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </FormRow>
        <div className="grid grid-cols-2 gap-2">
          <FormRow label="Début" htmlFor="task-start">
            <Input
              id="task-start"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </FormRow>
          <FormRow
            label="Fin"
            htmlFor="task-end"
            error={startTime < endTime ? undefined : 'La fin doit suivre le début'}
          >
            <Input
              id="task-end"
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </FormRow>
        </div>
        <FormRow label="Échéance" htmlFor="task-due">
          <Input
            id="task-due"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </FormRow>
        <FormRow label="Lieu" htmlFor="task-location">
          <Input
            id="task-location"
            value={locationLabel}
            onChange={(e) => setLocationLabel(e.target.value)}
          />
        </FormRow>
        {task && (
          <FormRow label="Statut" htmlFor="task-status">
            <Select
              id="task-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as TaskStatus)}
            >
              {Object.entries(TASK_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </FormRow>
        )}
        <FormRow label="Consignes" htmlFor="task-description" className="sm:col-span-2">
          <Textarea
            id="task-description"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </FormRow>
        {version.data && (
          <div className="sm:col-span-2">
            <Prefill
              key={structureId}
              definition={version.data.definition}
              initial={prefill}
              onChange={setPrefill}
            />
          </div>
        )}
      </div>
    </Dialog>
  );
}
