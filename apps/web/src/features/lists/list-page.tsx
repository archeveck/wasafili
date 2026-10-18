import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { type ImportReport, type LevelMapping, type List, type ListItem } from '@tesserax/sdk';
import {
  ArrowLeft,
  Archive,
  ChevronDown,
  ChevronRight,
  Download,
  Pencil,
  Plus,
  Upload,
} from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, ErrorMessage, Loading, PageHeader } from '@/components/ui/display';
import { FormRow, Input, Select, Switch } from '@/components/ui/form-controls';
import { Dialog } from '@/components/ui/overlays';
import { useToast } from '@/components/ui/toast';
import { useApp } from '@/lib/use-app';
import { download } from '@/lib/utils';

type Editing = { parent?: ListItem | undefined; item?: ListItem | undefined } | undefined;

function Children({
  list,
  parentId,
  level,
  onEdit,
}: {
  list: List;
  parentId: string | 'root';
  level: number;
  onEdit: (e: Editing) => void;
}) {
  const { short, api } = useApp();
  const items = useQuery({
    queryKey: [short, 'list-items', list.id, parentId],
    queryFn: () => api.lists.items(list.id, { parentId, perPage: 100 }),
  });
  if (items.isPending) return <p className="py-1 pl-6 text-xs text-muted">Chargement…</p>;
  if (items.error) return <ErrorMessage error={items.error} />;
  if (items.data.data.length === 0)
    return level === 0 ? (
      <p className="p-4 text-sm text-muted">Aucun élément. Ajoutez-en ou importez un fichier.</p>
    ) : null;
  return (
    <ul role={level === 0 ? 'tree' : 'group'}>
      {items.data.data.map((item) => (
        <Node key={item.id} list={list} item={item} onEdit={onEdit} />
      ))}
      {items.data.meta.total > items.data.data.length && (
        <li className="py-1 pl-8 text-xs text-muted">
          … {items.data.meta.total - items.data.data.length} élément(s) de plus (affinez par
          recherche)
        </li>
      )}
    </ul>
  );
}

function Node({
  list,
  item,
  onEdit,
}: {
  list: List;
  item: ListItem;
  onEdit: (e: Editing) => void;
}) {
  const { short, api, can } = useApp();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const leaf = item.level >= list.levels.length - 1;
  const archive = useMutation({
    mutationFn: () => api.lists.archiveItem(list.id, item.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [short, 'list-items', list.id] }),
    onError: toast.error,
  });
  return (
    <li role="treeitem" aria-expanded={leaf ? undefined : open}>
      <div
        className="group flex items-center gap-1 rounded px-1 py-1 hover:bg-subtle"
        style={{ paddingLeft: `${item.level * 20 + 4}px` }}
      >
        {leaf ? (
          <span className="size-6" />
        ) : (
          <button
            type="button"
            className="rounded p-1 hover:bg-border/50"
            aria-label={open ? 'Replier' : 'Déplier'}
            onClick={() => setOpen(!open)}
          >
            {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        )}
        <span className="text-sm">{item.label}</span>
        {item.code && <Badge className="font-mono">{item.code}</Badge>}
        {Object.entries(item.attributes).map(([key, value]) => (
          <span key={key} className="text-xs text-muted">
            {key} : {String(value)}
          </span>
        ))}
        {can('list:manage') && (
          <span className="ml-auto flex gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
            {!leaf && (
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Ajouter sous ${item.label}`}
                onClick={() => {
                  setOpen(true);
                  onEdit({ parent: item });
                }}
              >
                <Plus />
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Modifier ${item.label}`}
              onClick={() => onEdit({ item })}
            >
              <Pencil />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Archiver ${item.label}`}
              onClick={() =>
                confirm(`Archiver « ${item.label} » et ses sous-éléments ?`) && archive.mutate()
              }
            >
              <Archive className="text-danger" />
            </Button>
          </span>
        )}
      </div>
      {open && !leaf && (
        <Children list={list} parentId={item.id} level={item.level + 1} onEdit={onEdit} />
      )}
    </li>
  );
}

function ItemDialog({
  list,
  editing,
  onClose,
}: {
  list: List;
  editing: Editing;
  onClose: () => void;
}) {
  const { short, api } = useApp();
  const queryClient = useQueryClient();
  const toast = useToast();
  const item = editing?.item;
  const save = useMutation({
    mutationFn: (body: { label: string; code?: string }) =>
      item
        ? api.lists.updateItem(list.id, item.id, { label: body.label, code: body.code ?? null })
        : api.lists.createItem(list.id, {
            ...body,
            ...(editing?.parent ? { parentId: editing.parent.id } : {}),
          }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [short, 'list-items', list.id] });
      onClose();
    },
    onError: toast.error,
  });
  const level = item?.level ?? (editing?.parent ? editing.parent.level + 1 : 0);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const code = String(form.get('code')).trim();
    save.mutate({ label: String(form.get('label')), ...(code ? { code } : {}) });
  };
  return (
    <Dialog
      open={!!editing}
      onOpenChange={(open) => !open && onClose()}
      title={`${item ? 'Modifier' : 'Ajouter'} : ${list.levels[level]}`}
      description={editing?.parent ? `Sous « ${editing.parent.label} »` : undefined}
    >
      <form onSubmit={submit} className="space-y-4">
        <FormRow label="Libellé" htmlFor="item-label" required>
          <Input id="item-label" name="label" required defaultValue={item?.label} autoFocus />
        </FormRow>
        <FormRow
          label="Code"
          htmlFor="item-code"
          help="Unique dans le référentiel ; utilisé par les QR codes et l'import."
        >
          <Input id="item-code" name="code" defaultValue={item?.code ?? ''} className="font-mono" />
        </FormRow>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={save.isPending}>
            Enregistrer
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Import CSV/XLSX : prévisualisation (dry run), rapport d'erreurs, puis application. */
function ImportDialog({
  list,
  open,
  onOpenChange,
}: {
  list: List;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { short, api } = useApp();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [file, setFile] = useState<File>();
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [customMapping, setCustomMapping] = useState(false);
  const [mapping, setMapping] = useState<LevelMapping[]>(
    list.levels.map((level) => ({ label: level, code: `${level} code` })),
  );
  const [report, setReport] = useState<ImportReport>();
  const run = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.lists.import(list.id, file!, {
        mode,
        dryRun,
        ...(customMapping ? { mapping: mapping.filter((m) => m.label) } : {}),
      }),
    onSuccess: async (result) => {
      setReport(result);
      if (result.applied) {
        toast.success(
          `Import appliqué : ${result.created} créé(s), ${result.updated} modifié(s), ${result.archived} archivé(s)`,
        );
        await queryClient.invalidateQueries({ queryKey: [short, 'list-items', list.id] });
        await queryClient.invalidateQueries({ queryKey: [short, 'lists'] });
      }
    },
    onError: toast.error,
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setReport(undefined);
      }}
      title="Importer un fichier"
      description="CSV (séparateur ; ou ,) ou Excel. Colonnes attendues par défaut : « Niveau code », « Niveau », « Niveau.attribut »."
      wide
    >
      <div className="space-y-4">
        <Input
          type="file"
          aria-label="Fichier à importer"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => {
            setFile(e.target.files?.[0]);
            setReport(undefined);
          }}
        />
        <FormRow label="Mode" htmlFor="import-mode">
          <Select
            id="import-mode"
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as 'merge' | 'replace');
              setReport(undefined);
            }}
          >
            <option value="merge">Fusionner (ajoute et met à jour)</option>
            <option value="replace">Remplacer (archive les éléments absents du fichier)</option>
          </Select>
        </FormRow>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={customMapping} onCheckedChange={setCustomMapping} /> Choisir les colonnes
          du fichier
        </label>
        {customMapping && (
          <div className="space-y-2">
            {list.levels.map((level, index) => (
              <div key={level} className="grid grid-cols-[120px_1fr_1fr] items-center gap-2">
                <span className="text-sm font-medium">{level}</span>
                <Input
                  aria-label={`Colonne du libellé ${level}`}
                  placeholder="Colonne du libellé"
                  value={mapping[index]?.label ?? ''}
                  onChange={(e) =>
                    setMapping(
                      mapping.map((m, i) => (i === index ? { ...m, label: e.target.value } : m)),
                    )
                  }
                />
                <Input
                  aria-label={`Colonne du code ${level}`}
                  placeholder="Colonne du code (facultatif)"
                  value={mapping[index]?.code ?? ''}
                  onChange={(e) =>
                    setMapping(
                      mapping.map((m, i) =>
                        i === index
                          ? { label: m.label, ...(e.target.value ? { code: e.target.value } : {}) }
                          : m,
                      ),
                    )
                  }
                />
              </div>
            ))}
          </div>
        )}
        {report && (
          <Card className="space-y-2 p-4 text-sm">
            <p className="font-medium">
              {report.applied
                ? 'Import appliqué'
                : report.errors.length
                  ? 'Import impossible'
                  : 'Prévisualisation'}{' '}
              — {report.rows} ligne(s)
            </p>
            <p>
              {report.created} à créer · {report.updated} à modifier · {report.unchanged}{' '}
              inchangé(s) · {report.archived} à archiver
            </p>
            {report.errors.length > 0 && (
              <ul className="max-h-40 space-y-0.5 overflow-y-auto text-danger">
                {report.errors.map((error, index) => (
                  <li key={index}>
                    {error.row > 0 ? `Ligne ${error.row} : ` : ''}
                    {error.message}
                  </li>
                ))}
              </ul>
            )}
            {report.preview.length > 0 && !report.applied && (
              <p className="text-xs text-muted">
                Exemples :{' '}
                {report.preview
                  .slice(0, 6)
                  .map((p) => p.label)
                  .join(', ')}
              </p>
            )}
          </Card>
        )}
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={!file || run.isPending}
            onClick={() => run.mutate(true)}
          >
            Prévisualiser
          </Button>
          <Button
            disabled={
              !file ||
              run.isPending ||
              !report ||
              report.dryRun === false ||
              report.errors.length > 0
            }
            onClick={() => run.mutate(false)}
          >
            <Upload /> Appliquer l’import
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function ListPage() {
  const { listId } = useParams({ strict: false }) as { listId: string };
  const { short, api, can } = useApp();
  const toast = useToast();
  const [editing, setEditing] = useState<Editing>();
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState('');
  const list = useQuery({
    queryKey: [short, 'list', listId],
    queryFn: () => api.lists.get(listId),
  });
  const results = useQuery({
    queryKey: [short, 'list-search', listId, search],
    queryFn: () => api.lists.items(listId, { q: search, perPage: 50 }),
    enabled: search.length >= 2,
  });
  if (list.error) return <ErrorMessage error={list.error} />;
  if (!list.data) return <Loading />;
  const exportAs = async (format: 'csv' | 'xlsx') => {
    try {
      download(await api.lists.export(listId, format), `${list.data.name}.${format}`);
    } catch (error) {
      toast.error(error);
    }
  };
  return (
    <>
      <Button asChild variant="ghost" className="mb-2 -ml-3">
        <Link to="/$app/lists" params={{ app: short }}>
          <ArrowLeft /> Référentiels
        </Link>
      </Button>
      <PageHeader
        title={list.data.name}
        description={list.data.levels.join(' › ')}
        actions={
          <>
            <Button variant="outline" onClick={() => exportAs('xlsx')}>
              <Download /> Exporter
            </Button>
            {can('list:manage') && (
              <>
                <Button variant="outline" onClick={() => setImporting(true)}>
                  <Upload /> Importer
                </Button>
                <Button onClick={() => setEditing({})}>
                  <Plus /> {list.data.levels[0]}
                </Button>
              </>
            )}
          </>
        }
      />
      <Input
        className="mb-4 max-w-sm"
        placeholder="Rechercher par libellé ou code…"
        aria-label="Rechercher"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <Card className="p-2">
        {search.length >= 2 ? (
          <ul>
            {(results.data?.data ?? []).map((item) => (
              <li key={item.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                <span className="text-xs text-muted">{list.data.levels[item.level]}</span>
                {item.label}
                {item.code && <Badge className="font-mono">{item.code}</Badge>}
              </li>
            ))}
            {results.data?.data.length === 0 && (
              <li className="p-3 text-sm text-muted">Aucun résultat</li>
            )}
          </ul>
        ) : (
          <Children list={list.data} parentId="root" level={0} onEdit={setEditing} />
        )}
      </Card>
      <ItemDialog
        key={JSON.stringify(editing ?? null)}
        list={list.data}
        editing={editing}
        onClose={() => setEditing(undefined)}
      />
      <ImportDialog list={list.data} open={importing} onOpenChange={setImporting} />
    </>
  );
}
