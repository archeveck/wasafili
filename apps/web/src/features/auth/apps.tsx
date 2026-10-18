import { useQuery } from '@tanstack/react-query';
import { Link, Navigate } from '@tanstack/react-router';
import { Building2 } from 'lucide-react';
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
    <main className="mx-auto max-w-lg p-8">
      <h1 className="mb-4 text-xl font-semibold">{t('auth.selectInstance')}</h1>
      {apps.data.data.length === 0 && <EmptyState title="Aucun espace accessible" />}
      <div className="space-y-2">
        {apps.data.data.map((app) => (
          <Link key={app.id} to="/$app" params={{ app: app.short }}>
            <Card className="flex items-center gap-3 p-4 hover:border-primary">
              <Building2 className="size-5 text-primary" />
              <div>
                <p className="font-medium">{app.name}</p>
                <p className="text-xs text-muted">{app.short}</p>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
