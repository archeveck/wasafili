import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ApiClient, type ApiClientWithSecret } from '@wasafili/sdk';
import { Copy, KeyRound, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Badge,
  Card,
  EmptyState,
  ErrorMessage,
  Loading,
  PageHeader,
} from '@/components/ui/display';
import { FormRow, Input } from '@/components/ui/form-controls';
import { Dialog } from '@/components/ui/overlays';
import { useToast } from '@/components/ui/toast';
import { useApp } from '@/lib/use-app';
import { formatDateTime } from '@/lib/utils';
import { PermissionGrid } from './roles-page';

type Editing = { id?: string; name: string; scopes: Set<string> };

/**
 * Clés API (P7.1.4) : identifiants `client_credentials` des intégrations (n8n, ERP…). Le
 * secret n'est affiché qu'une fois ; une clé ne reçoit que des permissions que l'on détient.
 */
export function ApiKeysPage() {
  const { short, api, me, timeZone } = useApp();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Editing>();
  const [secret, setSecret] = useState<ApiClientWithSecret>();
  const keys = useQuery({ queryKey: [short, 'api-clients'], queryFn: api.apiClients.list });
  const refresh = () => queryClient.invalidateQueries({ queryKey: [short, 'api-clients'] });
  // Permissions délégables : celles de l'appelant (l'API refuse les autres).
  const grantable = me?.permissions ?? [];

  const save = useMutation({
    mutationFn: async (value: Editing) => {
      const body = { name: value.name.trim(), scopes: [...value.scopes] };
      if (value.id) return { key: await api.apiClients.update(value.id, body), created: false };
      return { key: await api.apiClients.create(body), created: true };
    },
    onSuccess: async ({ key, created }) => {
      setEditing(undefined);
      if (created) setSecret(key as ApiClientWithSecret);
      else toast.success('Clé API enregistrée');
      await refresh();
    },
    onError: toast.error,
  });
  const rotate = useMutation({
    mutationFn: (id: string) => api.apiClients.rotateSecret(id),
    onSuccess: async (key) => {
      setSecret(key);
      await refresh();
    },
    onError: toast.error,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.apiClients.revoke(id),
    onSuccess: async () => {
      toast.success('Clé API révoquée');
      await refresh();
    },
    onError: toast.error,
  });

  const copy = (label: string, value: string) =>
    void navigator.clipboard.writeText(value).then(() => toast.success(`${label} copié`));

  return (
    <>
      <PageHeader
        title="Clés API"
        description={
          <>
            Accès des intégrations (n8n, ERP…) par OAuth2 <code>client_credentials</code>.{' '}
            <a
              href="/v1/docs"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary hover:underline"
            >
              Documentation de l’API
            </a>
          </>
        }
        actions={
          <Button onClick={() => setEditing({ name: '', scopes: new Set() })}>
            <Plus /> Nouvelle clé
          </Button>
        }
      />
      {keys.isPending && <Loading />}
      {keys.error && <ErrorMessage error={keys.error} />}
      {keys.data?.data.length === 0 && (
        <EmptyState title="Aucune clé API">
          Créez une clé pour connecter un outil externe à cette instance.
        </EmptyState>
      )}
      <div className="space-y-3">
        {keys.data?.data.map((key) => (
          <KeyCard
            key={key.id}
            apiKey={key}
            timeZone={timeZone}
            onEdit={() => setEditing({ id: key.id, name: key.name, scopes: new Set(key.scopes) })}
            onRotate={() =>
              confirm(
                `Régénérer le secret de « ${key.name} » ? L’ancien secret cessera de fonctionner.`,
              ) && rotate.mutate(key.id)
            }
            onRevoke={() =>
              confirm(
                `Révoquer « ${key.name} » ? Les intégrations qui l’utilisent seront coupées immédiatement.`,
              ) && revoke.mutate(key.id)
            }
            onCopy={() => copy('Identifiant', key.clientId)}
          />
        ))}
      </div>

      <Dialog
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(undefined)}
        title={editing?.id ? `Clé « ${editing.name} »` : 'Nouvelle clé API'}
        wide
        footer={
          <Button
            onClick={() => editing && save.mutate(editing)}
            disabled={!editing?.name.trim() || save.isPending}
          >
            {editing?.id ? 'Enregistrer' : 'Créer la clé'}
          </Button>
        }
      >
        {editing && (
          <div className="space-y-4">
            <FormRow label="Nom" htmlFor="api-key-name" required>
              <Input
                id="api-key-name"
                value={editing.name}
                placeholder="n8n — rapports hebdomadaires"
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </FormRow>
            <div>
              <p className="mb-2 text-sm font-medium">Permissions accordées</p>
              <p className="mb-3 text-sm text-muted">
                Accordez le strict nécessaire. Les changements s’appliquent dès la requête suivante
                de l’intégration.
              </p>
              <PermissionGrid
                catalogue={grantable}
                value={editing.scopes}
                onChange={(scopes) => setEditing({ ...editing, scopes })}
              />
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        open={!!secret}
        onOpenChange={(open) => !open && setSecret(undefined)}
        title={`Clé « ${secret?.name ?? ''} »`}
        wide
      >
        {secret && (
          <div className="space-y-3">
            <p className="text-sm">
              Copiez le secret maintenant : il ne sera plus affiché. Conservez-le dans le
              gestionnaire d’identifiants de l’intégration, jamais dans un fichier partagé.
            </p>
            <SecretRow
              label="Identifiant (client_id)"
              value={secret.clientId}
              onCopy={() => copy('Identifiant', secret.clientId)}
            />
            <SecretRow
              label="Secret (client_secret)"
              value={secret.clientSecret}
              onCopy={() => copy('Secret', secret.clientSecret)}
            />
            <p className="text-sm text-muted">
              Jeton : <code>POST /v1/oauth/token</code> avec{' '}
              <code>grant_type=client_credentials</code>, puis l’en-tête{' '}
              <code>Authorization: Bearer …</code> sur <code>/v1/{short}/…</code>.
            </p>
          </div>
        )}
      </Dialog>
    </>
  );
}

function KeyCard({
  apiKey,
  timeZone,
  onEdit,
  onRotate,
  onRevoke,
  onCopy,
}: {
  apiKey: ApiClient;
  timeZone: string;
  onEdit: () => void;
  onRotate: () => void;
  onRevoke: () => void;
  onCopy: () => void;
}) {
  const revoked = apiKey.revokedAt !== null;
  return (
    <Card className={revoked ? 'p-4 opacity-70' : 'p-4'}>
      <div className="flex flex-wrap items-start gap-3">
        <KeyRound className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium">
            {apiKey.name}{' '}
            {revoked && (
              <Badge className="ml-1">
                révoquée le {formatDateTime(apiKey.revokedAt!, timeZone)}
              </Badge>
            )}
          </p>
          <button
            type="button"
            onClick={onCopy}
            className="flex items-center gap-1 font-mono text-xs text-muted hover:text-foreground"
            aria-label={`Copier l’identifiant ${apiKey.clientId}`}
          >
            {apiKey.clientId} <Copy className="size-3" aria-hidden />
          </button>
          <p className="text-xs text-muted">
            {apiKey.scopes.length} permission(s) · créée le{' '}
            {formatDateTime(apiKey.createdAt, timeZone)} ·{' '}
            {apiKey.lastUsedAt
              ? `dernière utilisation le ${formatDateTime(apiKey.lastUsedAt, timeZone)}`
              : 'jamais utilisée'}
          </p>
          {apiKey.scopes.length > 0 && (
            <p className="flex flex-wrap gap-1 pt-1">
              {apiKey.scopes.map((scope) => (
                <Badge key={scope} className="font-mono">
                  {scope}
                </Badge>
              ))}
            </p>
          )}
        </div>
        {!revoked && (
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={onEdit}>
              Modifier
            </Button>
            <Button size="sm" variant="outline" onClick={onRotate}>
              <RotateCcw /> Régénérer le secret
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Révoquer ${apiKey.name}`}
              onClick={onRevoke}
            >
              <Trash2 className="text-danger" />
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function SecretRow({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted">{label}</p>
      <div className="flex gap-2">
        <Input readOnly value={value} className="font-mono text-xs" aria-label={label} />
        <Button variant="outline" onClick={onCopy}>
          <Copy /> Copier
        </Button>
      </div>
    </div>
  );
}
