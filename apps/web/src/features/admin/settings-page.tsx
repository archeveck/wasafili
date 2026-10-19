import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type MobileTile, type Settings } from '@tesserax/sdk';
import { ArrowDown, ArrowUp, Plus, Trash2, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, Loading, PageHeader } from '@/components/ui/display';
import { FormRow, Input, Select } from '@/components/ui/form-controls';
import { useToast } from '@/components/ui/toast';
import { useApp } from '@/lib/use-app';

const KINDS: { value: MobileTile['kind']; label: string }[] = [
  { value: 'structure', label: 'Saisir un formulaire' },
  { value: 'submissions', label: 'Mes fiches' },
  { value: 'tasks', label: 'Agenda / tâches' },
  { value: 'scan', label: 'Scanner un QR code' },
  { value: 'map', label: 'Carte' },
];
const TIME_ZONES = [
  'Africa/Abidjan',
  'Africa/Dakar',
  'Africa/Lagos',
  'Africa/Douala',
  'Africa/Casablanca',
  'Europe/Paris',
  'UTC',
];

/** Personnalisation de l'instance (P2.7) : identité visuelle, fuseau, menu de l'application mobile. */
export function SettingsPage() {
  const { short, api, settings } = useApp();
  const queryClient = useQueryClient();
  const toast = useToast();
  const structures = useQuery({
    queryKey: [short, 'structures'],
    queryFn: () => api.structures.list({ perPage: 100 }),
  });
  const [draft, setDraft] = useState<Settings>();
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  useEffect(() => {
    if (settings && !draft) setDraft(settings);
  }, [settings, draft]);
  useEffect(() => {
    const id = draft?.branding.logoFileId;
    if (id)
      void api.files.get(id).then(
        (f) => setLogoUrl(f.thumbnailUrl ?? f.url),
        () => setLogoUrl(null),
      );
  }, [draft?.branding.logoFileId, api]);
  const save = useMutation({
    mutationFn: () =>
      api.settings.update({
        name: draft!.name,
        timeZone: draft!.timeZone,
        branding: draft!.branding,
        mobileMenu: draft!.mobileMenu,
      }),
    onSuccess: async () => {
      toast.success('Paramètres enregistrés');
      await queryClient.invalidateQueries({ queryKey: [short, 'settings'] });
    },
    onError: toast.error,
  });
  if (!draft) return <Loading />;
  const tiles = draft.mobileMenu;
  const setTiles = (mobileMenu: MobileTile[]) => setDraft({ ...draft, mobileMenu });
  const move = (index: number, delta: number) => {
    const next = [...tiles];
    const [tile] = next.splice(index, 1);
    next.splice(index + delta, 0, tile!);
    setTiles(next);
  };

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Paramètres"
        actions={
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Enregistrer
          </Button>
        }
      />
      <Card className="space-y-4 p-6">
        <h2 className="font-semibold">Instance</h2>
        <FormRow label="Nom" htmlFor="settings-name">
          <Input
            id="settings-name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </FormRow>
        <FormRow
          label="Fuseau horaire"
          htmlFor="settings-tz"
          help="Affichage des dates ; les données restent stockées en UTC."
        >
          <Select
            id="settings-tz"
            value={draft.timeZone}
            onChange={(e) => setDraft({ ...draft, timeZone: e.target.value })}
          >
            {[...new Set([draft.timeZone, ...TIME_ZONES])].map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Select>
        </FormRow>
      </Card>
      <Card className="space-y-4 p-6">
        <h2 className="font-semibold">Identité visuelle</h2>
        <div className="flex items-center gap-4">
          <div className="flex size-16 items-center justify-center overflow-hidden rounded-md border border-border bg-subtle">
            {logoUrl ? (
              <img src={logoUrl} alt="Logo" className="size-full object-contain" />
            ) : (
              <span className="text-xs text-muted">Logo</span>
            )}
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-subtle">
            <Upload className="size-4" /> Choisir une image
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const uploaded = await api.files.upload(file);
                  setDraft({ ...draft, branding: { ...draft.branding, logoFileId: uploaded.id } });
                } catch (error) {
                  toast.error(error);
                }
              }}
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {(['primaryColor', 'accentColor'] as const).map((key) => (
            <FormRow
              key={key}
              label={key === 'primaryColor' ? 'Couleur principale' : 'Couleur d’accent'}
              htmlFor={`settings-${key}`}
            >
              <div className="flex gap-2">
                <input
                  type="color"
                  id={`settings-${key}`}
                  className="h-9 w-12 rounded border border-border"
                  value={draft.branding[key] ?? (key === 'primaryColor' ? '#14284b' : '#2e6be6')}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      branding: { ...draft.branding, [key]: e.target.value.toUpperCase() },
                    })
                  }
                />
                <Input
                  aria-label={`${key} (hexadécimal)`}
                  className="font-mono"
                  value={draft.branding[key] ?? ''}
                  onChange={(e) =>
                    setDraft({ ...draft, branding: { ...draft.branding, [key]: e.target.value } })
                  }
                />
              </div>
            </FormRow>
          ))}
        </div>
      </Card>
      <Card className="space-y-4 p-6">
        <div>
          <h2 className="font-semibold">Menu de l’application mobile</h2>
          <p className="text-sm text-muted">
            Tuiles de l’écran d’accueil des techniciens, dans l’ordre.
          </p>
        </div>
        {tiles.map((tile, index) => (
          <div key={tile.id} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
            <Input
              aria-label="Libellé"
              value={tile.label}
              onChange={(e) =>
                setTiles(tiles.map((t, i) => (i === index ? { ...t, label: e.target.value } : t)))
              }
            />
            <Select
              aria-label="Action"
              value={tile.kind}
              onChange={(e) =>
                setTiles(
                  tiles.map((t, i) =>
                    i === index
                      ? {
                          id: t.id,
                          label: t.label,
                          icon: t.icon,
                          kind: e.target.value as MobileTile['kind'],
                        }
                      : t,
                  ),
                )
              }
            >
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </Select>
            {tile.kind === 'structure' ? (
              <Select
                aria-label="Formulaire"
                value={tile.structureId ?? ''}
                onChange={(e) =>
                  setTiles(
                    tiles.map((t, i) => (i === index ? { ...t, structureId: e.target.value } : t)),
                  )
                }
              >
                <option value="">— Formulaire —</option>
                {structures.data?.data.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                aria-label="Icône"
                className="font-mono text-xs"
                value={tile.icon}
                onChange={(e) =>
                  setTiles(tiles.map((t, i) => (i === index ? { ...t, icon: e.target.value } : t)))
                }
              />
            )}
            <div className="flex">
              <Button
                size="icon"
                variant="ghost"
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
                disabled={index === tiles.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Retirer"
                onClick={() => setTiles(tiles.filter((_, i) => i !== index))}
              >
                <Trash2 className="text-danger" />
              </Button>
            </div>
          </div>
        ))}
        <Button
          variant="outline"
          onClick={() =>
            setTiles([
              ...tiles,
              {
                id: crypto.randomUUID().slice(0, 8),
                label: 'Nouvelle tuile',
                icon: 'clipboard-list',
                kind: 'structure',
              },
            ])
          }
        >
          <Plus /> Ajouter une tuile
        </Button>
      </Card>
    </div>
  );
}
