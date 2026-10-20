import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type Member } from '@wasafili/sdk';
import { KeyRound, Pencil, Plus, UserMinus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, ErrorMessage, Loading, PageHeader, Table, Td, Th } from '@/components/ui/display';
import { FormRow, Input, Select, Textarea } from '@/components/ui/form-controls';
import { Dialog } from '@/components/ui/overlays';
import { useToast } from '@/components/ui/toast';
import { useApp } from '@/lib/use-app';

/** `cle=valeur` par ligne ↔ attributs du membre (filtres de visibilité `$user.cle`). */
const parseAttributes = (text: string) =>
  Object.fromEntries(
    text
      .split('\n')
      .map((line) => line.split('=').map((part) => part.trim()))
      .filter(([key, value]) => key && value !== undefined && value !== '') as [string, string][],
  );
const formatAttributes = (attributes: Member['attributes']) =>
  Object.entries(attributes)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

export function UsersPage() {
  const { short, api, can, me } = useApp();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<Member>();
  const [password, setPassword] = useState<{ email: string; value: string; reset?: boolean }>();
  const users = useQuery({
    queryKey: [short, 'users'],
    queryFn: () => api.users.list({ perPage: 100 }),
  });
  const roles = useQuery({
    queryKey: [short, 'roles'],
    queryFn: () => api.roles.list({ perPage: 100 }),
    enabled: can('role:read') || can('user:manage'),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: [short, 'users'] });

  const invite = useMutation({
    mutationFn: api.users.invite,
    onSuccess: async (member) => {
      setInviting(false);
      if (member.temporaryPassword)
        setPassword({ email: member.email, value: member.temporaryPassword });
      else toast.success(`${member.email} ajouté à l’instance`);
      await refresh();
    },
    onError: toast.error,
  });
  const update = useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      roleId: string;
      attributes: Member['attributes'];
    }) => api.users.update(id, body),
    onSuccess: async () => {
      setEditing(undefined);
      toast.success('Membre modifié');
      await refresh();
    },
    onError: toast.error,
  });
  const resetPassword = useMutation({
    mutationFn: (member: Member) =>
      api.users.resetPassword(member.id).then(({ temporaryPassword }) => ({
        email: member.email,
        value: temporaryPassword,
        reset: true,
      })),
    onSuccess: setPassword,
    onError: toast.error,
  });
  const remove = useMutation({
    mutationFn: api.users.remove,
    onSuccess: refresh,
    onError: toast.error,
  });

  const submitInvite = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    invite.mutate({
      email: String(form.get('email')),
      firstName: String(form.get('firstName')),
      lastName: String(form.get('lastName')),
      roleId: String(form.get('roleId')),
      attributes: parseAttributes(String(form.get('attributes') ?? '')),
    });
  };

  return (
    <>
      <PageHeader
        title="Utilisateurs"
        description="Membres de l’instance, rôles et attributs (utilisés par les filtres de visibilité)."
        actions={
          can('user:manage') && (
            <Button onClick={() => setInviting(true)}>
              <Plus /> Ajouter un membre
            </Button>
          )
        }
      />
      {users.isPending && <Loading />}
      {users.error && <ErrorMessage error={users.error} />}
      {users.data && (
        <Table>
          <thead>
            <tr>
              <Th>Nom</Th>
              <Th>E-mail</Th>
              <Th>Rôle</Th>
              <Th>Groupes</Th>
              <Th>Attributs</Th>
              <Th className="w-0" />
            </tr>
          </thead>
          <tbody>
            {users.data.data.map((member) => (
              <tr key={member.id}>
                <Td className="font-medium">
                  {member.firstName} {member.lastName}
                </Td>
                <Td>{member.email}</Td>
                <Td>
                  <Badge>{member.role.name}</Badge>
                </Td>
                <Td className="text-muted">{member.groups.map((g) => g.name).join(', ') || '—'}</Td>
                <Td className="font-mono text-xs text-muted">
                  {formatAttributes(member.attributes) || '—'}
                </Td>
                <Td className="whitespace-nowrap">
                  {can('user:manage') && (
                    <>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Modifier ${member.email}`}
                        onClick={() => setEditing(member)}
                      >
                        <Pencil />
                      </Button>
                      {member.id !== me?.id && (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Réinitialiser le mot de passe de ${member.email}`}
                          onClick={() =>
                            confirm(
                              `Réinitialiser le mot de passe de ${member.email} ? Ses sessions seront fermées.`,
                            ) && resetPassword.mutate(member)
                          }
                        >
                          <KeyRound />
                        </Button>
                      )}
                      {member.id !== me?.id && (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Retirer ${member.email}`}
                          onClick={() =>
                            confirm(`Retirer ${member.email} de l’instance ?`) &&
                            remove.mutate(member.id)
                          }
                        >
                          <UserMinus className="text-danger" />
                        </Button>
                      )}
                    </>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Dialog
        open={inviting}
        onOpenChange={setInviting}
        title="Ajouter un membre"
        description="Un compte existant est rattaché ; sinon il est créé avec un mot de passe provisoire."
      >
        <form onSubmit={submitInvite} className="space-y-4">
          <FormRow label="E-mail" htmlFor="invite-email" required>
            <Input id="invite-email" name="email" type="email" required />
          </FormRow>
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Prénom" htmlFor="invite-first" required>
              <Input id="invite-first" name="firstName" required />
            </FormRow>
            <FormRow label="Nom" htmlFor="invite-last" required>
              <Input id="invite-last" name="lastName" required />
            </FormRow>
          </div>
          <FormRow label="Rôle" htmlFor="invite-role" required>
            <Select
              id="invite-role"
              name="roleId"
              required
              defaultValue={roles.data?.data.find((r) => r.key === 'technicien')?.id}
            >
              {roles.data?.data.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </Select>
          </FormRow>
          <FormRow
            label="Attributs"
            htmlFor="invite-attributes"
            help="Un par ligne : cle=valeur (ex. site=…)"
          >
            <Textarea id="invite-attributes" name="attributes" className="font-mono text-xs" />
          </FormRow>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setInviting(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={invite.isPending}>
              Ajouter
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(undefined)}
        title={`Modifier ${editing?.email ?? ''}`}
      >
        {editing && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              update.mutate({
                id: editing.id,
                roleId: String(form.get('roleId')),
                attributes: parseAttributes(String(form.get('attributes') ?? '')),
              });
            }}
            className="space-y-4"
          >
            <FormRow label="Rôle" htmlFor="edit-role">
              <Select id="edit-role" name="roleId" defaultValue={editing.role.id}>
                {roles.data?.data.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </Select>
            </FormRow>
            <FormRow label="Attributs" htmlFor="edit-attributes" help="Un par ligne : cle=valeur">
              <Textarea
                id="edit-attributes"
                name="attributes"
                className="font-mono text-xs"
                defaultValue={formatAttributes(editing.attributes)}
              />
            </FormRow>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(undefined)}>
                Annuler
              </Button>
              <Button type="submit" disabled={update.isPending}>
                Enregistrer
              </Button>
            </div>
          </form>
        )}
      </Dialog>
      <Dialog
        open={!!password}
        onOpenChange={(open) => !open && setPassword(undefined)}
        title={password?.reset ? 'Mot de passe réinitialisé' : 'Compte créé'}
        description="Transmettez ce mot de passe provisoire : il ne sera plus affiché. Le membre pourra le changer depuis son compte."
      >
        <p className="text-sm">{password?.email}</p>
        <p className="mt-2 rounded-md bg-subtle p-3 font-mono text-lg">{password?.value}</p>
      </Dialog>
    </>
  );
}
