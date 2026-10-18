import { useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import {
  CalendarDays,
  ClipboardList,
  FolderTree,
  LogOut,
  type LucideIcon,
  Settings,
  ShieldCheck,
  UserCircle,
  Users,
  UsersRound,
} from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/overlays';
import { client } from '@/lib/api';
import { useApp } from '@/lib/use-app';
import { NotificationsMenu } from './notifications-menu';

const NAV: { to: string; label: string; icon: LucideIcon; permission: string | string[] }[] = [
  {
    to: '/$app/structures',
    label: 'Formulaires',
    icon: ClipboardList,
    permission: 'structure:read',
  },
  {
    to: '/$app/agenda',
    label: 'Agenda',
    icon: CalendarDays,
    permission: ['task:read', 'task:manage'],
  },
  { to: '/$app/lists', label: 'Référentiels', icon: FolderTree, permission: 'list:read' },
  { to: '/$app/users', label: 'Utilisateurs', icon: Users, permission: 'user:read' },
  { to: '/$app/groups', label: 'Groupes', icon: UsersRound, permission: 'group:read' },
  { to: '/$app/roles', label: 'Rôles', icon: ShieldCheck, permission: 'role:read' },
  { to: '/$app/settings', label: 'Paramètres', icon: Settings, permission: 'instance:manage' },
];

/** Gabarit des pages d'une instance : navigation selon les permissions, couleurs de l'instance. */
export function AppLayout() {
  const { t } = useTranslation();
  const { short, settings, me, can } = useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    const root = document.documentElement.style;
    if (settings?.branding.primaryColor)
      root.setProperty('--brand-primary', settings.branding.primaryColor);
    else root.removeProperty('--brand-primary');
    if (settings?.branding.accentColor)
      root.setProperty('--brand-accent', settings.branding.accentColor);
    else root.removeProperty('--brand-accent');
  }, [settings]);

  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-border bg-surface">
        <div className="flex items-start gap-2 border-b border-border px-4 py-4">
          <div className="min-w-0 flex-1">
            <Link to="/" className="text-lg font-semibold text-primary">
              {t('app.name')}
            </Link>
            <p className="truncate text-xs text-muted">{settings?.name ?? short}</p>
          </div>
          <NotificationsMenu />
        </div>
        <nav className="flex-1 space-y-0.5 p-2" aria-label="Navigation principale">
          {NAV.filter((item) => [item.permission].flat().some(can)).map(
            ({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                params={{ app: short }}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted hover:bg-subtle hover:text-foreground"
                activeProps={{
                  className: 'bg-primary/10 font-medium text-primary hover:bg-primary/10',
                }}
              >
                <Icon className="size-4" /> {label}
              </Link>
            ),
          )}
        </nav>
        <div className="border-t border-border p-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="w-full justify-start">
                <UserCircle />{' '}
                <span className="truncate">{me ? `${me.firstName} ${me.lastName}` : '…'}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onSelect={async () => {
                  await client.logout();
                  queryClient.clear();
                  await navigate({ to: '/login' });
                }}
              >
                <LogOut /> {t('auth.logout')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-6 lg:p-8">
        <Outlet />
      </main>
    </div>
  );
}
