import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { api, get } from '@/lib/api';
import { useRoom } from '@/lib/live';
import { photoUrl } from '@/lib/alumni';
import { cn, timeAgo } from '@/lib/utils';
import { Avatar } from '@/components/ui/display';
import { Menu, MenuContent, MenuTrigger } from '@/components/ui/overlay';
import type { Author } from '@/components/community';

export type NotificationT = { id: number; category: string; kind: string; title: string; body: string; link: string | null; actor: Author | null;
  read: boolean; created_at: string };
type Resp = { data: NotificationT[]; meta: { next_before: number | null; unread: number } };

export function NotificationRow({ n, onOpen }: { n: NotificationT; onOpen: (n: NotificationT) => void }) {
  return (
    <button onClick={() => onOpen(n)} className={cn('flex w-full gap-3 px-4 py-3 text-left hover:bg-canvas', !n.read && 'bg-primary-soft/40')}>
      <span className="relative shrink-0">
        {n.actor ? <Avatar name={n.actor.full_name} src={photoUrl(n.actor.photo, 72)} size={36} /> : <span className="grid h-9 w-9 place-items-center rounded-full bg-primary-soft text-primary"><Bell className="h-4 w-4" /></span>}
        {!n.read && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-primary" aria-label="Unread" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block text-sm text-ink', !n.read && 'font-medium')}>{n.title}</span>
        {n.body && <span className="line-clamp-2 block text-xs text-ink-muted">{n.body}</span>}
        <span className="mt-0.5 block text-[11px] text-ink-muted">{timeAgo(n.created_at)}</span>
      </span>
    </button>
  );
}

/** Bell with unread badge; refreshed live (notification:new) and every two minutes as a fallback. */
export function NotificationBell({ light }: { light?: boolean }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['notifications', 'bell'], queryFn: () => api<Resp>('/api/v1/notifications?limit=8'), refetchInterval: 120_000 });
  useRoom(null, { 'notification:new': () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const unread = list.data?.meta.unread ?? 0;
  const open = async (n: NotificationT) => {
    if (!n.read) await api(`/api/v1/notifications/${n.id}/read`, { method: 'POST' }).catch(() => undefined);
    qc.invalidateQueries({ queryKey: ['notifications'] });
    if (n.link) nav(n.link);
  };
  const readAll = async () => { await api('/api/v1/notifications/read-all', { method: 'POST' }); qc.invalidateQueries({ queryKey: ['notifications'] }); };
  return (
    <Menu>
      <MenuTrigger className={cn('relative rounded-full p-2 focus-visible:outline-none focus-visible:ring-2', light ? 'text-white hover:bg-white/10 focus-visible:ring-white/60' : 'text-ink hover:bg-canvas focus-visible:ring-primary/40')}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="absolute right-0.5 top-0.5 min-w-[18px] rounded-full bg-secondary px-1 text-center text-[10px] font-semibold leading-[18px] text-white">{unread > 99 ? '99+' : unread}</span>}
      </MenuTrigger>
      <MenuContent className="w-[min(380px,calc(100vw-1rem))] p-0">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="font-heading font-semibold text-ink">Notifications</span>
          {unread > 0 && <button onClick={readAll} className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"><CheckCheck className="h-3.5 w-3.5" />Mark all read</button>}
        </div>
        <div className="max-h-[60vh] divide-y divide-line overflow-y-auto">
          {!list.data?.data.length ? <p className="px-4 py-8 text-center text-sm text-ink-muted">You're all caught up.</p>
            : list.data.data.map((n) => <NotificationRow key={n.id} n={n} onOpen={open} />)}
        </div>
        <Link to="/portal/notifications" className="block border-t border-line px-4 py-2.5 text-center text-sm font-medium text-primary hover:bg-canvas">See all notifications</Link>
      </MenuContent>
    </Menu>
  );
}

export const notificationsPrefs = () => get<{ category: string; label: string; description: string; in_app: boolean; email: boolean }[]>('/api/v1/notifications/preferences');
