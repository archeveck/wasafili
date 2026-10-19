import { useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import {
  CalendarDays,
  History,
  KeyRound,
  LayoutDashboard,
  MapPinned,
  Workflow,
  ClipboardList,
  FolderTree,
  LogOut,
  Menu,
  type LucideIcon,
  Settings,
  ShieldCheck,
  UserCircle,
  Users,
  UsersRound,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
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
import { cn } from '@/lib/utils';
import { PasswordDialog } from './account/password-dialog';
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
  {
    to: '/$app/dashboards',
    label: 'Tableaux de bord',
    icon: LayoutDashboard,
    permission: 'structure:read',
  },
  { to: '/$app/team', label: 'Équipes terrain', icon: MapPinned, permission: 'user:read' },
  { to: '/$app/lists', label: 'Référentiels', icon: FolderTree, permission: 'list:read' },
  {
    to: '/$app/automations',
    label: 'Automatisations',
    icon: Workflow,
    permission: 'automation:manage',
  },
  { to: '/$app/users', label: 'Utilisateurs', icon: Users, permission: 'user:read' },
  { to: '/$app/groups', label: 'Groupes', icon: UsersRound, permission: 'group:read' },
  { to: '/$app/roles', label: 'Rôles', icon: ShieldCheck, permission: 'role:read' },
  { to: '/$app/settings', label: 'Paramètres', icon: Settings, permission: 'instance:manage' },
  { to: '/$app/api-keys', label: 'Clés API', icon: KeyRound, permission: 'apikey:manage' },
  { to: '/$app/audit', label: 'Journal d’audit', icon: History, permission: 'audit:read' },
];

/** Gabarit des pages d'une instance : navigation selon les permissions, couleurs de l'instance. */
export function AppLayout() {
  const { t } = useTranslation();
  const { short, settings, me, can } = useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [changingPassword, setChangingPassword] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    const root = document.documentElement.style;
    if (settings?.branding.primaryColor)
      root.setProperty('--brand-primary', settings.branding.primaryColor);
    else root.removeProperty('--brand-primary');
    if (settings?.branding.accentColor)
      root.setProperty('--brand-accent', settings.branding.accentColor);
    else root.removeProperty('--brand-accent');
  }, [settings]);

  useEffect(() => {
    if (!navOpen) return;
    const close = (event: KeyboardEvent) => event.key === 'Escape' && setNavOpen(false);
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [navOpen]);

  return (
    <div className="flex min-h-full">
      {navOpen && (
        <div
          className="fixed inset-0 z-30 animate-overlay-in bg-sidebar/55 backdrop-blur-[2px] lg:hidden"
          aria-hidden
          onClick={() => setNavOpen(false)}
        />
      )}
      <aside
        id="app-navigation"
        className={cn(
          'fixed inset-y-0 left-0 z-40 h-screen w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground shadow-xl lg:sticky lg:top-0 lg:z-auto lg:flex lg:w-60 lg:shadow-none',
          navOpen ? 'flex animate-overlay-in' : 'hidden',
        )}
      >
        <div className="flex items-center gap-2 px-4 pb-4 pt-5">
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-md bg-white/10 text-sm font-semibold ring-1 ring-white/15"
            aria-hidden
          >
            {t('app.name').charAt(0)}
          </span>
          <div className="min-w-0 flex-1">
            <Link
              to="/"
              className="block text-[15px] font-semibold leading-tight tracking-tight text-white"
            >
              {t('app.name')}
            </Link>
            <p className="truncate text-xs text-sidebar-muted">{settings?.name ?? short}</p>
          </div>
          <NotificationsMenu />
          <Button
            variant="ghost"
            size="icon"
            className="text-sidebar-muted hover:bg-white/10 hover:text-white lg:hidden"
            aria-label="Fermer le menu"
            onClick={() => setNavOpen(false)}
          >
            <X />
          </Button>
        </div>
        <nav
          className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2"
          aria-label="Navigation principale"
        >
          {NAV.filter((item) => [item.permission].flat().some(can)).map(
            ({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                params={{ app: short }}
                onClick={() => setNavOpen(false)}
                className="group relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-sidebar-muted transition-colors hover:bg-white/[0.06] hover:text-white"
                activeProps={{
                  className:
                    'bg-white/10 font-medium text-white before:absolute before:inset-y-1.5 before:-left-3 before:w-[3px] before:rounded-r-full before:bg-accent',
                }}
              >
                <Icon className="size-4 shrink-0 opacity-80 group-hover:opacity-100" /> {label}
              </Link>
            ),
          )}
        </nav>
        <div className="border-t border-white/10 p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="w-full justify-start text-sidebar-foreground hover:bg-white/[0.06] hover:text-white active:bg-white/10"
              >
                <UserCircle className="text-sidebar-muted" />{' '}
                <span className="truncate">{me ? `${me.firstName} ${me.lastName}` : '…'}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top">
              {me?.email && (
                <DropdownMenuItem onSelect={() => setChangingPassword(true)}>
                  <KeyRound /> Changer mon mot de passe
                </DropdownMenuItem>
              )}
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
          {me?.email && (
            <PasswordDialog
              email={me.email}
              open={changingPassword}
              onOpenChange={setChangingPassword}
            />
          )}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-surface/90 px-4 backdrop-blur lg:hidden">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Ouvrir le menu"
            aria-controls="app-navigation"
            aria-expanded={navOpen}
            onClick={() => setNavOpen(true)}
          >
            <Menu />
          </Button>
          <span className="truncate font-semibold tracking-tight text-primary">
            {settings?.name ?? short}
          </span>
        </header>
        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
