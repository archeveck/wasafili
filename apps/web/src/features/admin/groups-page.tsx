import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type Group } from '@wasafili/sdk';
import { Plus, Trash2, Users } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorMessage, Loading, PageHeader, Table, Td, Th } from '@/components/ui/display';
import { Checkbox, FormRow, Input } from '@/components/ui/form-controls';
import { Dialog } from '@/components/ui/overlays';
import { useToast } from '@/components/ui/toast';
import { useApp } from '@/lib/use-app';

function MembersDialog({ group, onClose }: { group: Group; onClose: () => void }) {
  const { short, api } = useApp();
  const queryClient = useQueryClient();
  const toast = useToast();
  const detail = useQuery({
    queryKey: [short, 'group', group.id],
    queryFn: () => api.groups.get(group.id),
  });
  const users = useQuery({
    queryKey: [short, 'users'],
    queryFn: () => api.users.list({ perPage: 100 }),
  });
  const [selected, setSelected] = useState<Set<string>>();
  const current = selected ?? new Set(detail.data?.members?.map((m) => m.id) ?? []);
  const save = useMutation({
    mutationFn: () => api.groups.setMembers(group.id, [...current]),
    onSuccess: async () => {
      toast.success('Membres enregistrés');
      await queryClient.invalidateQueries({ queryKey: [short] });
      onClose();
    },
    onError: toast.error,
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Membres de « ${group.name} »`}
      footer={
        <Button onClick={() => save.mutate()} disabled={save.isPending || !detail.data}>
          Enregistrer
        </Button>
      }
    >
      {(detail.isPending || users.isPending) && <Loading />}
      <div className="max-h-80 space-y-1 overflow-y-auto">
        {users.data?.data.map((user) => (
          <label
            key={user.id}
            className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-subtle"
          >
            <Checkbox
              checked={current.has(user.id)}
              onCheckedChange={(checked) => {
                const next = new Set(current);
                if (checked) next.add(user.id);
                else next.delete(user.id);
                setSelected(next);
              }}
            />
            {user.firstName} {user.lastName} <span className="text-muted">{user.email}</span>
          </label>
        ))}
      </div>
    </Dialog>
  );
}

export function GroupsPage() {
  const { short, api, can } = useApp();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [members, setMembers] = useState<Group>();
  const groups = useQuery({
    queryKey: [short, 'groups'],
    queryFn: () => api.groups.list({ perPage: 100 }),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: [short, 'groups'] });
  const create = useMutation({
    mutationFn: api.groups.create,
    onSuccess: async () => {
      setCreating(false);
      await refresh();
    },
    onError: toast.error,
  });
  const remove = useMutation({
    mutationFn: api.groups.remove,
    onSuccess: refresh,
    onError: toast.error,
  });
  return (
    <>
      <PageHeader
        title="Groupes"
        description="Équipes : droits par structure et restriction des choix d’utilisateurs."
        actions={
          can('group:manage') && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Nouveau groupe
            </Button>
          )
        }
      />
      {groups.isPending && <Loading />}
      {groups.error && <ErrorMessage error={groups.error} />}
      {groups.data && (
        <Table>
          <thead>
            <tr>
              <Th>Nom</Th>
              <Th>Membres</Th>
              <Th className="w-0" />
            </tr>
          </thead>
          <tbody>
            {groups.data.data.map((group) => (
              <tr key={group.id}>
                <Td className="font-medium">{group.name}</Td>
                <Td>{group._count.members}</Td>
                <Td className="whitespace-nowrap">
                  {can('group:manage') && (
                    <>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Membres de ${group.name}`}
                        onClick={() => setMembers(group)}
                      >
                        <Users />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Supprimer ${group.name}`}
                        onClick={() =>
                          confirm(`Supprimer le groupe « ${group.name} » ?`) &&
                          remove.mutate(group.id)
                        }
                      >
                        <Trash2 className="text-danger" />
                      </Button>
                    </>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Dialog open={creating} onOpenChange={setCreating} title="Nouveau groupe">
        <form
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            create.mutate(String(new FormData(e.currentTarget).get('name')));
          }}
          className="space-y-4"
        >
          <FormRow label="Nom" htmlFor="group-name" required>
            <Input id="group-name" name="name" required autoFocus />
          </FormRow>
          <div className="flex justify-end">
            <Button type="submit" disabled={create.isPending}>
              Créer
            </Button>
          </div>
        </form>
      </Dialog>
      {members && <MembersDialog group={members} onClose={() => setMembers(undefined)} />}
    </>
  );
}
