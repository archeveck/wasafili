import { Checkbox } from './form-controls';

export interface ChecklistOption {
  value: string;
  label: string;
}

/**
 * Choix multiple compact (états, rôles, champs). Une liste vide vaut `undefined` : la règle
 * correspondante ne s'applique pas (« tous »).
 */
export function Checklist({
  options,
  value,
  onChange,
  empty = 'Aucun choix possible',
  label,
}: {
  options: ChecklistOption[];
  value: readonly string[] | undefined;
  onChange: (next: string[] | undefined) => void;
  empty?: string;
  label: string;
}) {
  if (options.length === 0) return <p className="text-xs text-muted">{empty}</p>;
  const selected = new Set(value ?? []);
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-x-4 gap-y-2">
      {options.map((option) => (
        <label key={option.value} className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={selected.has(option.value)}
            onCheckedChange={(checked) => {
              const next = options
                .map((o) => o.value)
                .filter((v) => (v === option.value ? checked === true : selected.has(v)));
              onChange(next.length ? next : undefined);
            }}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
