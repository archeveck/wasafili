import { type QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { AppsPage } from '@/features/auth/apps';
import { LoginPage } from '@/features/auth/login';
import { AccessPage } from '@/features/admin/access-page';
import { GroupsPage } from '@/features/admin/groups-page';
import { RolesPage } from '@/features/admin/roles-page';
import { SettingsPage } from '@/features/admin/settings-page';
import { UsersPage } from '@/features/admin/users-page';
import { DesignerPage } from '@/features/designer/designer-page';
import { AppLayout } from '@/features/layout';
import { ListPage } from '@/features/lists/list-page';
import { ListsPage } from '@/features/lists/lists-page';
import { StructuresPage } from '@/features/structures/structures-page';
import { NewSubmissionPage, SubmissionPage } from '@/features/submissions/submission-page';
import { SubmissionsPage } from '@/features/submissions/submissions-page';
import { AgendaPage } from '@/features/tasks/agenda-page';
import { client } from '@/lib/api';

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({ component: Outlet });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (search: Record<string, unknown>) => ({
    ...(typeof search['redirect'] === 'string' ? { redirect: search['redirect'] } : {}),
  }),
  component: LoginPage,
});

/** Routes authentifiées : sans session, retour à la connexion. */
const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_auth',
  beforeLoad: ({ location }) => {
    if (!client.isAuthenticated())
      throw redirect({ to: '/login', search: { redirect: location.href } });
  },
  component: Outlet,
});

const appsRoute = createRoute({ getParentRoute: () => authRoute, path: '/', component: AppsPage });
const appRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '$app',
  component: AppLayout,
});
const appIndexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/$app/structures', params });
  },
});

// Routes déclarées une à une : TanStack Router type les chemins à partir des littéraux.
const structuresRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'structures',
  component: StructuresPage,
});
const designerRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'structures/$structureId/designer',
  component: DesignerPage,
});
const accessRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'structures/$structureId/access',
  component: AccessPage,
});
const submissionsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'structures/$structureId/submissions',
  component: SubmissionsPage,
});
const newSubmissionRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'structures/$structureId/submissions/new',
  component: NewSubmissionPage,
});
const submissionRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'submissions/$submissionId',
  component: SubmissionPage,
});
const agendaRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'agenda',
  component: AgendaPage,
});
const listsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'lists',
  component: ListsPage,
});
const listRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'lists/$listId',
  component: ListPage,
});
const usersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'users',
  component: UsersPage,
});
const groupsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'groups',
  component: GroupsPage,
});
const rolesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'roles',
  component: RolesPage,
});
const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'settings',
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  authRoute.addChildren([
    appsRoute,
    appRoute.addChildren([
      appIndexRoute,
      structuresRoute,
      designerRoute,
      accessRoute,
      submissionsRoute,
      newSubmissionRoute,
      submissionRoute,
      agendaRoute,
      listsRoute,
      listRoute,
      usersRoute,
      groupsRoute,
      rolesRoute,
      settingsRoute,
    ]),
  ]),
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({ routeTree, context: { queryClient }, defaultPreload: 'intent' });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
