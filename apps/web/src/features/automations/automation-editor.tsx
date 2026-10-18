import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import {
  COMPUTED_TYPES,
  type Field,
  type JsonLogic,
  rootValueFields,
  type StructureDefinition,
} from '@tesserax/form-schema';
import {
  ApiError,
  type AutomationAction,
  type AutomationInput,
  type AutomationTrigger,
  type Recipient,
} from '@tesserax/sdk';
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checklist } from '@/components/ui/checklist';
import { Card, ErrorMessage, Loading, PageHeader } from '@/components/ui/display';
import { Checkbox, FormRow, Input, Select, Switch, Textarea } from '@/components/ui/form-controls';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/overlays';
import { useToast } from '@/components/ui/toast';
import { useApp } from '@/lib/use-app';
import { ConditionEditor } from '../designer/condition-editor';

export const ACTION_LABELS: Record<AutomationAction['type'], string> = {
  email: 'Envoyer un e-mail',
  notify: 'Notifier des utilisateurs',
  create_task: 'Créer une tâche',
  webhook: 'Appeler un webhook',
  update_field: 'Modifier un champ',
};

export const TRIGGER_LABELS: Record<AutomationTrigger['type'], string> = {
  submission_created: 'Fiche créée',
  state_changed: "Changement d'état",
  field_changed: 'Champ modifié',
  schedule: 'Planifié',
};

const CRON_PRESETS = [
  { cron: '0 8 * * *', label: 'Chaque jour à 8 h' },
  { cron: '0 8 * * 1', label: 'Chaque lundi à 8 h' },
  { cron: '0 8 1 * *', label: 'Le 1er du mois à 8 h' },
];

function newAction(type: AutomationAction['type'], scheduled: boolean): AutomationAction {
  switch (type) {
    case 'email':
      return {
        type,
        to: scheduled ? [] : [{ type: 'author' }],
        subject: '{{_formulaire}} : {{_etat}}',
        body: 'Bonjour,\n\nLa fiche est passée à l’état « {{_etat}} ».',
      };
    case 'notify':
      return {
        type,
        to: scheduled ? [] : [{ type: 'author' }],
        title: '{{_formulaire}} : {{_etat}}',
      };
    case 'create_task':
      return {
        type,
        title: 'Suivi : {{_formulaire}}',
        assignee: scheduled ? { type: 'none' } : { type: 'author' },
        startInDays: 1,
        startTime: '08:00',
        durationMinutes: 60,
        copyFields: false,
      };
    case 'webhook':
      return { type, webhookId: '' };
    case 'update_field':
      return { type, field: '', value: null };
  }
}

const EMPTY: AutomationInput = {
  name: '',
  enabled: true,
  structureId: null,
  trigger: { type: 'state_changed', to: [] },
  conditions: null,
  actions: [],
};

interface Directory {
  users: { value: string; label: string }[];
  groups: { value: string; label: string }[];
  fields: Field[];
}

function RecipientsEditor({
  value,
  onChange,
  directory,
  kind,
  scheduled,
  idPrefix,
}: {
  value: Recipient[];
  onChange: (next: Recipient[]) => void;
  directory: Directory;
  kind: 'email' | 'notify';
  scheduled: boolean;
  idPrefix: string;
}) {
  const [address, setAddress] = useState('');
  const label = (r: Recipient) => {
    switch (r.type) {
      case 'author':
        return 'Auteur de la fiche';
      case 'address':
        return r.email;
      case 'field':
        return `Champ « ${directory.fields.find((f) => f.key === r.field)?.label ?? r.field} »`;
      case 'user':
        return directory.users.find((u) => u.value === r.userId)?.label ?? 'Utilisateur';
      case 'group':
        return `Groupe ${directory.groups.find((g) => g.value === r.groupId)?.label ?? ''}`;
    }
  };
  const add = (r: Recipient) => {
    if (!value.some((v) => JSON.stringify(v) === JSON.stringify(r))) onChange([...value, r]);
  };
  const emailFields = directory.fields.filter((f) => f.type === 'email');
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {value.length === 0 && <span className="text-xs text-muted">Aucun destinataire</span>}
        {value.map((r, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-subtle px-2 py-0.5 text-xs"
          >
            {label(r)}
            <button
              type="button"
              aria-label={`Retirer ${label(r)}`}
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {!scheduled && (
          <Button type="button" size="sm" variant="outline" onClick={() => add({ type: 'author' })}>
            Auteur
          </Button>
        )}
        <Select
          aria-label="Ajouter un utilisateur"
          className="h-8 w-auto text-xs"
          value=""
          onChange={(e) => e.target.value && add({ type: 'user', userId: e.target.value })}
        >
          <option value="">+ Utilisateur…</option>
          {directory.users.map((u) => (
            <option key={u.value} value={u.value}>
              {u.label}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Ajouter un groupe"
          className="h-8 w-auto text-xs"
          value=""
          onChange={(e) => e.target.value && add({ type: 'group', groupId: e.target.value })}
        >
          <option value="">+ Groupe…</option>
          {directory.groups.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </Select>
        {kind === 'email' && !scheduled && emailFields.length > 0 && (
          <Select
            aria-label="Ajouter un champ e-mail"
            className="h-8 w-auto text-xs"
            value=""
            onChange={(e) => e.target.value && add({ type: 'field', field: e.target.value })}
          >
            <option value="">+ Champ e-mail…</option>
            {emailFields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </Select>
        )}
        {kind === 'email' && (
          <form
            className="flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (/^\S+@\S+\.\S+$/.test(address)) {
                add({ type: 'address', email: address.trim() });
                setAddress('');
              }
            }}
          >
            <Input
              id={`${idPrefix}-address`}
              aria-label="Adresse e-mail"
              placeholder="adresse@exemple.ci"
              className="h-8 w-48 text-xs"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
            <Button type="submit" size="sm" variant="outline">
              Ajouter
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

/** Saisie d'une valeur fixe selon le type du champ (action « Modifier un champ »). */
function ValueInput({
  field,
  value,
  onChange,
  id,
}: {
  field: Field | undefined;
  value: unknown;
  onChange: (value: unknown) => void;
  id: string;
}) {
  if (!field) return <Input id={id} disabled placeholder="Choisissez un champ" />;
  switch (field.type) {
    case 'select':
      return (
        <Select
          id={id}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">(vide)</option>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      );
    case 'boolean':
      return (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            id={id}
            checked={value === true}
            onCheckedChange={(c) => onChange(c === true)}
          />
          Oui
        </label>
      );
    case 'number':
    case 'rating':
    case 'slider':
      return (
        <Input
          id={id}
          type="number"
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      );
    case 'date':
      return (
        <Input
          id={id}
          type="date"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    default:
      return (
        <Input
          id={id}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
  }
}

function ActionForm({
  action,
  index,
  onChange,
  directory,
  scheduled,
  reports,
  webhooks,
  structures,
  error,
}: {
  action: AutomationAction;
  index: number;
  onChange: (action: AutomationAction) => void;
  directory: Directory;
  scheduled: boolean;
  reports: { value: string; label: string }[];
  webhooks: { value: string; label: string }[];
  structures: { value: string; label: string }[];
  error: (path: string) => string | undefined;
}) {
  const id = `action-${index}`;
  const at = (suffix: string) => error(`actions.${index}${suffix}`);
  const tags = 'Balises : {{champ}}, {{_etat}}, {{_auteur}}, {{_lien}}…';
  switch (action.type) {
    case 'email':
      return (
        <div className="space-y-3">
          <FormRow label="Destinataires" error={at('.to') ?? error(`actions.${index}.to.0`)}>
            <RecipientsEditor
              idPrefix={id}
              kind="email"
              scheduled={scheduled}
              directory={directory}
              value={action.to}
              onChange={(to) => onChange({ ...action, to })}
            />
          </FormRow>
          <FormRow label="Sujet" htmlFor={`${id}-subject`} help={tags}>
            <Input
              id={`${id}-subject`}
              value={action.subject}
              onChange={(e) => onChange({ ...action, subject: e.target.value })}
            />
          </FormRow>
          <FormRow label="Message" htmlFor={`${id}-body`}>
            <Textarea
              id={`${id}-body`}
              rows={5}
              value={action.body}
              onChange={(e) => onChange({ ...action, body: e.target.value })}
            />
          </FormRow>
          {!scheduled && (
            <FormRow
              label="Joindre le rapport PDF"
              htmlFor={`${id}-report`}
              error={at('.reportId')}
            >
              <Select
                id={`${id}-report`}
                value={action.reportId ?? ''}
                onChange={(e) => {
                  const { reportId: _r, ...rest } = action;
                  onChange(e.target.value ? { ...rest, reportId: e.target.value } : rest);
                }}
              >
                <option value="">Aucun</option>
                {reports.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </FormRow>
          )}
        </div>
      );
    case 'notify':
      return (
        <div className="space-y-3">
          <FormRow label="Destinataires" error={at('.to') ?? error(`actions.${index}.to.0`)}>
            <RecipientsEditor
              idPrefix={id}
              kind="notify"
              scheduled={scheduled}
              directory={directory}
              value={action.to}
              onChange={(to) => onChange({ ...action, to })}
            />
          </FormRow>
          <FormRow label="Titre" htmlFor={`${id}-title`} help={tags}>
            <Input
              id={`${id}-title`}
              value={action.title}
              onChange={(e) => onChange({ ...action, title: e.target.value })}
            />
          </FormRow>
          <FormRow label="Texte" htmlFor={`${id}-body`}>
            <Input
              id={`${id}-body`}
              value={action.body ?? ''}
              onChange={(e) => {
                const { body: _b, ...rest } = action;
                onChange(e.target.value ? { ...rest, body: e.target.value } : rest);
              }}
            />
          </FormRow>
        </div>
      );
    case 'create_task': {
      const assignee =
        action.assignee.type === 'user'
          ? `user:${action.assignee.userId}`
          : action.assignee.type === 'group'
            ? `group:${action.assignee.groupId}`
            : action.assignee.type;
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormRow label="Titre" htmlFor={`${id}-title`} help={tags} className="sm:col-span-2">
            <Input
              id={`${id}-title`}
              value={action.title}
              onChange={(e) => onChange({ ...action, title: e.target.value })}
            />
          </FormRow>
          <FormRow
            label="Formulaire à remplir"
            htmlFor={`${id}-structure`}
            error={at('.structureId')}
          >
            <Select
              id={`${id}-structure`}
              value={action.structureId ?? ''}
              onChange={(e) => {
                const { structureId: _s, ...rest } = action;
                onChange(e.target.value ? { ...rest, structureId: e.target.value } : rest);
              }}
            >
              {!scheduled && <option value="">Celui de la fiche</option>}
              {scheduled && <option value="">Choisir…</option>}
              {structures.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </FormRow>
          <FormRow label="Assignée à" htmlFor={`${id}-assignee`} error={at('.assignee')}>
            <Select
              id={`${id}-assignee`}
              value={assignee}
              onChange={(e) => {
                const [kind, ref] = e.target.value.split(':');
                onChange({
                  ...action,
                  assignee:
                    kind === 'user'
                      ? { type: 'user', userId: ref! }
                      : kind === 'group'
                        ? { type: 'group', groupId: ref! }
                        : { type: kind as 'none' | 'author' },
                });
              }}
            >
              <option value="none">Personne</option>
              {!scheduled && <option value="author">Auteur de la fiche</option>}
              {directory.users.map((u) => (
                <option key={u.value} value={`user:${u.value}`}>
                  {u.label}
                </option>
              ))}
              {directory.groups.map((g) => (
                <option key={g.value} value={`group:${g.value}`}>
                  Groupe {g.label}
                </option>
              ))}
            </Select>
          </FormRow>
          <FormRow label="Dans (jours)" htmlFor={`${id}-days`}>
            <Input
              id={`${id}-days`}
              type="number"
              min={0}
              max={365}
              value={action.startInDays}
              onChange={(e) => onChange({ ...action, startInDays: Number(e.target.value) })}
            />
          </FormRow>
          <div className="grid grid-cols-2 gap-2">
            <FormRow label="À" htmlFor={`${id}-time`}>
              <Input
                id={`${id}-time`}
                type="time"
                value={action.startTime}
                onChange={(e) => onChange({ ...action, startTime: e.target.value })}
              />
            </FormRow>
            <FormRow label="Durée (min)" htmlFor={`${id}-duration`}>
              <Input
                id={`${id}-duration`}
                type="number"
                min={15}
                step={15}
                value={action.durationMinutes}
                onChange={(e) => onChange({ ...action, durationMinutes: Number(e.target.value) })}
              />
            </FormRow>
          </div>
          {!scheduled && (
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Checkbox
                checked={action.copyFields}
                onCheckedChange={(c) => onChange({ ...action, copyFields: c === true })}
              />
              Pré-remplir avec les champs identiques de la fiche (site, équipement…)
            </label>
          )}
        </div>
      );
    }
    case 'webhook':
      return (
        <FormRow label="Webhook" htmlFor={`${id}-webhook`} error={at('.webhookId')}>
          <Select
            id={`${id}-webhook`}
            value={action.webhookId}
            onChange={(e) => onChange({ ...action, webhookId: e.target.value })}
          >
            <option value="">Choisir…</option>
            {webhooks.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </Select>
        </FormRow>
      );
    case 'update_field': {
      const settable = directory.fields.filter(
        (f) =>
          !COMPUTED_TYPES.has(f.type) &&
          !['table', 'photo', 'file', 'signature', 'geolocation'].includes(f.type),
      );
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormRow label="Champ" htmlFor={`${id}-field`} error={at('.field')}>
            <Select
              id={`${id}-field`}
              value={action.field}
              onChange={(e) => onChange({ ...action, field: e.target.value, value: null })}
            >
              <option value="">Choisir…</option>
              {settable.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </Select>
          </FormRow>
          <FormRow label="Nouvelle valeur" htmlFor={`${id}-value`} error={at('.value')}>
            <ValueInput
              id={`${id}-value`}
              field={settable.find((f) => f.key === action.field)}
              value={action.value}
              onChange={(value) => onChange({ ...action, value })}
            />
          </FormRow>
        </div>
      );
    }
  }
}

/** Création et modification d'une automatisation (P5.3.6). */
export function AutomationEditorPage() {
  const { automationId } = useParams({ strict: false }) as { automationId: string };
  const isNew = automationId === 'nouvelle';
  const { api, short, can } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<AutomationInput>(EMPTY);
  const [problems, setProblems] = useState<{ path: string; message: string }[]>([]);

  const existing = useQuery({
    queryKey: [short, 'automation', automationId],
    queryFn: () => api.automations.get(automationId),
    enabled: !isNew,
  });
  useEffect(() => {
    if (existing.data) {
      const { name, enabled, structureId, trigger, conditions, actions } = existing.data;
      setDraft({ name, enabled, structureId, trigger, conditions, actions });
    }
  }, [existing.data]);

  const structures = useQuery({
    queryKey: [short, 'structures', 'published'],
    queryFn: () => api.structures.list({ perPage: 100 }),
  });
  const version = useQuery({
    queryKey: [short, 'version', draft.structureId, 'current'],
    queryFn: () => api.structures.version(draft.structureId!, 'current'),
    enabled: !!draft.structureId,
  });
  const reports = useQuery({
    queryKey: [short, 'reports', draft.structureId],
    queryFn: () => api.reports.list(draft.structureId!),
    enabled: !!draft.structureId,
  });
  const webhooks = useQuery({ queryKey: [short, 'webhooks'], queryFn: api.webhooks.list });
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

  const definition = version.data?.definition as StructureDefinition | undefined;
  const fields = definition ? rootValueFields(definition.fields) : [];
  const directory: Directory = {
    users: (users.data?.data ?? []).map((u) => ({
      value: u.id,
      label: `${u.firstName} ${u.lastName}`,
    })),
    groups: (groups.data?.data ?? []).map((g) => ({ value: g.id, label: g.name })),
    fields,
  };
  const scheduled = draft.trigger.type === 'schedule';
  const set = (patch: Partial<AutomationInput>) => setDraft((d) => ({ ...d, ...patch }));
  const setAction = (index: number, action: AutomationAction) =>
    set({ actions: draft.actions.map((a, i) => (i === index ? action : a)) });
  const move = (index: number, delta: number) => {
    const next = [...draft.actions];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item!);
    set({ actions: next });
  };
  const error = (path: string) => problems.find((p) => p.path === path)?.message;

  const save = useMutation({
    mutationFn: () => {
      const body: AutomationInput = {
        ...draft,
        name: draft.name.trim(),
        conditions: scheduled ? null : draft.conditions,
      };
      return isNew ? api.automations.create(body) : api.automations.update(automationId, body);
    },
    onSuccess: async () => {
      setProblems([]);
      toast.success('Automatisation enregistrée');
      await queryClient.invalidateQueries({ queryKey: [short, 'automations'] });
      await navigate({ to: '/$app/automations', params: { app: short } });
    },
    onError: (err) => {
      if (err instanceof ApiError && Array.isArray(err.details)) {
        setProblems(err.details as { path: string; message: string }[]);
      }
      toast.error(err);
    },
  });

  if (!isNew && existing.isPending) return <Loading />;
  if (existing.error) return <ErrorMessage error={existing.error} />;
  const published = (structures.data?.data ?? []).filter((s) => s.currentVersion);
  const states = definition?.workflow?.states ?? [];

  return (
    <>
      <PageHeader
        title={isNew ? 'Nouvelle automatisation' : draft.name || 'Automatisation'}
        description="Quand… si… alors : les actions s'exécutent dans l'ordre, côté serveur."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => void navigate({ to: '/$app/automations', params: { app: short } })}
            >
              Annuler
            </Button>
            <Button
              disabled={!draft.name.trim() || draft.actions.length === 0 || save.isPending}
              onClick={() => save.mutate()}
            >
              Enregistrer
            </Button>
          </>
        }
      />
      {problems.length > 0 && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-danger/40 bg-danger/5 p-3 text-sm"
        >
          <p className="font-medium text-danger">À corriger avant d'enregistrer :</p>
          <ul className="list-disc pl-5">
            {problems.map((p) => (
              <li key={p.path + p.message}>{p.message}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="max-w-3xl space-y-4">
        <Card className="grid gap-4 p-4 sm:grid-cols-2">
          <FormRow label="Nom" htmlFor="automation-name" required>
            <Input
              id="automation-name"
              value={draft.name}
              maxLength={200}
              onChange={(e) => set({ name: e.target.value })}
            />
          </FormRow>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <Switch checked={draft.enabled} onCheckedChange={(enabled) => set({ enabled })} />
            Active
          </label>
        </Card>

        <Card className="space-y-4 p-4">
          <p className="font-medium">Quand</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormRow label="Déclencheur" htmlFor="automation-trigger">
              <Select
                id="automation-trigger"
                value={draft.trigger.type}
                onChange={(e) => {
                  const type = e.target.value as AutomationTrigger['type'];
                  set({
                    trigger:
                      type === 'state_changed'
                        ? { type, to: [] }
                        : type === 'field_changed'
                          ? { type, fields: [] }
                          : type === 'schedule'
                            ? { type, cron: '0 8 * * 1' }
                            : { type },
                  });
                }}
              >
                {Object.entries(TRIGGER_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </FormRow>
            <FormRow
              label={scheduled ? 'Formulaire (facultatif)' : 'Formulaire surveillé'}
              htmlFor="automation-structure"
              required={!scheduled}
              error={error('structureId')}
            >
              <Select
                id="automation-structure"
                value={draft.structureId ?? ''}
                onChange={(e) => set({ structureId: e.target.value || null, conditions: null })}
              >
                <option value="">Choisir…</option>
                {published.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </FormRow>
          </div>
          {draft.trigger.type === 'state_changed' && (
            <FormRow label="Vers l'état (aucun coché = tout changement)" error={error('trigger')}>
              <Checklist
                label="États"
                empty={
                  draft.structureId
                    ? 'Ce formulaire n’a pas de workflow'
                    : 'Choisissez un formulaire'
                }
                options={states.map((s) => ({ value: s.key, label: s.label }))}
                value={draft.trigger.to}
                onChange={(to) => set({ trigger: { type: 'state_changed', to: to ?? [] } })}
              />
            </FormRow>
          )}
          {draft.trigger.type === 'field_changed' && (
            <FormRow label="Quand l'un de ces champs change">
              <Checklist
                label="Champs"
                empty="Choisissez un formulaire"
                options={fields.map((f) => ({ value: f.key, label: f.label }))}
                value={draft.trigger.fields}
                onChange={(next) => set({ trigger: { type: 'field_changed', fields: next ?? [] } })}
              />
            </FormRow>
          )}
          {draft.trigger.type === 'schedule' && (
            <FormRow
              label="Fréquence (cron, fuseau de l'instance)"
              htmlFor="automation-cron"
              help="minute heure jour mois jour-de-semaine — ex. 0 8 * * 1 : chaque lundi à 8 h"
            >
              <div className="flex flex-wrap gap-2">
                <Input
                  id="automation-cron"
                  className="w-40 font-mono"
                  value={draft.trigger.cron}
                  onChange={(e) => set({ trigger: { type: 'schedule', cron: e.target.value } })}
                />
                {CRON_PRESETS.map((p) => (
                  <Button
                    key={p.cron}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => set({ trigger: { type: 'schedule', cron: p.cron } })}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </FormRow>
          )}
        </Card>

        {!scheduled && (
          <Card className="space-y-2 p-4">
            <p className="font-medium">Si (facultatif)</p>
            {definition ? (
              <ConditionEditor
                idPrefix="automation-condition"
                value={(draft.conditions ?? undefined) as Record<string, JsonLogic> | undefined}
                onChange={(logic) =>
                  set({ conditions: (logic as Record<string, unknown>) ?? null })
                }
                targets={fields.map((f) => ({ variable: f.key, label: f.label, field: f }))}
              />
            ) : (
              <p className="text-sm text-muted">Choisissez un formulaire publié.</p>
            )}
          </Card>
        )}

        <Card className="space-y-3 p-4">
          <p className="font-medium">Alors</p>
          {draft.actions.length === 0 && (
            <p className="text-sm text-muted">Ajoutez au moins une action.</p>
          )}
          {draft.actions.map((action, index) => (
            <div key={index} className="space-y-3 rounded-md border border-border p-3">
              <div className="flex items-center gap-1">
                <span className="text-sm font-medium">
                  {index + 1}. {ACTION_LABELS[action.type]}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="ml-auto"
                  aria-label="Monter"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Descendre"
                  disabled={index === draft.actions.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-danger"
                  aria-label={`Retirer l'action ${index + 1}`}
                  onClick={() => set({ actions: draft.actions.filter((_, i) => i !== index) })}
                >
                  <Trash2 />
                </Button>
              </div>
              {error(`actions.${index}`) && (
                <p className="text-xs text-danger">{error(`actions.${index}`)}</p>
              )}
              <ActionForm
                action={action}
                index={index}
                onChange={(next) => setAction(index, next)}
                directory={directory}
                scheduled={scheduled}
                reports={(reports.data?.data ?? []).map((r) => ({ value: r.id, label: r.name }))}
                webhooks={(webhooks.data?.data ?? []).map((w) => ({ value: w.id, label: w.name }))}
                structures={published.map((s) => ({ value: s.id, label: s.name }))}
                error={error}
              />
            </div>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Plus /> Ajouter une action
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {(Object.keys(ACTION_LABELS) as AutomationAction['type'][])
                .filter((type) => !(scheduled && type === 'update_field'))
                .map((type) => (
                  <DropdownMenuItem
                    key={type}
                    onSelect={() =>
                      set({ actions: [...draft.actions, newAction(type, scheduled)] })
                    }
                  >
                    {ACTION_LABELS[type]}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </Card>
      </div>
    </>
  );
}
