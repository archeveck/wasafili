import { useNavigate, useSearch } from '@tanstack/react-router';
import { ApiError } from '@tesserax/sdk';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/display';
import { FormRow, Input } from '@/components/ui/form-controls';
import { client } from '@/lib/api';

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { redirect?: string };
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
    <main className="flex min-h-full items-center justify-center p-4">
      <Card className="w-full max-w-sm p-8">
        <h1 className="mb-1 text-2xl font-semibold text-primary">{t('app.name')}</h1>
        <p className="mb-6 text-sm text-muted">Back-office de collecte terrain</p>
        <form onSubmit={submit} className="space-y-4">
          <FormRow label={t('auth.email')} htmlFor="email">
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              autoFocus
            />
          </FormRow>
          <FormRow label={t('auth.password')} htmlFor="password" error={error}>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </FormRow>
          <Button type="submit" className="w-full" disabled={busy}>
            {t('auth.login')}
          </Button>
        </form>
      </Card>
    </main>
  );
}
