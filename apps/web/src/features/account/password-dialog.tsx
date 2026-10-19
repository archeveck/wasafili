import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FormRow, Input } from '@/components/ui/form-controls';
import { Dialog } from '@/components/ui/overlays';
import { useToast } from '@/components/ui/toast';
import { client } from '@/lib/api';

/**
 * Changement de mot de passe (ASVS 2.1.6). L'API ferme toutes les sessions : on se reconnecte
 * aussitôt avec le nouveau mot de passe, les autres appareils devront le faire aussi.
 */
export function PasswordDialog({
  email,
  open,
  onOpenChange,
}: {
  email: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const mismatch = confirmation.length > 0 && confirmation !== next;
  const change = useMutation({
    mutationFn: async () => {
      await client.changePassword(current, next);
      await client.login(email, next);
    },
    onSuccess: () => {
      toast.success('Mot de passe changé ; vos autres appareils sont déconnectés');
      setCurrent('');
      setNext('');
      setConfirmation('');
      onOpenChange(false);
    },
    onError: toast.error,
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!mismatch) change.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Changer mon mot de passe">
      <form className="space-y-4" onSubmit={submit}>
        <FormRow label="Mot de passe actuel" htmlFor="password-current" required>
          <Input
            id="password-current"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </FormRow>
        <FormRow label="Nouveau mot de passe" htmlFor="password-next" required>
          <Input
            id="password-next"
            type="password"
            autoComplete="new-password"
            minLength={12}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </FormRow>
        <p className="text-sm text-muted">
          12 caractères au moins. Une phrase de plusieurs mots est plus sûre et plus facile à
          retenir qu’un mot compliqué.
        </p>
        <FormRow label="Confirmation" htmlFor="password-confirmation" required>
          <Input
            id="password-confirmation"
            type="password"
            autoComplete="new-password"
            value={confirmation}
            aria-invalid={mismatch}
            onChange={(e) => setConfirmation(e.target.value)}
          />
        </FormRow>
        {mismatch && <p className="text-sm text-danger">Les deux saisies diffèrent.</p>}
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={!current || next.length < 12 || confirmation !== next || change.isPending}
          >
            Changer le mot de passe
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
