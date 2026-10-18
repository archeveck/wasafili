import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  Archive,
  ClipboardList,
  FileText,
  MoreHorizontal,
  PencilRuler,
  Plus,
  ShieldCheck,
} from 'lucide-react';
import { type FormEvent, useState } from 'react';
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
import { FormRow, Input, Textarea } from '@/components/ui/form-controls';
import {
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/overlays';
import { useToast } from '@/components/ui/toast';
import { useApp } from '@/lib/use-app';
import { formatDateTime } from '@/lib/utils';

export function StructuresPage() {
  const { short, api, can, timeZone } = useApp();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const structures = useQuery({
    queryKey: [short, 'structures'],
    queryFn: () => api.structures.list({ perPage: 100 }),
  });

  const create = useMutation({
    mutationFn: (body: { name: string; description?: string }) => api.structures.create(body),
    onSuccess: async (structure) => {
      await queryClient.invalidateQueries({ queryKey: [short, 'structures'] });
      await navigate({
        to: '/$app/structures/$structureId/designer',
        params: { app: short, structureId: structure.id },
      });
    },
    onError: toast.error,
  });
  const archive = useMutation({
    mutationFn: (id: string) => api.structures.archive(id),
    onSuccess: () => {
      toast.success('Formulaire archivé');
      return queryClient.invalidateQueries({ queryKey: [short, 'structures'] });
    },
    onError: toast.error,
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const description = String(form.get('description') ?? '').trim();
    create.mutate({ name: String(form.get('name')), ...(description ? { description } : {}) });
  };

  return (
    <>
      <PageHeader
        title="Formulaires"
        description="Structures de collecte : conception, publication et consultation des fiches."
        actions={
          can('structure:create') && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Nouveau formulaire
            </Button>
          )
        }
      />
      {structures.isPending && <Loading />}
      {structures.error && <ErrorMessage error={structures.error} />}
      {structures.data?.data.length === 0 && (
        <EmptyState title="Aucun formulaire">Créez votre premier formulaire.</EmptyState>
      )}
      {!!structures.data?.data.length && (
        <Table>
          <thead>
            <tr>
              <Th>Nom</Th>
              <Th>Version publiée</Th>
              <Th>Brouillon</Th>
              <Th>Modifié le</Th>
              <Th className="w-0" />
            </tr>
          </thead>
          <tbody>
            {structures.data.data.map((structure) => (
              <tr key={structure.id} className="hover:bg-subtle/50">
                <Td>
                  <Link
                    to="/$app/structures/$structureId/submissions"
                    params={{ app: short, structureId: structure.id }}
                    className="font-medium text-primary hover:underline"
                  >
                    {structure.name}
                  </Link>
                  {structure.description && (
                    <p className="text-xs text-muted">{structure.description}</p>
                  )}
                </Td>
                <Td>
                  {structure.currentVersion ? (
                    <Badge color="#2E8B57">v{structure.currentVersion}</Badge>
                  ) : (
                    <Badge>Non publiée</Badge>
                  )}
                </Td>
                <Td>
                  {structure.draftVersion ? (
                    <Badge color="#D98A1B">v{structure.draftVersion}</Badge>
                  ) : (
                    '—'
                  )}
                </Td>
                <Td className="whitespace-nowrap text-muted">
                  {formatDateTime(structure.updatedAt, timeZone)}
                </Td>
                <Td>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Actions pour ${structure.name}`}
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem asChild>
                        <Link
                          to="/$app/structures/$structureId/submissions"
                          params={{ app: short, structureId: structure.id }}
                        >
                          <ClipboardList /> Fiches
                        </Link>
                      </DropdownMenuItem>
                      {can('structure:update') && (
                        <DropdownMenuItem asChild>
                          <Link
                            to="/$app/structures/$structureId/designer"
                            params={{ app: short, structureId: structure.id }}
                          >
                            <PencilRuler /> Concevoir
                          </Link>
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem asChild>
                        <Link
                          to="/$app/structures/$structureId/reports"
                          params={{ app: short, structureId: structure.id }}
                        >
                          <FileText /> Rapports
                        </Link>
                      </DropdownMenuItem>
                      {can('role:read') && (
                        <DropdownMenuItem asChild>
                          <Link
                            to="/$app/structures/$structureId/access"
                            params={{ app: short, structureId: structure.id }}
                          >
                            <ShieldCheck /> Droits
                          </Link>
                        </DropdownMenuItem>
                      )}
                      {can('structure:delete') && (
                        <DropdownMenuItem
                          className="text-danger"
                          onSelect={() => {
                            if (
                              confirm(
                                `Archiver « ${structure.name} » ? Les fiches restent consultables.`,
                              )
                            )
                              archive.mutate(structure.id);
                          }}
                        >
                          <Archive /> Archiver
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Dialog open={creating} onOpenChange={setCreating} title="Nouveau formulaire">
        <form onSubmit={submit} className="space-y-4">
          <FormRow label="Nom" htmlFor="structure-name" required>
            <Input id="structure-name" name="name" required maxLength={200} autoFocus />
          </FormRow>
          <FormRow label="Description" htmlFor="structure-description">
            <Textarea id="structure-description" name="description" maxLength={2000} />
          </FormRow>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreating(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={create.isPending}>
              Créer et concevoir
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
