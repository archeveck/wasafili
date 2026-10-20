import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/display';

/** Mise en page des écrans sans session : connexion, mot de passe oublié, nouveau mot de passe. */
export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
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
          <h1 className="mb-1 text-2xl font-semibold tracking-tight text-primary">{title}</h1>
          <p className="mb-8 text-sm text-muted">{subtitle}</p>
          {children}
        </Card>
      </div>
    </main>
  );
}
