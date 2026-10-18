import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { rootValueFields } from '@tesserax/form-schema';
import { type AccessRule, type StructurePermission } from '@tesserax/sdk';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, ErrorMessage, Loading, PageHeader } from '@/components/ui/display';
import { Checkbox, Input, Select } from '@/components/ui/form-controls';
import { useToast } from '@/components/ui/toast';
import { useApp } from '@/lib/use-app';

const PERMISSIONS: { value: StructurePermission; label: string }[] = [
  { value: 'create', label: 'Créer' },
  { value: 'read:all', label: 'Lire toutes les fiches' },
  { value: 'read:own', label: 'Lire ses fiches' },
  { value: 'update', label: 'Modifier' },
  { value: 'delete', label: 'Supprimer' },
  { value: 'export', label: 'Exporter' },
];

/** Droits par structure (P2.6.2) et filtres de visibilité (P2.6.3). */
export function AccessPage() {
  const { structureId } = useParams({ strict: false }) as { structureId: string };
  const { short, api, can } = useApp();
  const queryClient = useQueryClient();
  const toast = useToast();
  const structure = useQuery({
    queryKey: [short, 'structure', structureId],
    queryFn: () => api.structures.get(structureId),
  });
  const access = useQuery({
    queryKey: [short, 'access', structureId],
    queryFn: () => api.structures.access(structureId),
  });
  const roles = useQuery({
    queryKey: [short, 'roles'],
    queryFn: () => api.roles.list({ perPage: 100 }),
  });
  const groups = useQuery({
    queryKey: [short, 'groups'],
    queryFn: () => api.groups.list({ perPage: 100 }),
  });
  const version = useQuery({
    queryKey: [short, 'version', structureId, 'current'],
    queryFn: () => api.structures.version(structureId, 'current'),
    enabled: !!structure.data?.currentVersion,
  });
  const [rules, setRules] = useState<AccessRule[]>();
  useEffect(() => {
    if (access.data && !rules) setRules(access.data.data);
  }, [access.data, rules]);
  const filterable = version.data
    ? rootValueFields(version.data.definition.fields).filter((f) => f.filterable)
    : [];
  const save = useMutation({
    mutationFn: () =>
      api.structures.setAccess(
        structureId,
        rules!.map(
          ({ id: _id, ...rule }) =>
            ({
              ...rule,
              roleId: rule.roleId ?? undefined,
              groupId: rule.groupId ?? undefined,
              visibility: rule.visibility?.length ? rule.visibility : undefined,
            }) as AccessRule,
        ),
      ),
    onSuccess: async (saved) => {
      setRules(saved.data);
      toast.success('Droits enregistrés');
      await queryClient.invalidateQueries({ queryKey: [short, 'access', structureId] });
    },
    onError: toast.error,
  });
  if (access.error) return <ErrorMessage error={access.error} />;
  if (!rules || !roles.data || !groups.data) return <Loading />;
  const set = (index: number, patch: Partial<AccessRule>) =>
    setRules(rules.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const manage = can('role:manage');

  return (
    <div className="max-w-4xl">
      <Button asChild variant="ghost" className="mb-2 -ml-3">
        <Link to="/$app/structures" params={{ app: short }}>
          <ArrowLeft /> Formulaires
        </Link>
      </Button>
      <PageHeader
        title={`Droits — ${structure.data?.name ?? ''}`}
        description="Sans règle, les permissions d’instance des rôles s’appliquent. Dès qu’une règle existe, seuls les rôles et groupes listés ont accès (les administrateurs gardent tous les droits)."
        actions={
          manage && (
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              Enregistrer
            </Button>
          )
        }
      />
      <div className="space-y-3">
        {rules.map((rule, index) => (
          <Card key={index} className="space-y-3 p-4">
            <div className="flex gap-2">
              <Select
                aria-label="Rôle ou groupe"
                disabled={!manage}
                value={
                  rule.roleId ? `role:${rule.roleId}` : rule.groupId ? `group:${rule.groupId}` : ''
                }
                onChange={(e) => {
                  const [kind, id] = e.target.value.split(':');
                  set(
                    index,
                    kind === 'role'
                      ? { roleId: id!, groupId: null }
                      : { groupId: id!, roleId: null },
                  );
                }}
              >
                <optgroup label="Rôles">
                  {roles.data.data.map((r) => (
                    <option key={r.id} value={`role:${r.id}`}>
                      {r.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Groupes">
                  {groups.data.data.map((g) => (
                    <option key={g.id} value={`group:${g.id}`}>
                      {g.name}
                    </option>
                  ))}
                </optgroup>
              </Select>
              {manage && (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Retirer la règle"
                  onClick={() => setRules(rules.filter((_, i) => i !== index))}
                >
                  <Trash2 className="text-danger" />
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {PERMISSIONS.map((p) => (
                <label key={p.value} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    disabled={!manage}
                    checked={rule.permissions.includes(p.value)}
                    onCheckedChange={(checked) =>
                      set(index, {
                        permissions: checked
                          ? [...rule.permissions, p.value]
                          : rule.permissions.filter((x) => x !== p.value),
                      })
                    }
                  />
                  {p.label}
                </label>
              ))}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase text-muted">
                Visibilité (fiches dont…)
              </p>
              {(rule.visibility ?? []).map((filter, fi) => (
                <div key={fi} className="flex gap-2">
                  <Select
                    aria-label="Champ"
                    disabled={!manage}
                    value={filter.key}
                    onChange={(e) =>
                      set(index, {
                        visibility: rule.visibility!.map((f, j) =>
                          j === fi ? { ...f, key: e.target.value } : f,
                        ),
                      })
                    }
                  >
                    {filterable.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </Select>
                  <span className="self-center text-sm">=</span>
                  <Input
                    aria-label="Valeur"
                    disabled={!manage}
                    className="font-mono text-xs"
                    value={filter.value}
                    placeholder="$user.site"
                    onChange={(e) =>
                      set(index, {
                        visibility: rule.visibility!.map((f, j) =>
                          j === fi ? { ...f, value: e.target.value } : f,
                        ),
                      })
                    }
                  />
                  {manage && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Retirer le filtre"
                      onClick={() =>
                        set(index, { visibility: rule.visibility!.filter((_, j) => j !== fi) })
                      }
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              ))}
              {manage && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={filterable.length === 0}
                  onClick={() =>
                    set(index, {
                      visibility: [
                        ...(rule.visibility ?? []),
                        { key: filterable[0]!.key, operator: 'eq', value: '$user.' },
                      ],
                    })
                  }
                >
                  <Plus /> Filtre de visibilité
                </Button>
              )}
              {filterable.length === 0 && (
                <p className="text-xs text-muted">
                  Marquez des champs « filtrables » dans le designer pour restreindre la visibilité.
                </p>
              )}
              <p className="text-xs text-muted">
                « $user.cle » renvoie à un attribut du membre (page Utilisateurs) ; « $user.id » à
                son identifiant.
              </p>
            </div>
          </Card>
        ))}
        {manage && (
          <Button
            variant="outline"
            onClick={() =>
              setRules([
                ...rules,
                { roleId: roles.data.data[0]?.id ?? null, permissions: ['read:all'] },
              ])
            }
          >
            <Plus /> Ajouter une règle
          </Button>
        )}
      </div>
    </div>
  );
}
