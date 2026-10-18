import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  EmptyState,
  ErrorMessage,
  Loading,
  PageHeader,
  Table,
  Td,
  Th,
} from '@/components/ui/display';
import { FormRow, Input } from '@/components/ui/form-controls';
import { Dialog } from '@/components/ui/overlays';
import { useToast } from '@/components/ui/toast';
import { useApp } from '@/lib/use-app';

export function ListsPage() {
  const { short, api, can } = useApp();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const lists = useQuery({
    queryKey: [short, 'lists'],
    queryFn: () => api.lists.list({ perPage: 100 }),
  });
  const create = useMutation({
    mutationFn: api.lists.create,
    onSuccess: async () => {
      setCreating(false);
      toast.success('Référentiel créé');
      await queryClient.invalidateQueries({ queryKey: [short, 'lists'] });
    },
    onError: toast.error,
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const levels = String(form.get('levels'))
      .split('>')
      .map((l) => l.trim())
      .filter(Boolean);
    create.mutate({ name: String(form.get('name')), levels });
  };

  return (
    <>
      <PageHeader
        title="Référentiels"
        description="Listes de valeurs hiérarchiques utilisées par les formulaires (sites, équipements…)."
        actions={
          can('list:manage') && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Nouveau référentiel
            </Button>
          )
        }
      />
      {lists.isPending && <Loading />}
      {lists.error && <ErrorMessage error={lists.error} />}
      {lists.data?.data.length === 0 && <EmptyState title="Aucun référentiel" />}
      {!!lists.data?.data.length && (
        <Table>
          <thead>
            <tr>
              <Th>Nom</Th>
              <Th>Niveaux</Th>
              <Th>Éléments actifs</Th>
            </tr>
          </thead>
          <tbody>
            {lists.data.data.map((list) => (
              <tr key={list.id}>
                <Td>
                  <Link
                    to="/$app/lists/$listId"
                    params={{ app: short, listId: list.id }}
                    className="font-medium text-primary hover:underline"
                  >
                    {list.name}
                  </Link>
                </Td>
                <Td>{list.levels.join(' › ')}</Td>
                <Td>{list.itemCount}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Dialog open={creating} onOpenChange={setCreating} title="Nouveau référentiel">
        <form onSubmit={submit} className="space-y-4">
          <FormRow label="Nom" htmlFor="list-name" required>
            <Input id="list-name" name="name" required autoFocus />
          </FormRow>
          <FormRow
            label="Niveaux"
            htmlFor="list-levels"
            required
            help="Séparés par « > », ex. Site > Bâtiment > Équipement"
          >
            <Input
              id="list-levels"
              name="levels"
              required
              defaultValue="Site > Bâtiment > Équipement"
            />
          </FormRow>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreating(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={create.isPending}>
              Créer
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
