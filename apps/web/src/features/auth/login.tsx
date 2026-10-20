import { useNavigate, useSearch } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { ApiError } from '@wasafili/sdk';
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
    <main className="grid min-h-full lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <section
        className="relative hidden overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex lg:flex-col lg:justify-between"
        aria-hidden
      >
        <div
          className="pointer-events-none absolute -right-32 -top-32 size-96 rounded-full bg-accent/20 blur-3xl"
          aria-hidden
        />
        <div className="relative flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-md bg-white/10 font-semibold ring-1 ring-white/15">
            {t('app.name').charAt(0)}
          </span>
          <span className="text-lg font-semibold tracking-tight text-white">{t('app.name')}</span>
        </div>
        <div className="relative max-w-sm">
          <p className="text-3xl font-semibold leading-tight tracking-tight text-white">
            Back-office de collecte terrain
          </p>
          <p className="mt-3 text-sm text-sidebar-muted">
            Formulaires, fiches, tableaux de bord et équipes réunis dans un même espace.
          </p>
        </div>
        <p className="relative text-xs text-sidebar-muted">
          © {new Date().getFullYear()} {t('app.name')}
        </p>
      </section>
      <div className="flex items-center justify-center p-4 sm:p-8">
        <Card className="w-full max-w-sm p-8 shadow-sm lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
          <h1 className="mb-1 text-2xl font-semibold tracking-tight text-primary">
            {t('app.name')}
          </h1>
          <p className="mb-8 text-sm text-muted">Back-office de collecte terrain</p>
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
          </form>
        </Card>
      </div>
    </main>
  );
}
