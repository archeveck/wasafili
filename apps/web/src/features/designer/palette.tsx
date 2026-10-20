import { useDraggable } from '@dnd-kit/core';
import { type FieldType } from '@wasafili/form-schema';
import { cn } from '@/lib/utils';
import { FIELD_ICONS } from './field-icons';
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
  const Icon = FIELD_ICONS[type];
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      {...attributes}
      onClick={() => onAdd(type)}
      className={cn(
        'group flex w-full cursor-grab items-center gap-2.5 rounded-md border border-transparent px-1.5 py-1 text-left text-sm text-foreground transition-colors hover:border-border hover:bg-surface hover:shadow-xs focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-accent/35 active:cursor-grabbing',
        isDragging && 'opacity-50',
      )}
      aria-label={`Ajouter : ${label}`}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-muted transition-colors group-hover:border-accent/30 group-hover:bg-accent/10 group-hover:text-accent">
        <Icon className="size-3.5" aria-hidden />
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

/** Types de champs : glisser vers le formulaire, ou cliquer pour ajouter à la fin. */
export function Palette({ onAdd }: { onAdd: (type: FieldType) => void }) {
  const groups = [...new Set(PALETTE.map((entry) => entry.group))];
  return (
    <div className="space-y-5">
      <p className="text-xs text-muted">
        Glissez un champ dans le formulaire, ou cliquez pour l’ajouter.
      </p>
      {groups.map((group) => (
        <div key={group}>
          <p className="mb-1.5 px-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
            {group}
          </p>
          <div className="space-y-0.5">
            {PALETTE.filter((entry) => entry.group === group).map((entry) => (
              <PaletteItem key={entry.type} type={entry.type} label={entry.label} onAdd={onAdd} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
