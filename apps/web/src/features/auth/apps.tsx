import { useQuery } from '@tanstack/react-query';
import { Link, Navigate } from '@tanstack/react-router';
import { Building2, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, EmptyState, ErrorMessage, Loading } from '@/components/ui/display';
import { client } from '@/lib/api';

/** Sélection de l'instance ; redirection directe s'il n'y en a qu'une. */
export function AppsPage() {
  const { t } = useTranslation();
  const apps = useQuery({ queryKey: ['apps'], queryFn: client.apps });
  if (apps.isPending) return <Loading />;
  if (apps.error) return <ErrorMessage error={apps.error} />;
  if (apps.data.data.length === 1)
    return <Navigate to="/$app" params={{ app: apps.data.data[0]!.short }} />;
  return (
    <main className="mx-auto max-w-lg px-4 py-12 sm:py-20">
      <p className="mb-1 text-sm font-semibold tracking-tight text-primary">{t('app.name')}</p>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{t('auth.selectInstance')}</h1>
      {apps.data.data.length === 0 && <EmptyState title="Aucun espace accessible" />}
      <div className="space-y-2">
        {apps.data.data.map((app) => (
          <Link
            key={app.id}
            to="/$app"
            params={{ app: app.short }}
            className="group block rounded-lg focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-accent/35"
          >
            <Card className="flex items-center gap-3 p-4 transition-[border-color,box-shadow] group-hover:border-primary/40 group-hover:shadow-sm">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Building2 className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{app.name}</p>
                <p className="text-xs text-muted">{app.short}</p>
              </div>
              <ChevronRight className="size-4 text-muted transition-transform group-hover:translate-x-0.5" />
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
