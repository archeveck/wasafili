import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { type Field, rootValueFields } from '@wasafili/form-schema';
import { type Filter, type FilterOperator, type Submission } from '@wasafili/sdk';
import {
  ArrowDown,
  ArrowUp,
  Download,
  FileText,
  Filter as FilterIcon,
  Images,
  Plus,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Badge,
  EmptyState,
  ErrorMessage,
  Loading,
  PageHeader,
  Table,
  Td,
  Th,
} from '@/components/ui/display';
import { Input, Select } from '@/components/ui/form-controls';
import { useToast } from '@/components/ui/toast';
import { displayValue, listItemIds, useItemLabels, useUserLabels } from '@/form/display';
import { useApp } from '@/lib/use-app';
import { PhotoExportDialog } from './photo-export-dialog';
import { SubmissionsCalendar } from './submissions-calendar';
import { SubmissionsMap } from './submissions-map';
import { StateBadge, StateFilter } from './workflow';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/overlays';
import { download, formatDateTime } from '@/lib/utils';

const OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: 'eq', label: '=' },
  { value: 'ne', label: '≠' },
  { value: 'gte', label: '≥' },
  { value: 'lte', label: '≤' },
  { value: 'contains', label: 'contient' },
  { value: 'in', label: 'parmi' },
];
const COLUMN_TYPES = new Set(['photo', 'file', 'signature', 'table', 'info', 'hidden']);

/** Barre de filtres par champ filtrable (tableau des fiches, widgets de tableau de bord). */
export function FilterBar({
  fields,
  filters,
  onChange,
}: {
  fields: Field[];
  filters: Filter[];
  onChange: (filters: Filter[]) => void;
}) {
  const filterable = fields.filter((f) => f.filterable);
  const [draft, setDraft] = useState<Filter>({
    key: filterable[0]?.key ?? '',
    operator: 'eq',
    value: '',
  });
  if (filterable.length === 0) return null;
  const field = filterable.find((f) => f.key === draft.key);
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <FilterIcon className="size-4 text-muted" />
      {filters.map((filter, index) => {
        const f = filterable.find((x) => x.key === filter.key);
        return (
          <Badge key={index} className="gap-1">
            {f?.label ?? filter.key} {OPERATORS.find((o) => o.value === filter.operator)?.label}{' '}
            {f && 'options' in f
              ? (f.options.find((o) => o.value === filter.value)?.label ?? filter.value)
              : filter.value}
            <button
              type="button"
              aria-label="Retirer le filtre"
              onClick={() => onChange(filters.filter((_, i) => i !== index))}
            >
              <X className="size-3" />
            </button>
          </Badge>
        );
      })}
      <Select
        aria-label="Champ filtré"
        className="w-auto"
        value={draft.key}
        onChange={(e) => setDraft({ ...draft, key: e.target.value, value: '' })}
      >
        {filterable.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Opérateur"
        className="w-auto"
        value={draft.operator}
        onChange={(e) => setDraft({ ...draft, operator: e.target.value as FilterOperator })}
      >
        {OPERATORS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      {field && 'options' in field && draft.operator !== 'in' ? (
        <Select
          aria-label="Valeur"
          className="w-auto"
          value={draft.value}
          onChange={(e) => setDraft({ ...draft, value: e.target.value })}
        >
          <option value="">—</option>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ) : (
        <Input
          aria-label="Valeur"
          className="w-40"
          type={field?.type === 'date' ? 'date' : field?.type === 'number' ? 'number' : 'text'}
          value={draft.value}
          onChange={(e) => setDraft({ ...draft, value: e.target.value })}
        />
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={!draft.value}
        onClick={() => {
          onChange([...filters, draft]);
          setDraft({ ...draft, value: '' });
        }}
      >
        Ajouter
      </Button>
    </div>
  );
}

/** Tableau des fiches d'une structure (P2.5.1) : colonnes dynamiques, tri et pagination serveur. */
export function SubmissionsPage() {
  const { structureId } = useParams({ strict: false }) as { structureId: string };
  const { short, api, timeZone } = useApp();
  const navigate = useNavigate();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'createdAt', desc: true }]);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [state, setState] = useState<string>();
  const [view, setView] = useState<'table' | 'calendar' | 'map'>('table');
  const [photoExport, setPhotoExport] = useState(false);

  const structure = useQuery({
    queryKey: [short, 'structure', structureId],
    queryFn: () => api.structures.get(structureId),
  });
  const version = useQuery({
    queryKey: [short, 'version', structureId, 'current'],
    queryFn: () => api.structures.version(structureId, 'current'),
    enabled: !!structure.data?.currentVersion,
  });
  const fields = useMemo(
    () => (version.data ? rootValueFields(version.data.definition.fields) : []),
    [version.data],
  );
  const sort = sorting[0] ? `${sorting[0].desc ? '-' : ''}${sorting[0].id}` : undefined;
  const workflow = version.data?.definition.workflow;
  const query = {
    page,
    perPage: 25,
    filters,
    ...(sort ? { sort } : {}),
    ...(state ? { state } : {}),
  };
  const counts = useQuery({
    queryKey: [short, 'submissions', structureId, 'states', filters],
    queryFn: () => api.submissions.states(structureId, { filters }),
    enabled: !!workflow,
  });
  const submissions = useQuery({
    queryKey: [short, 'submissions', structureId, query],
    queryFn: () => api.submissions.list(structureId, query),
    placeholderData: (previous) => previous,
  });
  const labels = useItemLabels(
    api,
    short,
    listItemIds(
      fields,
      (submissions.data?.data ?? []).map((s) => s.data),
    ),
  );
  const users = useUserLabels(api, short);

  const sortable = (key: string) =>
    ['createdAt', 'updatedAt'].includes(key) || fields.some((f) => f.key === key && f.filterable);
  const columns = useMemo<ColumnDef<Submission>[]>(
    () => [
      {
        id: 'createdAt',
        header: 'Créée le',
        cell: ({ row }) => formatDateTime(row.original.createdAt, timeZone),
      },
      ...(workflow
        ? [
            {
              id: 'state',
              header: 'État',
              enableSorting: false,
              cell: ({ row }) => <StateBadge workflow={workflow} state={row.original.state} />,
            } satisfies ColumnDef<Submission>,
          ]
        : []),
      ...fields
        .filter((f) => !COLUMN_TYPES.has(f.type))
        .slice(0, 8)
        .map<ColumnDef<Submission>>((field) => ({
          id: field.key,
          header: field.label,
          cell: ({ row }) => {
            const value = row.original.data[field.key];
            const option =
              field.type === 'select' ? field.options.find((o) => o.value === value) : undefined;
            const text = displayValue(field, value, labels, timeZone, users);
            return option?.color ? <Badge color={option.color}>{text}</Badge> : text;
          },
        })),
      {
        id: 'version',
        header: 'Version',
        enableSorting: false,
        cell: ({ row }) => `v${row.original.version}`,
      },
    ],
    [fields, labels, users, timeZone, workflow],
  );

  const table = useReactTable({
    data: submissions.data?.data ?? [],
    columns,
    state: { sorting },
    manualSorting: true,
    manualPagination: true,
    enableSortingRemoval: false,
    onSortingChange: (updater) => {
      setSorting(updater);
      setPage(1);
    },
    getCoreRowModel: getCoreRowModel(),
  });

  const exportAs = async (format: 'csv' | 'xlsx' | 'pdf') => {
    try {
      download(
        await api.submissions.export(structureId, format, {
          filters,
          ...(sort ? { sort } : {}),
          ...(state ? { state } : {}),
        }),
        `${structure.data?.name ?? 'fiches'}.${format}`,
      );
    } catch (error) {
      toast.error(error);
    }
  };

  if (structure.error) return <ErrorMessage error={structure.error} />;
  const meta = submissions.data?.meta;

  return (
    <>
      <PageHeader
        title={structure.data?.name ?? '…'}
        description={meta ? `${meta.total} fiche(s)` : undefined}
        actions={
          <>
            <Button variant="outline" onClick={() => exportAs('csv')}>
              <Download /> CSV
            </Button>
            <Button variant="outline" onClick={() => exportAs('xlsx')}>
              <Download /> Excel
            </Button>
            <Button variant="outline" onClick={() => exportAs('pdf')}>
              <FileText /> PDF
            </Button>
            {fields.some((f) => f.type === 'photo' || f.type === 'table') && (
              <Button variant="outline" onClick={() => setPhotoExport(true)}>
                <Images /> Photos (ZIP)
              </Button>
            )}
            {structure.data?.currentVersion && (
              <Button asChild>
                <Link
                  to="/$app/structures/$structureId/submissions/new"
                  params={{ app: short, structureId }}
                >
                  <Plus /> Nouvelle fiche
                </Link>
              </Button>
            )}
          </>
        }
      />
      {workflow && (
        <StateFilter
          workflow={workflow}
          counts={counts.data?.data ?? []}
          value={state}
          onChange={(next) => {
            setState(next);
            setPage(1);
          }}
        />
      )}
      <FilterBar
        fields={fields}
        filters={filters}
        onChange={(next) => {
          setFilters(next);
          setPage(1);
        }}
      />
      <PhotoExportDialog
        open={photoExport}
        onOpenChange={setPhotoExport}
        structureId={structureId}
        filters={filters}
        state={state}
        sort={sort}
      />
      <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
        <TabsList className="mb-4">
          <TabsTrigger value="table">Tableau</TabsTrigger>
          <TabsTrigger value="calendar">Calendrier</TabsTrigger>
          <TabsTrigger value="map">Carte</TabsTrigger>
        </TabsList>
      </Tabs>
      {view === 'map' ? (
        <SubmissionsMap
          structureId={structureId}
          workflow={workflow}
          filters={filters}
          state={state}
        />
      ) : view === 'calendar' ? (
        <SubmissionsCalendar
          structureId={structureId}
          fields={fields}
          workflow={workflow}
          filters={filters}
          state={state}
        />
      ) : (
        <>
          {submissions.error && <ErrorMessage error={submissions.error} />}
          {submissions.isPending && <Loading />}
          {submissions.data?.data.length === 0 && (
            <EmptyState title="Aucune fiche">
              {structure.data?.currentVersion
                ? 'Les fiches saisies apparaîtront ici.'
                : 'Publiez le formulaire pour commencer la collecte.'}
            </EmptyState>
          )}
          {!!submissions.data?.data.length && (
            <>
              <Table>
                <thead>
                  {table.getHeaderGroups().map((group) => (
                    <tr key={group.id}>
                      {group.headers.map((header) => {
                        const canSort = sortable(header.column.id) && header.column.getCanSort();
                        const dir = header.column.getIsSorted();
                        return (
                          <Th
                            key={header.id}
                            aria-sort={
                              dir ? (dir === 'desc' ? 'descending' : 'ascending') : undefined
                            }
                          >
                            {canSort ? (
                              <button
                                type="button"
                                className="inline-flex items-center gap-1"
                                onClick={header.column.getToggleSortingHandler()}
                              >
                                {flexRender(header.column.columnDef.header, header.getContext())}
                                {dir === 'asc' && <ArrowUp className="size-3" />}
                                {dir === 'desc' && <ArrowDown className="size-3" />}
                              </button>
                            ) : (
                              flexRender(header.column.columnDef.header, header.getContext())
                            )}
                          </Th>
                        );
                      })}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.map((row) => (
                    <tr
                      key={row.id}
                      className="cursor-pointer hover:bg-subtle/50"
                      onClick={() =>
                        navigate({
                          to: '/$app/submissions/$submissionId',
                          params: { app: short, submissionId: row.original.id },
                        })
                      }
                    >
                      {row.getVisibleCells().map((cell) => (
                        <Td key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </Td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </Table>
              {meta && meta.totalPages > 1 && (
                <div className="mt-4 flex items-center justify-end gap-2 text-sm">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                  >
                    Précédent
                  </Button>
                  <span>
                    Page {meta.page} / {meta.totalPages}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page >= meta.totalPages}
                    onClick={() => setPage(page + 1)}
                  >
                    Suivant
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
