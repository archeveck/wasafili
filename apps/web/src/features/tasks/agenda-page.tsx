import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dayIn } from '@tesserax/form-engine';
import { type Task } from '@tesserax/sdk';
import { ChevronLeft, ChevronRight, MapPin, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorMessage, PageHeader } from '@/components/ui/display';
import { useToast } from '@/components/ui/toast';
import { addDays, formatDay, fromZoned, weekStart, zoned } from '@/lib/dates';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';
import {
  type AssigneeRef,
  assigneeFields,
  assigneeOf,
  TASK_STATUS_LABELS,
  TaskDialog,
  type TaskDraft,
} from './task-dialog';

const DAY_MS = 86_400_000;

const STATUS_STYLE: Record<Task['status'], string> = {
  todo: 'border-l-primary',
  in_progress: 'border-l-warning',
  done: 'border-l-success opacity-70',
  cancelled: 'border-l-muted opacity-50 line-through',
};

function TaskCard({
  task,
  timeZone,
  structureName,
  onOpen,
}: {
  task: Task;
  timeZone: string;
  structureName: string | undefined;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      {...attributes}
      onClick={onOpen}
      aria-label={`${task.title}, ${zoned(task.startAt, timeZone).time}, ${TASK_STATUS_LABELS[task.status]}`}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
      className={cn(
        'block w-full cursor-grab rounded border border-l-4 border-border bg-surface px-2 py-1 text-left text-xs shadow-sm',
        STATUS_STYLE[task.status],
        isDragging && 'z-10 cursor-grabbing shadow-lg',
      )}
    >
      <span className="font-medium">{zoned(task.startAt, timeZone).time}</span> {task.title}
      {structureName && <span className="block truncate text-muted">{structureName}</span>}
      {task.locationLabel && (
        <span className="flex items-center gap-1 truncate text-muted">
          <MapPin className="size-3" /> {task.locationLabel}
        </span>
      )}
    </button>
  );
}

function Cell({
  id,
  children,
  onAdd,
  label,
  canPlan,
}: {
  id: string;
  children: React.ReactNode;
  onAdd: () => void;
  label: string;
  canPlan: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !canPlan });
  return (
    <td
      ref={setNodeRef}
      className={cn('group h-20 border border-border p-1 align-top', isOver && 'bg-primary/10')}
    >
      <div className="space-y-1">{children}</div>
      {canPlan && (
        <button
          type="button"
          onClick={onAdd}
          aria-label={label}
          className="mt-1 hidden w-full rounded border border-dashed border-border py-0.5 text-xs text-muted hover:bg-subtle group-hover:block focus:block"
        >
          <Plus className="mx-auto size-3" />
        </button>
      )}
    </td>
  );
}

/**
 * Agenda multi-utilisateurs (P4.4.3) : une semaine, une ligne par personne ou groupe. Glisser
 * une tâche vers une autre case la réassigne et la replanifie (même heure, autre jour).
 */
export function AgendaPage() {
  const { api, short, timeZone, can } = useApp();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canPlan = can('task:manage');
  const [week, setWeek] = useState(() => weekStart(dayIn(new Date(), timeZone)));
  const [dialog, setDialog] = useState<{ task?: Task; draft?: TaskDraft } | null>(null);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);
  const range = {
    from: fromZoned(week, '00:00', timeZone).toISOString(),
    to: fromZoned(addDays(week, 7), '00:00', timeZone).toISOString(),
  };

  const tasks = useQuery({
    queryKey: [short, 'tasks', range],
    queryFn: () => api.tasks.list({ ...range, perPage: 500 }),
    placeholderData: (previous) => previous,
  });
  const users = useQuery({
    queryKey: [short, 'users', 'all'],
    queryFn: () => api.users.list({ perPage: 100 }),
    enabled: can('user:read'),
  });
  const groups = useQuery({
    queryKey: [short, 'groups', 'all'],
    queryFn: () => api.groups.list({ perPage: 100 }),
    enabled: can('group:read'),
  });
  const structures = useQuery({
    queryKey: [short, 'structures', 'published'],
    queryFn: () => api.structures.list({ perPage: 100 }),
  });
  const structureNames = new Map((structures.data?.data ?? []).map((s) => [s.id, s.name]));

  const rows: { ref: AssigneeRef; label: string }[] = [
    { ref: 'none', label: 'Non assignées' },
    ...(groups.data?.data ?? []).map((g) => ({ ref: `group:${g.id}`, label: `Groupe ${g.name}` })),
    ...(users.data?.data ?? [])
      .filter((u) => u.isActive)
      .map((u) => ({ ref: `user:${u.id}`, label: `${u.firstName} ${u.lastName}` })),
  ];
  // Tâches assignées à quelqu'un d'absent de la liste (droits limités) : ligne dédiée.
  for (const task of tasks.data?.data ?? []) {
    const ref = assigneeOf(task);
    if (!rows.some((r) => r.ref === ref)) rows.push({ ref, label: 'Autre assigné' });
  }

  const byCell = new Map<string, Task[]>();
  for (const task of tasks.data?.data ?? []) {
    const key = `${assigneeOf(task)}|${zoned(task.startAt, timeZone).date}`;
    byCell.set(key, [...(byCell.get(key) ?? []), task]);
  }

  const move = useMutation({
    mutationFn: ({ task, ref, date }: { task: Task; ref: AssigneeRef; date: string }) => {
      const shift =
        Date.parse(`${date}T00:00:00Z`) -
        Date.parse(`${zoned(task.startAt, timeZone).date}T00:00:00Z`);
      const days = Math.round(shift / DAY_MS);
      const at = (iso: string) => {
        const { date: d, time } = zoned(iso, timeZone);
        return fromZoned(addDays(d, days), time, timeZone).toISOString();
      };
      return api.tasks.update(task.id, {
        ...(ref !== assigneeOf(task) ? assigneeFields(ref) : {}),
        ...(days !== 0 ? { startAt: at(task.startAt), endAt: at(task.endAt) } : {}),
      });
    },
    onSuccess: () => toast.success('Tâche replanifiée'),
    onError: toast.error,
    onSettled: () => queryClient.invalidateQueries({ queryKey: [short, 'tasks'] }),
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const task = (active.data.current as { task: Task }).task;
    const [ref, date] = String(over.id).split('|') as [AssigneeRef, string];
    if (ref === assigneeOf(task) && date === zoned(task.startAt, timeZone).date) return;
    move.mutate({ task, ref, date });
  };

  const today = dayIn(new Date(), timeZone);
  const title = `Semaine du ${formatDay(week, { day: 'numeric', month: 'long', year: 'numeric' })}`;
  return (
    <>
      <PageHeader
        title="Agenda"
        description={title}
        actions={
          <>
            <Button
              variant="outline"
              size="icon"
              aria-label="Semaine précédente"
              onClick={() => setWeek(addDays(week, -7))}
            >
              <ChevronLeft />
            </Button>
            <Button variant="outline" onClick={() => setWeek(weekStart(today))}>
              Aujourd'hui
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Semaine suivante"
              onClick={() => setWeek(addDays(week, 7))}
            >
              <ChevronRight />
            </Button>
            {canPlan && (
              <Button onClick={() => setDialog({ draft: { assignee: 'none', date: today } })}>
                <Plus /> Nouvelle tâche
              </Button>
            )}
          </>
        }
      />
      {tasks.error && <ErrorMessage error={tasks.error} />}
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="overflow-x-auto">
          <table
            className="w-full min-w-[900px] table-fixed border-collapse text-sm"
            aria-label="Agenda de la semaine"
          >
            <thead>
              <tr>
                <th className="w-40 p-2 text-left text-xs font-medium text-muted">Assigné</th>
                {days.map((day) => (
                  <th
                    key={day}
                    className={cn(
                      'p-2 text-left text-xs font-medium',
                      day === today ? 'text-primary' : 'text-muted',
                    )}
                  >
                    {formatDay(day, { weekday: 'short', day: 'numeric', month: 'short' })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.ref}>
                  <th
                    scope="row"
                    className="border border-border p-2 text-left align-top text-xs font-medium"
                  >
                    {row.label}
                  </th>
                  {days.map((day) => (
                    <Cell
                      key={day}
                      id={`${row.ref}|${day}`}
                      canPlan={canPlan}
                      label={`Planifier pour ${row.label} le ${formatDay(day, { day: 'numeric', month: 'long' })}`}
                      onAdd={() => setDialog({ draft: { assignee: row.ref, date: day } })}
                    >
                      {(byCell.get(`${row.ref}|${day}`) ?? []).map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          timeZone={timeZone}
                          structureName={structureNames.get(task.structureId)}
                          onOpen={() => canPlan && setDialog({ task })}
                        />
                      ))}
                    </Cell>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DndContext>
      {dialog && (
        <TaskDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          task={dialog.task}
          draft={dialog.draft}
          assignees={rows
            .filter((r) => r.label !== 'Autre assigné')
            .map((r) => ({ value: r.ref, label: r.label }))}
        />
      )}
    </>
  );
}
