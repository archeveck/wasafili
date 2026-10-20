import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { ApiError } from '@wasafili/sdk';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { FormRow, Input } from '@/components/ui/form-controls';
import { client } from '@/lib/api';
import { AuthLayout } from './auth-layout';

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { redirect?: string; reset?: string };
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(undefined);
    try {
      await client.login(String(form.get('email')), String(form.get('password')));
      await navigate({ to: search.redirect?.startsWith('/') ? search.redirect : '/' });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 400
          ? t('auth.invalidCredentials')
          : (err as Error).message,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title={t('app.name')} subtitle="Back-office de collecte terrain">
      {search.reset === '1' && (
        <p role="status" className="mb-4 rounded-md bg-success/10 p-3 text-sm text-success">
          Mot de passe changé : connectez-vous avec le nouveau.
        </p>
      )}
      <form onSubmit={submit} className="space-y-4">
        <FormRow label={t('auth.email')} htmlFor="email">
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            autoFocus
            className="h-10"
          />
        </FormRow>
        <FormRow label={t('auth.password')} htmlFor="password" error={error}>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="h-10"
          />
        </FormRow>
        <Button type="submit" size="lg" className="w-full" disabled={busy} aria-busy={busy}>
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          {t('auth.login')}
        </Button>
        <p className="text-center text-sm">
          <Link
            to="/mot-de-passe/oublie"
            className="text-primary underline-offset-4 hover:underline"
          >
            {t('auth.forgotPassword')}
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
