import { useDraggable } from '@dnd-kit/core';
import { type FieldType } from '@tesserax/form-schema';
import { cn } from '@/lib/utils';
import { PALETTE } from './model';

function PaletteItem({
  type,
  label,
  onAdd,
}: {
  type: FieldType;
  label: string;
  onAdd: (type: FieldType) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette:${type}`,
    data: { kind: 'palette', type },
  });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      {...attributes}
      onClick={() => onAdd(type)}
      className={cn(
        'w-full cursor-grab rounded-md border border-border bg-surface px-2.5 py-1.5 text-left text-sm hover:border-primary hover:text-primary',
        isDragging && 'opacity-50',
      )}
      aria-label={`Ajouter : ${label}`}
    >
      {label}
    </button>
  );
}

/** Types de champs : glisser vers le formulaire, ou cliquer pour ajouter à la fin. */
export function Palette({ onAdd }: { onAdd: (type: FieldType) => void }) {
  const groups = [...new Set(PALETTE.map((entry) => entry.group))];
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group}>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{group}</p>
          <div className="space-y-1">
            {PALETTE.filter((entry) => entry.group === group).map((entry) => (
              <PaletteItem key={entry.type} type={entry.type} label={entry.label} onAdd={onAdd} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
