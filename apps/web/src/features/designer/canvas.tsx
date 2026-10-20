import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { type Field } from '@wasafili/form-schema';
import { Calculator, Copy, Eye, GripVertical, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/display';
import { cn } from '@/lib/utils';
import { FIELD_ICONS } from './field-icons';
import { ROOT, typeLabel } from './model';

interface CanvasProps {
  selected: string | undefined;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  /** Champs portant une erreur d'analyse. */
  invalid: Set<string>;
}

function DropZone({ container, empty }: { container: string; empty: boolean }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `drop:${container}`,
    data: { kind: 'container', container },
  });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex items-center justify-center gap-2 rounded-lg border border-dashed text-center text-xs text-muted transition-colors',
        empty ? 'flex-col py-10' : 'py-2',
        isOver ? 'border-accent bg-accent/5 text-accent' : 'border-foreground/15',
      )}
    >
      {empty && (
        <span
          className={cn(
            'flex size-9 items-center justify-center rounded-full',
            isOver ? 'bg-accent/10' : 'bg-subtle',
          )}
          aria-hidden
        >
          <Plus className="size-4" />
        </span>
      )}
      {empty ? 'Glissez des champs ici' : 'Déposer ici'}
    </div>
  );
}

function FieldCard({
  field,
  container,
  index,
  props,
}: {
  field: Field;
  container: string;
  index: number;
  props: CanvasProps;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.id,
    data: { kind: 'field', container, index },
  });
  const nested = field.type === 'section' || field.type === 'table';
  const active = props.selected === field.id;
  const invalid = props.invalid.has(field.key);
  const Icon = FIELD_ICONS[field.type];
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'group/field rounded-lg border bg-surface shadow-xs transition-[border-color,box-shadow]',
        active
          ? 'border-accent ring-3 ring-accent/15'
          : 'border-border hover:border-foreground/20 hover:shadow-sm',
        invalid && 'border-danger ring-danger/15',
        isDragging && 'opacity-40',
      )}
      data-testid={`field-${field.key}`}
    >
      <div
        className={cn('flex items-center gap-2 px-2 py-2', nested && 'rounded-t-lg bg-subtle/60')}
      >
        <button
          type="button"
          className="cursor-grab rounded-md p-1 text-muted transition-colors hover:bg-subtle hover:text-foreground"
          aria-label={`Déplacer ${field.label}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-md transition-colors',
            invalid
              ? 'bg-danger/10 text-danger'
              : active
                ? 'bg-accent/10 text-accent'
                : 'bg-subtle text-muted group-hover/field:text-foreground',
          )}
          aria-hidden
        >
          <Icon className="size-4" />
        </span>
        <button
          type="button"
          className="min-w-0 flex-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-accent/35"
          onClick={() => props.onSelect(field.id)}
        >
          <span className={cn('block truncate font-medium', nested && 'font-semibold')}>
            {field.label}
            {field.required && <span className="ml-0.5 text-danger">*</span>}
          </span>
          <span className="block truncate text-xs text-muted">
            {typeLabel(field.type)} · {field.key}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          {(field.visibleIf || field.requiredIf) && (
            <Badge title="Conditionnel">
              <Eye className="size-3" />
            </Badge>
          )}
          {field.type === 'calculated' && (
            <Badge title="Calcul">
              <Calculator className="size-3" />
            </Badge>
          )}
          <button
            type="button"
            className="rounded-md p-1 text-muted transition-colors hover:bg-subtle hover:text-foreground"
            aria-label={`Dupliquer ${field.label}`}
            onClick={() => props.onDuplicate(field.id)}
          >
            <Copy className="size-4" />
          </button>
          <button
            type="button"
            className="rounded-md p-1 text-muted transition-colors hover:bg-subtle hover:text-danger"
            aria-label={`Supprimer ${field.label}`}
            onClick={() => props.onRemove(field.id)}
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>
      {nested && (
        <div className="border-t border-border p-3 pl-6">
          <FieldList fields={field.fields as Field[]} container={field.id} props={props} />
        </div>
      )}
    </div>
  );
}

function FieldList({
  fields,
  container,
  props,
}: {
  fields: Field[];
  container: string;
  props: CanvasProps;
}) {
  return (
    <SortableContext
      id={container}
      items={fields.map((f) => f.id)}
      strategy={verticalListSortingStrategy}
    >
      <div className="space-y-2">
        {fields.map((field, index) => (
          <FieldCard
            key={field.id}
            field={field}
            container={container}
            index={index}
            props={props}
          />
        ))}
        <DropZone container={container} empty={fields.length === 0} />
      </div>
    </SortableContext>
  );
}

/** Formulaire en cours de conception : réordonnancement, sections et tableaux imbriqués. */
export function Canvas({ fields, ...props }: CanvasProps & { fields: Field[] }) {
  return <FieldList fields={fields} container={ROOT} props={props} />;
}
