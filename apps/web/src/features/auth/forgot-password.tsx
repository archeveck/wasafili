import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { FormRow, Input } from '@/components/ui/form-controls';
import { client } from '@/lib/api';
import { AuthLayout } from './auth-layout';

/**
 * Mot de passe oublié (ASVS 2.5, ADR 0013) : un lien valable 30 minutes est envoyé par e-mail.
 * Le message est le même que le compte existe ou non.
 */
export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const send = useMutation({ mutationFn: () => client.requestPasswordReset(email) });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    send.mutate();
  };

  return (
    <AuthLayout
      title={t('auth.forgotPassword')}
      subtitle="Recevez par e-mail un lien pour choisir un nouveau mot de passe."
    >
      {send.isSuccess ? (
        <p role="status" className="rounded-md bg-success/10 p-3 text-sm text-success">
          Si un compte existe pour {email}, un e-mail vient de lui être envoyé. Le lien est valable
          30 minutes ; pensez à vérifier les courriers indésirables.
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <FormRow
            label={t('auth.email')}
            htmlFor="email"
            error={send.error ? send.error.message : undefined}
          >
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              autoFocus
              className="h-10"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </FormRow>
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={send.isPending}
            aria-busy={send.isPending}
          >
            {send.isPending && <Loader2 className="animate-spin" aria-hidden />}
            Envoyer le lien
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm">
        <Link to="/login" className="text-primary underline-offset-4 hover:underline">
          Retour à la connexion
        </Link>
      </p>
    </AuthLayout>
  );
}
