import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { client } from './api';

/** Instance courante (`/$app/...`) : client d'API, paramètres et permissions de l'appelant. */
export function useApp() {
  const { app = '' } = useParams({ strict: false }) as { app?: string };
  const api = client.app(app);
  const settings = useQuery({
    queryKey: [app, 'settings'],
    queryFn: api.settings.get,
    enabled: !!app,
  });
  const me = useQuery({
    queryKey: [app, 'me'],
    queryFn: api.me,
    enabled: !!app,
    staleTime: 60_000,
  });
  const permissions = new Set(me.data?.permissions ?? []);
  return {
    short: app,
    api,
    settings: settings.data,
    me: me.data,
    timeZone: settings.data?.timeZone ?? 'Africa/Abidjan',
    can: (permission: string) => permissions.has(permission),
  };
}
