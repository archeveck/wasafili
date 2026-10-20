import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type Role } from '@wasafili/sdk';
import { Lock, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, ErrorMessage, Loading, PageHeader } from '@/components/ui/display';
import { Checkbox, FormRow, Input } from '@/components/ui/form-controls';
import { Dialog } from '@/components/ui/overlays';
import { useToast } from '@/components/ui/toast';
import { useApp } from '@/lib/use-app';
import { slugify } from '@/lib/utils';

const GROUPS: Record<string, string> = {
  instance: 'Instance',
  user: 'Utilisateurs',
  role: 'Rôles',
  group: 'Groupes',
  structure: 'Formulaires',
  list: 'Référentiels',
  submission: 'Fiches',
  task: 'Tâches',
  report: 'Rapports',
  automation: 'Automatisations',
  apikey: 'Clés API',
  audit: 'Audit',
  dashboard: 'Tableaux de bord',
};

export function PermissionGrid({
  catalogue,
  value,
  onChange,
  disabled,
}: {
  catalogue: string[];
  value: Set<string>;
  onChange: (v: Set<string>) => void;
  disabled?: boolean;
}) {
  const byGroup: Record<string, string[]> = {};
  for (const permission of catalogue) (byGroup[permission.split(':')[0]!] ??= []).push(permission);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {Object.entries(byGroup).map(([group, permissions]) => (
        <div key={group}>
          <p className="mb-1 text-xs font-semibold uppercase text-muted">
            {GROUPS[group] ?? group}
          </p>
          {permissions.map((permission) => (
            <label key={permission} className="flex items-center gap-2 py-0.5 text-sm">
              <Checkbox
                checked={value.has(permission)}
                disabled={disabled}
                onCheckedChange={(checked) => {
                  const next = new Set(value);
                  if (checked) next.add(permission);
                  else next.delete(permission);
                  onChange(next);
                }}
              />
              <span className="font-mono text-xs">{permission}</span>
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}

export function RolesPage() {
  const { short, api, can } = useApp();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Partial<Role> & { permissionSet: Set<string> }>();
  const roles = useQuery({
    queryKey: [short, 'roles'],
    queryFn: () => api.roles.list({ perPage: 100 }),
  });
  const catalogue = useQuery({ queryKey: ['permissions', short], queryFn: api.roles.permissions });
  const refresh = () => queryClient.invalidateQueries({ queryKey: [short] });
  const save = useMutation({
    mutationFn: async () => {
      const permissions = [...editing!.permissionSet];
      if (editing!.id)
        return api.roles.update(editing!.id, {
          name: editing!.name!,
          ...(editing!.key === 'admin' ? {} : { permissions }),
        });
      return api.roles.create({
        key: slugify(editing!.name ?? ''),
        name: editing!.name!,
        permissions,
      });
    },
    onSuccess: async () => {
      setEditing(undefined);
      toast.success('Rôle enregistré');
      await refresh();
    },
    onError: toast.error,
  });
  const remove = useMutation({
    mutationFn: api.roles.remove,
    onSuccess: refresh,
    onError: toast.error,
  });
  const manage = can('role:manage');
  return (
    <>
      <PageHeader
        title="Rôles"
        description="Permissions d’instance ; les droits fins par formulaire se règlent dans « Droits »."
        actions={
          manage && (
            <Button onClick={() => setEditing({ permissionSet: new Set() })}>
              <Plus /> Nouveau rôle
            </Button>
          )
        }
      />
      {roles.isPending && <Loading />}
      {roles.error && <ErrorMessage error={roles.error} />}
      <div className="grid gap-3 md:grid-cols-2">
        {roles.data?.data.map((role) => (
          <Card key={role.id} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium">
                  {role.name}{' '}
                  {role.isSystem && (
                    <Badge className="ml-1">
                      <Lock className="mr-1 size-3" />
                      système
                    </Badge>
                  )}
                </p>
                <p className="font-mono text-xs text-muted">
                  {role.key} · {role.permissions.length} permission(s)
                </p>
              </div>
              {manage && (
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setEditing({ ...role, permissionSet: new Set(role.permissions) })
                    }
                  >
                    Modifier
                  </Button>
                  {!role.isSystem && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Supprimer ${role.name}`}
                      onClick={() =>
                        confirm(`Supprimer le rôle « ${role.name} » ?`) && remove.mutate(role.id)
                      }
                    >
                      <Trash2 className="text-danger" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>
      <Dialog
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(undefined)}
        title={editing?.id ? `Rôle « ${editing.name} »` : 'Nouveau rôle'}
        wide
        footer={
          <Button onClick={() => save.mutate()} disabled={!editing?.name || save.isPending}>
            Enregistrer
          </Button>
        }
      >
        {editing && (
          <div className="space-y-4">
            <FormRow label="Nom" htmlFor="role-name" required>
              <Input
                id="role-name"
                value={editing.name ?? ''}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </FormRow>
            {editing.key === 'admin' && (
              <p className="text-sm text-muted">
                Le rôle administrateur possède toutes les permissions.
              </p>
            )}
            {catalogue.data && (
              <PermissionGrid
                catalogue={catalogue.data.data}
                value={editing.permissionSet}
                onChange={(permissionSet) => setEditing({ ...editing, permissionSet })}
                disabled={editing.key === 'admin'}
              />
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
