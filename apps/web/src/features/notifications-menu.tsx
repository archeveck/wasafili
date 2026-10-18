import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type Notification } from '@tesserax/sdk';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/overlays';
import { useApp } from '@/lib/use-app';
import { cn, formatDateTime } from '@/lib/utils';

/** Centre de notifications du back-office (P4.5) ; rafraîchi toutes les minutes. */
export function NotificationsMenu() {
  const { api, short, timeZone } = useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const notifications = useQuery({
    queryKey: [short, 'notifications'],
    queryFn: () => api.notifications.list({ perPage: 20 }),
    refetchInterval: 60_000,
  });
  const read = useMutation({
    mutationFn: (ids?: string[]) => api.notifications.read(ids),
    onSettled: () => queryClient.invalidateQueries({ queryKey: [short, 'notifications'] }),
  });
  const unread = notifications.data?.meta.unread ?? 0;

  const open = (notification: Notification) => {
    if (!notification.readAt) read.mutate([notification.id]);
    if (notification.data.submissionId) {
      void navigate({
        to: '/$app/submissions/$submissionId',
        params: { app: short, submissionId: notification.data.submissionId },
      });
    } else if (notification.data.taskId) {
      void navigate({ to: '/$app/agenda', params: { app: short } });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread ? `Notifications (${unread} non lues)` : 'Notifications'}
        >
          <Bell />
          {unread > 0 && (
            <span className="absolute right-1 top-1 min-w-4 rounded-full bg-danger px-1 text-[10px] font-semibold leading-4 text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        <div className="flex items-center justify-between px-2 py-1.5">
          <p className="text-sm font-medium">Notifications</p>
          {unread > 0 && (
            <button
              type="button"
              className="text-xs text-primary"
              onClick={() => read.mutate(undefined)}
            >
              Tout marquer comme lu
            </button>
          )}
        </div>
        {(notifications.data?.data ?? []).length === 0 && (
          <p className="px-2 py-3 text-sm text-muted">Aucune notification.</p>
        )}
        {(notifications.data?.data ?? []).map((n) => (
          <DropdownMenuItem key={n.id} onSelect={() => open(n)} className="items-start">
            <span
              className={cn(
                'mt-1.5 size-2 shrink-0 rounded-full',
                n.readAt ? 'bg-transparent' : 'bg-primary',
              )}
            />
            <span className="min-w-0">
              <span className={cn('block text-sm', !n.readAt && 'font-medium')}>{n.title}</span>
              {n.body && <span className="block truncate text-xs text-muted">{n.body}</span>}
              <span className="block text-xs text-muted">
                {formatDateTime(n.createdAt, timeZone)}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
