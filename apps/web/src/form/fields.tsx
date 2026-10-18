import { useQuery } from '@tanstack/react-query';
import { type FieldProps, type FieldServices } from '@tesserax/form-renderer';
import {
  type FieldOfType,
  type FileRef,
  type GeoPoint,
  type SimpleField,
  type SubmissionData,
} from '@tesserax/form-schema';
import { LocateFixed, Star, Upload } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox, Input, Select, Switch, Textarea } from '@/components/ui/form-controls';
import { useToast } from '@/components/ui/toast';
import { cn, formatDate, formatDateTime } from '@/lib/utils';
import { FilePreview } from './files';
import { SignaturePad } from './signature-pad';

export interface WebFieldProps extends FieldProps {
  services: FieldServices;
  /** Valeurs de la portée courante (racine ou ligne) : cascade des référentiels. */
  scope: SubmissionData;
}

const toLocalInput = (iso: unknown) => {
  if (typeof iso !== 'string' || !iso) return '';
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

function ListInput({
  field,
  value,
  onChange,
  state,
  inputId,
  services,
  scope,
}: WebFieldProps & { field: FieldOfType<'list'> }) {
  const parentId = field.parentField ? (scope[field.parentField] as string | undefined) : undefined;
  const waitingParent = Boolean(field.parentField && !parentId);
  const items = useQuery({
    queryKey: ['list-items', field.listId, parentId ?? null, field.level ?? null],
    queryFn: () =>
      services.listItems!(field.listId, {
        ...(parentId ? { parentId } : field.level === 0 ? { parentId: 'root' } : {}),
        ...(field.level !== undefined ? { level: field.level } : {}),
      }),
    enabled: !!services.listItems && !waitingParent,
    staleTime: 60_000,
  });
  return (
    <Select
      id={inputId}
      value={(value as string) ?? ''}
      disabled={state.readOnly || waitingParent}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value="">{waitingParent ? 'Choisir d’abord le niveau parent' : '— Choisir —'}</option>
      {(items.data ?? []).map((item) => (
        <option key={item.id} value={item.id}>
          {item.code ? `${item.label} (${item.code})` : item.label}
        </option>
      ))}
    </Select>
  );
}

function UserInput({
  field,
  value,
  onChange,
  state,
  inputId,
  services,
}: WebFieldProps & { field: FieldOfType<'user'> }) {
  const users = useQuery({
    queryKey: ['users-options'],
    queryFn: services.users!,
    enabled: !!services.users,
  });
  if (field.multiple) {
    const selected = new Set((value as string[] | null) ?? []);
    return (
      <div className="space-y-1">
        {(users.data ?? []).map((user) => (
          <label key={user.id} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={selected.has(user.id)}
              disabled={state.readOnly}
              onCheckedChange={(checked) => {
                const next = new Set(selected);
                if (checked) next.add(user.id);
                else next.delete(user.id);
                onChange([...next]);
              }}
            />
            {user.label}
          </label>
        ))}
      </div>
    );
  }
  return (
    <Select
      id={inputId}
      value={(value as string) ?? ''}
      disabled={state.readOnly}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">— Choisir —</option>
      {(users.data ?? []).map((user) => (
        <option key={user.id} value={user.id}>
          {user.label}
        </option>
      ))}
    </Select>
  );
}

function FilesInput({
  field,
  value,
  onChange,
  state,
  inputId,
  services,
}: WebFieldProps & { field: FieldOfType<'photo' | 'file'> }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const files = (value as FileRef[] | null) ?? [];
  const max = field.maxCount ?? (field.type === 'photo' ? 10 : 5);
  const accept = field.type === 'photo' ? 'image/*' : field.accept?.join(',');
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {files.map((file, index) => (
          <FilePreview
            key={file.fileId}
            file={file}
            services={services}
            {...(!state.readOnly && {
              onRemove: () => onChange(files.filter((_, i) => i !== index)),
            })}
          />
        ))}
      </div>
      {!state.readOnly && files.length < max && services.uploadFile && (
        <label
          className={cn(
            'inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-sm hover:bg-subtle',
            busy && 'opacity-50',
          )}
        >
          <Upload className="size-4" />
          {busy ? 'Envoi…' : field.type === 'photo' ? 'Ajouter des photos' : 'Ajouter un fichier'}
          <input
            id={inputId}
            type="file"
            className="sr-only"
            multiple
            accept={accept}
            disabled={busy}
            onChange={async (event) => {
              const selected = [...(event.target.files ?? [])].slice(0, max - files.length);
              event.target.value = '';
              setBusy(true);
              try {
                const uploaded = await Promise.all(
                  selected.map((file) => services.uploadFile!(file)),
                );
                onChange([
                  ...files,
                  ...uploaded.map((file) => ({
                    fileId: file.id,
                    name: file.name,
                    mimeType: file.mimeType,
                    size: file.size,
                  })),
                ]);
              } catch (error) {
                toast.error(error);
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
      )}
    </div>
  );
}

function SignatureInput({ value, onChange, state, services }: WebFieldProps) {
  const toast = useToast();
  const signature = value as FileRef | null;
  if (signature) {
    return (
      <div className="flex items-end gap-3">
        <FilePreview file={{ ...signature, mimeType: 'image/png' }} services={services} />
        {!state.readOnly && (
          <Button size="sm" variant="outline" onClick={() => onChange(null)}>
            Signer à nouveau
          </Button>
        )}
      </div>
    );
  }
  return (
    <SignaturePad
      disabled={state.readOnly || !services.uploadFile}
      onSave={async (png) => {
        try {
          const file = await services.uploadFile!(
            new File([png], 'signature.png', { type: 'image/png' }),
          );
          onChange({ fileId: file.id, name: file.name, mimeType: file.mimeType, size: file.size });
        } catch (error) {
          toast.error(error);
        }
      }}
    />
  );
}

function GeolocationInput({
  field,
  value,
  onChange,
  state,
}: WebFieldProps & { field: FieldOfType<'geolocation'> }) {
  const toast = useToast();
  const point = value as GeoPoint | null;
  const manual = (key: 'lat' | 'lng', raw: string) => {
    const number = raw === '' ? undefined : Number(raw);
    const next = {
      lat: point?.lat ?? 0,
      lng: point?.lng ?? 0,
      source: 'manual' as const,
      [key]: number,
    };
    onChange(number === undefined && !point ? null : next);
  };
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Input
          aria-label="Latitude"
          type="number"
          step="any"
          placeholder="Latitude"
          value={point?.lat ?? ''}
          disabled={state.readOnly || field.allowManual === false}
          onChange={(e) => manual('lat', e.target.value)}
        />
        <Input
          aria-label="Longitude"
          type="number"
          step="any"
          placeholder="Longitude"
          value={point?.lng ?? ''}
          disabled={state.readOnly || field.allowManual === false}
          onChange={(e) => manual('lng', e.target.value)}
        />
      </div>
      <div className="flex items-center gap-3">
        {!state.readOnly && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              navigator.geolocation.getCurrentPosition(
                (position) =>
                  onChange({
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    source: 'gps',
                    capturedAt: new Date().toISOString(),
                  }),
                () => toast.error(new Error('Position indisponible')),
                { enableHighAccuracy: true, timeout: 15_000 },
              )
            }
          >
            <LocateFixed /> Ma position
          </Button>
        )}
        {point?.accuracy !== undefined && (
          <span className="text-xs text-muted">Précision : {Math.round(point.accuracy)} m</span>
        )}
      </div>
    </div>
  );
}

/** Nom de l'utilisateur (auteur, champ utilisateur en lecture). */
function UserName({ id, services }: { id: string; services: FieldServices }) {
  const users = useQuery({
    queryKey: ['users-options'],
    queryFn: services.users!,
    enabled: !!services.users,
  });
  return <>{users.data?.find((user) => user.id === id)?.label ?? 'Utilisateur'}</>;
}

function ReadOnlyValue({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-9 rounded-md border border-border bg-subtle px-3 py-2 text-sm">
      {children ?? <span className="text-muted">—</span>}
    </div>
  );
}

/** Contrôle d'un champ simple, choisi selon son type (P2.2.2). */
export function FieldInput(props: WebFieldProps) {
  const { field, value, onChange, state, inputId, errors } = props;
  const invalid = errors.length > 0 || undefined;
  const common = { id: inputId, disabled: state.readOnly, 'aria-invalid': invalid };
  const text = (value as string | null) ?? '';

  switch (field.type) {
    case 'text':
    case 'email':
    case 'phone':
    case 'barcode':
      return (
        <Input
          {...common}
          type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
          value={text}
          placeholder={field.type === 'text' ? field.placeholder : undefined}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        />
      );
    case 'textarea':
      return (
        <Textarea
          {...common}
          value={text}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        />
      );
    case 'number':
      return (
        <div className="flex items-center gap-2">
          <Input
            {...common}
            type="number"
            step={field.decimals === 0 ? 1 : 'any'}
            min={field.min}
            max={field.max}
            value={(value as number | null) ?? ''}
            onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          />
          {field.unit && <span className="text-sm text-muted">{field.unit}</span>}
        </div>
      );
    case 'slider':
      return (
        <div className="flex items-center gap-3">
          <input
            {...common}
            type="range"
            className="flex-1 accent-[var(--color-primary)]"
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            value={(value as number | null) ?? field.min}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          <span className="w-16 text-right text-sm tabular-nums">
            {value === null || value === undefined
              ? '—'
              : `${value as number}${field.unit ? ` ${field.unit}` : ''}`}
          </span>
        </div>
      );
    case 'rating': {
      const max = field.max ?? 5;
      return (
        <div className="flex gap-1" role="radiogroup" aria-labelledby={`${inputId}-label`}>
          {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={value === n}
              aria-label={`${n} sur ${max}`}
              disabled={state.readOnly}
              onClick={() => onChange(value === n ? null : n)}
            >
              <Star
                className={cn(
                  'size-6',
                  (value as number) >= n ? 'fill-accent text-accent' : 'text-border',
                )}
              />
            </button>
          ))}
        </div>
      );
    }
    case 'date':
      return (
        <Input
          {...common}
          type="date"
          min={field.min}
          max={field.max}
          value={text}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    case 'time':
      return (
        <Input
          {...common}
          type="time"
          value={text}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    case 'datetime':
      return (
        <Input
          {...common}
          type="datetime-local"
          value={toLocalInput(value)}
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
        />
      );
    case 'boolean':
      return field.display === 'checkbox' ? (
        <Checkbox
          id={inputId}
          checked={value === true}
          disabled={state.readOnly}
          onCheckedChange={(c) => onChange(c === true)}
        />
      ) : (
        <Switch
          id={inputId}
          checked={value === true}
          disabled={state.readOnly}
          onCheckedChange={(c) => onChange(c)}
        />
      );
    case 'select':
      if (field.display === 'buttons' || field.display === 'radio') {
        return (
          <div className="flex flex-wrap gap-2" role="radiogroup">
            {field.options.map((option) => {
              const active = value === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={state.readOnly}
                  onClick={() => onChange(active ? null : option.value)}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-sm',
                    active ? 'font-medium text-white' : 'border-border bg-surface hover:bg-subtle',
                  )}
                  style={
                    active
                      ? {
                          backgroundColor: option.color ?? 'var(--color-primary)',
                          borderColor: option.color ?? 'var(--color-primary)',
                        }
                      : undefined
                  }
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        );
      }
      return (
        <Select {...common} value={text} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">— Choisir —</option>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      );
    case 'multiselect': {
      const selected = new Set((value as string[] | null) ?? []);
      return (
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {field.options.map((option) => (
            <label key={option.value} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={selected.has(option.value)}
                disabled={state.readOnly}
                onCheckedChange={(checked) => {
                  const next = new Set(selected);
                  if (checked) next.add(option.value);
                  else next.delete(option.value);
                  onChange(
                    next.size ? field.options.map((o) => o.value).filter((v) => next.has(v)) : null,
                  );
                }}
              />
              {option.label}
            </label>
          ))}
        </div>
      );
    }
    case 'list':
      return <ListInput {...props} field={field} />;
    case 'user':
      return <UserInput {...props} field={field} />;
    case 'relation':
      // Version web simplifiée : identifiant de la fiche liée (sélecteur de fiches en P2.5).
      return (
        <Input
          {...common}
          placeholder="Identifiant de la fiche liée"
          value={Array.isArray(value) ? value.join(', ') : text}
          onChange={(e) =>
            onChange(
              e.target.value
                ? field.multiple
                  ? e.target.value.split(',').map((v) => v.trim())
                  : e.target.value
                : null,
            )
          }
        />
      );
    case 'photo':
    case 'file':
      return <FilesInput {...props} field={field} />;
    case 'signature':
      return <SignatureInput {...props} />;
    case 'geolocation':
      return <GeolocationInput {...props} field={field} />;
    case 'calculated':
      return (
        <ReadOnlyValue>
          {value === null || value === undefined
            ? null
            : field.resultType === 'boolean'
              ? value
                ? 'Oui'
                : 'Non'
              : field.resultType === 'number'
                ? new Intl.NumberFormat('fr-FR').format(value as number)
                : field.resultType === 'date'
                  ? formatDate(value as string)
                  : String(value)}
        </ReadOnlyValue>
      );
    case 'timestamp':
      return (
        <ReadOnlyValue>
          {value ? formatDateTime(value as string) : 'Renseigné à l’enregistrement'}
        </ReadOnlyValue>
      );
    case 'author':
      return (
        <ReadOnlyValue>
          {value ? (
            <UserName id={String(value)} services={props.services} />
          ) : (
            'Renseigné à l’enregistrement'
          )}
        </ReadOnlyValue>
      );
    case 'info':
      return <p className="whitespace-pre-line text-sm text-muted">{field.content}</p>;
    case 'hidden':
      return null;
  }
}

export type { SimpleField };
