import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import {
  type Automation,
  type AutomationRun,
  type AutomationRunStatus,
  type EmailMessage,
  type Webhook,
  type WebhookEvent,
} from '@wasafili/sdk';
import { Copy, Pencil, Plus, RefreshCw, RotateCcw, Send, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checklist } from '@/components/ui/checklist';
import {
  Badge,
  Card,
  EmptyState,
  ErrorMessage,
  Loading,
  PageHeader,
  Table,
  Td,
  Th,
} from '@/components/ui/display';
import { FormRow, Input, Select, Switch } from '@/components/ui/form-controls';
import { Dialog, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlays';
import { useToast } from '@/components/ui/toast';
import { useApp } from '@/lib/use-app';
import { formatDateTime } from '@/lib/utils';
import { ACTION_LABELS, TRIGGER_LABELS } from './automation-editor';

export type AutomationsTab = 'automations' | 'runs' | 'webhooks' | 'emails';

const RUN_STATUS: Record<AutomationRunStatus, { label: string; color: string }> = {
  queued: { label: 'En attente', color: '#5B6470' },
  running: { label: 'En cours', color: '#1F4E79' },
  succeeded: { label: 'Réussie', color: '#2E8B57' },
  failed: { label: 'Échec', color: '#C4372D' },
  skipped: { label: 'Ignorée', color: '#D98A1B' },
};

const EMAIL_STATUS: Record<EmailMessage['status'], { label: string; color: string }> = {
  queued: { label: 'En file', color: '#5B6470' },
  sent: { label: 'Envoyé', color: '#2E8B57' },
  failed: { label: 'Échec', color: '#C4372D' },
};

const WEBHOOK_EVENTS: { value: WebhookEvent; label: string }[] = [
  { value: 'submission.created', label: 'Fiche créée' },
  { value: 'submission.updated', label: 'Fiche modifiée' },
  { value: 'submission.state_changed', label: "Changement d'état" },
  { value: 'submission.deleted', label: 'Fiche supprimée' },
];

const duration = (ms: number | null) =>
  ms === null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;

function triggerSummary(automation: Automation, structures: Map<string, string>) {
  const t = automation.trigger;
  const where = automation.structureId ? ` · ${structures.get(automation.structureId) ?? ''}` : '';
  if (t.type === 'schedule') return `Planifié (${t.cron})${where}`;
  if (t.type === 'state_changed' && t.to.length)
    return `${TRIGGER_LABELS[t.type]} → ${t.to.join(', ')}${where}`;
  if (t.type === 'field_changed')
    return `${TRIGGER_LABELS[t.type]} : ${t.fields.join(', ')}${where}`;
  return `${TRIGGER_LABELS[t.type]}${where}`;
}

function AutomationsList() {
  const { api, short, timeZone } = useApp();
  const toast = useToast();
  const queryClient = useQueryClient();
  const automations = useQuery({
    queryKey: [short, 'automations'],
    queryFn: () => api.automations.list(),
  });
  const structures = useQuery({
    queryKey: [short, 'structures', 'published'],
    queryFn: () => api.structures.list({ perPage: 100 }),
  });
  const names = new Map((structures.data?.data ?? []).map((s) => [s.id, s.name]));
  const invalidate = () => queryClient.invalidateQueries({ queryKey: [short, 'automations'] });
  const toggle = useMutation({
    mutationFn: (a: Automation) =>
      api.automations.update(a.id, {
        name: a.name,
        enabled: !a.enabled,
        structureId: a.structureId,
        trigger: a.trigger,
        conditions: a.conditions,
        actions: a.actions,
      }),
    onSuccess: invalidate,
    onError: toast.error,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.automations.remove(id),
    onSuccess: async () => {
      toast.success('Automatisation supprimée');
      await invalidate();
    },
    onError: toast.error,
  });

  if (automations.isPending) return <Loading />;
  if (automations.error) return <ErrorMessage error={automations.error} />;
  if (automations.data.data.length === 0) {
    return (
      <EmptyState title="Aucune automatisation">
        Exemple : à la validation d'une fiche, envoyer le rapport PDF par e-mail.
      </EmptyState>
    );
  }
  return (
    <Table>
      <thead>
        <tr>
          <Th>Nom</Th>
          <Th>Quand</Th>
          <Th>Actions</Th>
          <Th>Dernière exécution</Th>
          <Th>Active</Th>
          <Th className="w-0" />
        </tr>
      </thead>
      <tbody>
        {automations.data.data.map((a) => (
          <tr key={a.id}>
            <Td className="font-medium">
              <Link
                to="/$app/automations/$automationId"
                params={{ app: short, automationId: a.id }}
                className="text-primary hover:underline"
              >
                {a.name}
              </Link>
            </Td>
            <Td className="text-sm">{triggerSummary(a, names)}</Td>
            <Td className="text-sm text-muted">
              {a.actions.map((x) => ACTION_LABELS[x.type]).join(' → ')}
            </Td>
            <Td>
              {a.lastRun ? (
                <span className="flex items-center gap-2 text-xs">
                  <Badge color={RUN_STATUS[a.lastRun.status].color}>
                    {RUN_STATUS[a.lastRun.status].label}
                  </Badge>
                  {formatDateTime(a.lastRun.createdAt, timeZone)}
                </span>
              ) : (
                <span className="text-xs text-muted">Jamais</span>
              )}
            </Td>
            <Td>
              <Switch
                aria-label={`Activer ${a.name}`}
                checked={a.enabled}
                onCheckedChange={() => toggle.mutate(a)}
              />
            </Td>
            <Td className="whitespace-nowrap">
              <Button size="icon" variant="ghost" asChild aria-label={`Modifier ${a.name}`}>
                <Link
                  to="/$app/automations/$automationId"
                  params={{ app: short, automationId: a.id }}
                >
                  <Pencil />
                </Link>
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="text-danger"
                aria-label={`Supprimer ${a.name}`}
                onClick={() =>
                  confirm(`Supprimer « ${a.name} » ? Le journal reste consultable.`) &&
                  remove.mutate(a.id)
                }
              >
                <Trash2 />
              </Button>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function RunDetails({ run }: { run: AutomationRun }) {
  return (
    <ol className="space-y-1 text-xs">
      {run.steps.map((step, i) => (
        <li key={i} className="flex flex-wrap gap-2">
          <Badge color={step.status === 'done' ? '#2E8B57' : '#C4372D'}>
            {i + 1}. {ACTION_LABELS[step.type]}
          </Badge>
          <span className="text-muted">{duration(step.durationMs)}</span>
          {step.error && <span className="text-danger">{step.error}</span>}
        </li>
      ))}
    </ol>
  );
}

function RunsLog() {
  const { api, short, timeZone } = useApp();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AutomationRunStatus | ''>('');
  const runs = useQuery({
    queryKey: [short, 'automation-runs', status],
    queryFn: () => api.automations.runs({ perPage: 100, ...(status ? { status } : {}) }),
    refetchInterval: 5_000,
  });
  const retry = useMutation({
    mutationFn: (id: string) => api.automations.retry(id),
    onSuccess: async () => {
      toast.success('Exécution relancée');
      await queryClient.invalidateQueries({ queryKey: [short, 'automation-runs'] });
    },
    onError: toast.error,
  });
  return (
    <div className="space-y-3">
      <Select
        aria-label="Filtrer par statut"
        className="w-48"
        value={status}
        onChange={(e) => setStatus(e.target.value as AutomationRunStatus | '')}
      >
        <option value="">Tous les statuts</option>
        {Object.entries(RUN_STATUS).map(([value, { label }]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
      {runs.error && <ErrorMessage error={runs.error} />}
      {runs.isPending && <Loading />}
      {runs.data?.data.length === 0 && <EmptyState title="Aucune exécution" />}
      {!!runs.data?.data.length && (
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Automatisation</Th>
              <Th>Événement</Th>
              <Th>Statut</Th>
              <Th>Durée</Th>
              <Th>Détail</Th>
              <Th className="w-0" />
            </tr>
          </thead>
          <tbody>
            {runs.data.data.map((run) => (
              <tr key={run.id} className="align-top">
                <Td className="whitespace-nowrap text-xs">
                  {formatDateTime(run.createdAt, timeZone)}
                </Td>
                <Td className="text-sm">{run.automationName}</Td>
                <Td className="text-xs">
                  {run.submissionId ? (
                    <Link
                      to="/$app/submissions/$submissionId"
                      params={{ app: short, submissionId: run.submissionId }}
                      className="text-primary hover:underline"
                    >
                      Fiche, révision {run.event.revision}
                    </Link>
                  ) : (
                    'Échéance planifiée'
                  )}
                  {run.depth > 0 && (
                    <span className="block text-muted">Chaîne : niveau {run.depth}</span>
                  )}
                </Td>
                <Td>
                  <Badge color={RUN_STATUS[run.status].color}>{RUN_STATUS[run.status].label}</Badge>
                  {run.attempts > 1 && (
                    <span className="block text-xs text-muted">{run.attempts} essais</span>
                  )}
                </Td>
                <Td className="text-xs">{duration(run.durationMs)}</Td>
                <Td className="max-w-md">
                  <RunDetails run={run} />
                  {run.error && <p className="mt-1 text-xs text-danger">{run.error}</p>}
                </Td>
                <Td>
                  {run.status === 'failed' && (
                    <Button size="sm" variant="outline" onClick={() => retry.mutate(run.id)}>
                      <RotateCcw /> Relancer
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

function WebhookDeliveries({ webhook }: { webhook: Webhook }) {
  const { api, short, timeZone } = useApp();
  const toast = useToast();
  const queryClient = useQueryClient();
  const deliveries = useQuery({
    queryKey: [short, 'webhook-deliveries', webhook.id],
    queryFn: () => api.webhooks.deliveries(webhook.id, { perPage: 20 }),
    refetchInterval: 5_000,
  });
  const redeliver = useMutation({
    mutationFn: (id: string) => api.webhooks.redeliver(webhook.id, id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [short, 'webhook-deliveries', webhook.id] }),
    onError: toast.error,
  });
  if (!deliveries.data?.data.length) return <p className="text-xs text-muted">Aucune livraison.</p>;
  return (
    <ul className="space-y-1 text-xs">
      {deliveries.data.data.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-2">
          <Badge
            color={
              d.status === 'delivered' ? '#2E8B57' : d.status === 'failed' ? '#C4372D' : '#5B6470'
            }
          >
            {d.status === 'delivered'
              ? 'Livrée'
              : d.status === 'failed'
                ? 'Échec'
                : d.status === 'cancelled'
                  ? 'Annulée'
                  : 'En attente'}
          </Badge>
          <code>{d.event}</code>
          <span className="text-muted">{formatDateTime(d.createdAt, timeZone)}</span>
          {d.responseStatus !== null && <span>HTTP {d.responseStatus}</span>}
          {d.attempts > 1 && <span className="text-muted">{d.attempts} essais</span>}
          {d.error && <span className="text-danger">{d.error}</span>}
          {d.status === 'failed' && webhook.enabled && (
            <Button size="sm" variant="ghost" onClick={() => redeliver.mutate(d.id)}>
              <RotateCcw /> Renvoyer
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

function WebhooksPanel() {
  const { api, short } = useApp();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [events, setEvents] = useState<string[]>(['submission.created']);
  const [secret, setSecret] = useState<{ name: string; secret: string } | null>(null);
  const webhooks = useQuery({ queryKey: [short, 'webhooks'], queryFn: api.webhooks.list });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: [short, 'webhooks'] });
  const create = useMutation({
    mutationFn: (body: { name: string; url: string }) =>
      api.webhooks.create({ ...body, events: events as WebhookEvent[] }),
    onSuccess: async (webhook) => {
      setCreating(false);
      setSecret({ name: webhook.name, secret: webhook.secret });
      await invalidate();
    },
    onError: toast.error,
  });
  const update = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.webhooks.update(id, { enabled }),
    onSuccess: invalidate,
    onError: toast.error,
  });
  const rotate = useMutation({
    mutationFn: (id: string) => api.webhooks.rotateSecret(id),
    onSuccess: async (webhook) => {
      setSecret({ name: webhook.name, secret: webhook.secret });
      await invalidate();
    },
    onError: toast.error,
  });
  const ping = useMutation({
    mutationFn: (id: string) => api.webhooks.ping(id),
    onSuccess: async (_, id) => {
      toast.success('Événement de test envoyé');
      await queryClient.invalidateQueries({ queryKey: [short, 'webhook-deliveries', id] });
    },
    onError: toast.error,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.webhooks.remove(id),
    onSuccess: invalidate,
    onError: toast.error,
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    create.mutate({ name: String(form.get('name')).trim(), url: String(form.get('url')).trim() });
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Chaque requête est signée : en-tête <code>X-Wasafili-Signature: sha256=…</code>, HMAC-SHA256
        du secret sur <code>horodatage.corps</code> (horodatage dans{' '}
        <code>X-Wasafili-Timestamp</code>). Un webhook est désactivé après 5 livraisons échouées
        d'affilée.
      </p>
      <Button onClick={() => setCreating(true)}>
        <Plus /> Nouveau webhook
      </Button>
      {webhooks.error && <ErrorMessage error={webhooks.error} />}
      {webhooks.data?.data.length === 0 && <EmptyState title="Aucun webhook" />}
      {webhooks.data?.data.map((w) => (
        <Card key={w.id} className="space-y-2 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{w.name}</p>
              <p className="truncate text-xs text-muted">
                {w.url} · secret {w.secretHint}
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={w.enabled}
                onCheckedChange={(enabled) => update.mutate({ id: w.id, enabled })}
              />
              Actif
            </label>
            <Button size="sm" variant="outline" onClick={() => ping.mutate(w.id)}>
              <Send /> Tester
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                confirm('Générer un nouveau secret ? L’ancien cessera de fonctionner.') &&
                rotate.mutate(w.id)
              }
            >
              <RefreshCw /> Secret
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="text-danger"
              aria-label={`Supprimer ${w.name}`}
              onClick={() => confirm(`Supprimer le webhook « ${w.name} » ?`) && remove.mutate(w.id)}
            >
              <Trash2 />
            </Button>
          </div>
          <div className="flex flex-wrap gap-1">
            {w.events.length === 0 && <Badge>Automatisations uniquement</Badge>}
            {w.events.map((e) => (
              <Badge key={e}>{WEBHOOK_EVENTS.find((x) => x.value === e)?.label ?? e}</Badge>
            ))}
          </div>
          {w.disabledReason && (
            <p className="text-xs text-danger">Désactivé : {w.disabledReason}</p>
          )}
          <WebhookDeliveries webhook={w} />
        </Card>
      ))}
      <Dialog open={creating} onOpenChange={setCreating} title="Nouveau webhook">
        <form onSubmit={submit} className="space-y-4">
          <FormRow label="Nom" htmlFor="webhook-name" required>
            <Input id="webhook-name" name="name" required maxLength={200} placeholder="n8n" />
          </FormRow>
          <FormRow label="URL" htmlFor="webhook-url" required>
            <Input id="webhook-url" name="url" type="url" required placeholder="https://…" />
          </FormRow>
          <FormRow label="Événements (aucun = appelé seulement par des automatisations)">
            <Checklist
              label="Événements"
              options={WEBHOOK_EVENTS}
              value={events}
              onChange={(next) => setEvents(next ?? [])}
            />
          </FormRow>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCreating(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={create.isPending}>
              Créer
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={!!secret}
        onOpenChange={(open) => !open && setSecret(null)}
        title={`Secret de « ${secret?.name ?? ''} »`}
      >
        <div className="space-y-3">
          <p className="text-sm">
            Copiez ce secret maintenant : il ne sera plus affiché. Il sert au destinataire à
            vérifier la signature des requêtes.
          </p>
          <div className="flex gap-2">
            <Input
              readOnly
              value={secret?.secret ?? ''}
              className="font-mono text-xs"
              aria-label="Secret"
            />
            <Button
              variant="outline"
              onClick={() =>
                void navigator.clipboard
                  .writeText(secret?.secret ?? '')
                  .then(() => toast.success('Secret copié'))
              }
            >
              <Copy /> Copier
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function EmailsLog() {
  const { api, short, timeZone } = useApp();
  const toast = useToast();
  const queryClient = useQueryClient();
  const emails = useQuery({
    queryKey: [short, 'emails'],
    queryFn: () => api.emails.list({ perPage: 100 }),
    refetchInterval: 5_000,
  });
  const retry = useMutation({
    mutationFn: (id: string) => api.emails.retry(id),
    onSuccess: async () => {
      toast.success('E-mail remis en file');
      await queryClient.invalidateQueries({ queryKey: [short, 'emails'] });
    },
    onError: toast.error,
  });
  if (emails.isPending) return <Loading />;
  if (emails.error) return <ErrorMessage error={emails.error} />;
  if (emails.data.data.length === 0) return <EmptyState title="Aucun e-mail envoyé" />;
  return (
    <Table>
      <thead>
        <tr>
          <Th>Date</Th>
          <Th>Destinataires</Th>
          <Th>Sujet</Th>
          <Th>Pièces jointes</Th>
          <Th>Statut</Th>
          <Th className="w-0" />
        </tr>
      </thead>
      <tbody>
        {emails.data.data.map((email) => (
          <tr key={email.id} className="align-top">
            <Td className="whitespace-nowrap text-xs">
              {formatDateTime(email.createdAt, timeZone)}
            </Td>
            <Td className="text-xs">{email.to.join(', ')}</Td>
            <Td className="text-sm">{email.subject}</Td>
            <Td className="text-xs text-muted">{email.attachments.join(', ') || '—'}</Td>
            <Td>
              <Badge color={EMAIL_STATUS[email.status].color}>
                {EMAIL_STATUS[email.status].label}
              </Badge>
              {email.error && <p className="mt-1 max-w-xs text-xs text-danger">{email.error}</p>}
            </Td>
            <Td>
              {email.status === 'failed' && (
                <Button size="sm" variant="outline" onClick={() => retry.mutate(email.id)}>
                  <RotateCcw /> Renvoyer
                </Button>
              )}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** Automatisations, journal d'exécution, webhooks et journal d'envoi (P5.2–P5.4). */
export function AutomationsPage() {
  const { short } = useApp();
  const navigate = useNavigate();
  const { tab = 'automations' } = useSearch({ strict: false }) as { tab?: AutomationsTab };
  return (
    <>
      <PageHeader
        title="Automatisations"
        description="Déclencheurs, actions automatiques et intégrations sortantes."
        actions={
          <Button asChild>
            <Link
              to="/$app/automations/$automationId"
              params={{ app: short, automationId: 'nouvelle' }}
            >
              <Plus /> Nouvelle automatisation
            </Link>
          </Button>
        }
      />
      <Tabs
        value={tab}
        onValueChange={(value) =>
          void navigate({
            to: '/$app/automations',
            params: { app: short },
            search: { tab: value as AutomationsTab },
          })
        }
      >
        <TabsList className="mb-4">
          <TabsTrigger value="automations">Automatisations</TabsTrigger>
          <TabsTrigger value="runs">Exécutions</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="emails">E-mails envoyés</TabsTrigger>
        </TabsList>
        <TabsContent value="automations">
          <AutomationsList />
        </TabsContent>
        <TabsContent value="runs">
          <RunsLog />
        </TabsContent>
        <TabsContent value="webhooks">
          <WebhooksPanel />
        </TabsContent>
        <TabsContent value="emails">
          <EmailsLog />
        </TabsContent>
      </Tabs>
    </>
  );
}
