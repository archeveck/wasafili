import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { type Field } from '@tesserax/form-schema';
import { Calculator, Copy, Eye, GripVertical, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/display';
import { cn } from '@/lib/utils';
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
        'rounded-md border border-dashed text-center text-xs text-muted transition-colors',
        empty ? 'py-6' : 'py-2',
        isOver ? 'border-primary bg-primary/5 text-primary' : 'border-border',
      )}
    >
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
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'rounded-md border bg-surface',
        active ? 'border-primary ring-2 ring-primary/20' : 'border-border',
        props.invalid.has(field.key) && 'border-danger',
        isDragging && 'opacity-40',
        field.type === 'section' && 'bg-subtle/60',
      )}
      data-testid={`field-${field.key}`}
    >
      <div className="flex items-center gap-2 px-2 py-2">
        <button
          type="button"
          className="cursor-grab rounded p-1 text-muted hover:bg-subtle"
          aria-label={`Déplacer ${field.label}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => props.onSelect(field.id)}
        >
          <span className="block truncate font-medium">
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
            className="rounded p-1 text-muted hover:bg-subtle"
            aria-label={`Dupliquer ${field.label}`}
            onClick={() => props.onDuplicate(field.id)}
          >
            <Copy className="size-4" />
          </button>
          <button
            type="button"
            className="rounded p-1 text-muted hover:bg-subtle hover:text-danger"
            aria-label={`Supprimer ${field.label}`}
            onClick={() => props.onRemove(field.id)}
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>
      {nested && (
        <div className="border-t border-border p-2 pl-6">
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
