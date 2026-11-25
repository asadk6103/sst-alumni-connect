import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, Mail, Newspaper } from 'lucide-react';
import { api, get } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, EmptyState, PageHeader, Skeleton } from '@/components/ui/display';
import { Checkbox, Switch } from '@/components/ui/form';
import { Tabs } from '@/components/ui/overlay';
import { NotificationRow, notificationsPrefs, type NotificationT } from '@/components/notifications';

export function NotificationsPage() {
  const [tab, setTab] = useState('all');
  return (
    <>
      <PageHeader title="Notifications" description="Everything that happened while you were away — and how you want to hear about it." />
      <Tabs value={tab} onValueChange={setTab} tabs={[{ value: 'all', label: 'All' }, { value: 'unread', label: 'Unread' }, { value: 'settings', label: 'Preferences' }]}><span /></Tabs>
      <div className="mt-5 max-w-3xl">{tab === 'settings' ? <Preferences /> : <List unread={tab === 'unread'} />}</div>
    </>
  );
}

function List({ unread }: { unread: boolean }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useInfiniteQuery({
    queryKey: ['notifications', 'page', unread], initialPageParam: 0,
    queryFn: ({ pageParam }) => api<{ data: NotificationT[]; meta: { next_before: number | null; unread: number } }>(`/api/v1/notifications?limit=20${unread ? '&unread=true' : ''}${pageParam ? `&before=${pageParam}` : ''}`),
    getNextPageParam: (last) => last.meta.next_before ?? undefined,
  });
  const readAll = useAction(() => api('/api/v1/notifications/read-all', { method: 'POST' }), { invalidate: [['notifications']] });
  const items = q.data?.pages.flatMap((p) => p.data) ?? [];
  const open = async (n: NotificationT) => {
    if (!n.read) await api(`/api/v1/notifications/${n.id}/read`, { method: 'POST' }).catch(() => undefined);
    qc.invalidateQueries({ queryKey: ['notifications'] });
    if (n.link) nav(n.link);
  };
  return (
    <Card>
      <CardHeader title={unread ? 'Unread' : 'All notifications'} icon={Bell}
        action={(q.data?.pages[0]?.meta.unread ?? 0) > 0 && <Button size="sm" variant="outline" onClick={() => readAll.mutate(undefined)}><CheckCheck />Mark all read</Button>} />
      {q.isLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : !items.length ? <EmptyState icon={Bell} title={unread ? 'No unread notifications' : 'No notifications yet'} /> : (
        <div className="divide-y divide-line">{items.map((n) => <NotificationRow key={n.id} n={n} onOpen={open} />)}</div>
      )}
      {q.hasNextPage && <div className="border-t border-line p-3 text-center"><Button variant="outline" size="sm" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>Load more</Button></div>}
    </Card>
  );
}

function Preferences() {
  const prefs = useQuery({ queryKey: ['notification-prefs'], queryFn: notificationsPrefs });
  const news = useQuery({ queryKey: ['newsletter-me'], queryFn: () => get<{ subscribed: boolean; email: string }>('/api/v1/newsletter/me') });
  const save = useAction((body: { category: string; in_app: boolean; email: boolean }) => api('/api/v1/notifications/preferences', { method: 'PUT', body: [body] }),
    { success: 'Saved.', invalidate: [['notification-prefs']] });
  const sub = useAction((subscribed: boolean) => api('/api/v1/newsletter/me', { method: 'PUT', body: { subscribed } }),
    { success: 'Saved.', invalidate: [['newsletter-me']] });
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="What we notify you about" icon={Mail} description="Security emails (password changes, sign-ins from new devices) are always sent." />
        {!prefs.data ? <div className="p-4"><Skeleton className="h-40" /></div> : (
          <ul className="divide-y divide-line">{prefs.data.map((p) => (
            <li key={p.category} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1"><p className="font-medium text-ink">{p.label}</p><p className="text-xs text-ink-muted">{p.description}</p></div>
              <div className="flex gap-5">
                <Checkbox checked={p.in_app} label="In the app" onCheckedChange={(v) => save.mutate({ category: p.category, in_app: v, email: p.email })} />
                <Checkbox checked={p.email} label="By email" onCheckedChange={(v) => save.mutate({ category: p.category, in_app: p.in_app, email: v })} />
              </div>
            </li>))}</ul>
        )}
      </Card>
      <Card className="p-5">
        <div className="flex items-start gap-3"><Newspaper className="mt-0.5 h-5 w-5 text-primary" />
          <div className="flex-1">{news.data && <Switch checked={news.data.subscribed} onCheckedChange={(v) => sub.mutate(v)} label="Alumni newsletter"
            description={`News, events and stories from the alumni office, sent to ${news.data.email}. You can unsubscribe at any time.`} />}</div></div>
      </Card>
    </div>
  );
}
