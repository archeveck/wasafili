import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { ApiError } from '@wasafili/sdk';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FormRow, Input } from '@/components/ui/form-controls';
import { client } from '@/lib/api';
import { AuthLayout } from './auth-layout';

/**
 * Jeton du lien reçu par e-mail. Il voyage dans le fragment (`#token=…`), que le navigateur
 * n'envoie jamais au serveur ; il est retiré de la barre d'adresse et de l'historique dès la
 * lecture.
 */
function readToken(): string | null {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
  if (token) window.history.replaceState(null, '', window.location.pathname);
  return token;
}

/** Nouveau mot de passe à partir du lien de réinitialisation (ASVS 2.5, ADR 0013). */
export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [token] = useState(readToken);
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const mismatch = confirmation.length > 0 && confirmation !== next;
  const reset = useMutation({
    mutationFn: () => client.confirmPasswordReset(token!, next),
    onSuccess: () => navigate({ to: '/login', search: { reset: '1' } }),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!mismatch) reset.mutate();
  };
  const expired = reset.error instanceof ApiError && reset.error.code === 'invalid_token';

  return (
    <AuthLayout
      title="Nouveau mot de passe"
      subtitle="Il remplace l’ancien et ferme vos sessions sur tous les appareils."
    >
      {!token || expired ? (
        <div className="space-y-4">
          <p role="alert" className="rounded-md bg-danger/10 p-3 text-sm text-danger">
            Ce lien est invalide ou a expiré (30 minutes, usage unique).
          </p>
          <Button asChild size="lg" className="w-full">
            <Link to="/mot-de-passe/oublie">Recevoir un nouveau lien</Link>
          </Button>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={submit}>
          <FormRow label="Nouveau mot de passe" htmlFor="password-next" required>
            <Input
              id="password-next"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              autoFocus
              className="h-10"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </FormRow>
          <p className="text-sm text-muted">
            12 caractères au moins. Une phrase de plusieurs mots est plus sûre et plus facile à
            retenir qu’un mot compliqué.
          </p>
          <FormRow
            label="Confirmation"
            htmlFor="password-confirmation"
            required
            error={mismatch ? 'Les deux saisies diffèrent.' : reset.error?.message}
          >
            <Input
              id="password-confirmation"
              type="password"
              autoComplete="new-password"
              required
              className="h-10"
              value={confirmation}
              aria-invalid={mismatch}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </FormRow>
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={next.length < 12 || confirmation !== next || reset.isPending}
            aria-busy={reset.isPending}
          >
            {reset.isPending && <Loader2 className="animate-spin" aria-hidden />}
            Enregistrer le mot de passe
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
