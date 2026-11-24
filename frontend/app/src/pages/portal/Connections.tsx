import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Clock, Inbox, Search, Send, Star, UserMinus, Users } from 'lucide-react';
import { api, qs, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useDebounced } from '@/lib/hooks';
import type { PersonCard } from '@/lib/alumni';
import { timeAgo } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/display';
import { Input } from '@/components/ui/form';
import { Tabs, useConfirm } from '@/components/ui/overlay';
import { Pagination } from '@/components/ui/table';
import { NoAccess, PersonTile } from '@/components/alumni';

type Item = PersonCard & { request_id?: string; message?: string | null; since: string };
type Resp = Paged<Item> & { meta: Paged<Item>['meta'] & { counts: { received: number; connected: number } } };
const TABS = ['connected', 'received', 'sent', 'following', 'followers'] as const;
const EMPTY: Record<string, [string, string]> = {
  connected: ['No connections yet', 'Find batchmates and colleagues in the directory.'],
  received: ['No pending requests', 'Requests from other alumni appear here.'],
  sent: ['No requests sent', 'Requests you send wait here until they are answered.'],
  following: ['Not following anyone', 'Follow alumni to keep up with their news.'],
  followers: ['No followers yet', 'Members who follow you appear here.'],
};

export function ConnectionsPage() {
  const { tab = 'connected' } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const confirm = useConfirm();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const type = (TABS as readonly string[]).includes(tab) ? tab : 'connected';
  const params = { type, q: dq, page, page_size: 20 };
  const list = useQuery({ queryKey: ['connections', params], queryFn: () => api<Resp>(`/api/v1/alumni/connections${qs(params)}`),
    placeholderData: keepPreviousData, enabled: can('portal.directory') });
  const remove = useAction((id: string) => api(`/api/v1/alumni/connections/${id}`, { method: 'DELETE' }),
    { success: 'Done.', invalidate: [['connections'], ['alumni-dashboard']] });
  const unfollow = useAction((id: string) => api(`/api/v1/alumni/profiles/${id}/follow`, { method: 'DELETE' }),
    { invalidate: [['connections']] });
  if (!can('portal.directory')) return <><PageHeader title="My Network" /><NoAccess /></>;
  const counts = list.data?.meta.counts;
  const [title, desc] = EMPTY[type]!;

  const actionsFor = (p: Item) => {
    if (type === 'connected') return <Button size="sm" variant="ghost" onClick={async () => { if (await confirm({ title: 'Remove connection', description: `You and ${p.full_name} will no longer be connected.`, confirmLabel: 'Remove', danger: true })) remove.mutate(p.request_id!); }}><UserMinus />Remove</Button>;
    if (type === 'sent') return <Button size="sm" variant="outline" onClick={() => remove.mutate(p.request_id!)}><Clock />Withdraw</Button>;
    if (type === 'following') return <Button size="sm" variant="ghost" onClick={() => unfollow.mutate(p.id)}><Star />Unfollow</Button>;
    return undefined; // received / followers: standard relation buttons
  };

  return (
    <>
      <PageHeader title="My Network" description="Your connections, requests and the people you follow."
        actions={<Button asChild variant="outline"><Link to="/portal/directory"><Search />Find alumni</Link></Button>} />
      <Card>
        <div className="px-4 pt-2">
          <Tabs value={type} onValueChange={(v) => { setPage(1); nav(v === 'connected' ? '/portal/connections' : `/portal/connections/${v}`); }}
            tabs={[
              { value: 'connected', label: <span className="flex items-center gap-1.5"><Users className="h-4 w-4" />Connections{counts ? ` (${counts.connected})` : ''}</span> },
              { value: 'received', label: <span className="flex items-center gap-1.5"><Inbox className="h-4 w-4" />Requests{counts?.received ? <span className="rounded-full bg-primary px-1.5 text-[11px] text-white">{counts.received}</span> : ''}</span> },
              { value: 'sent', label: <span className="flex items-center gap-1.5"><Send className="h-4 w-4" />Sent</span> },
              { value: 'following', label: 'Following' }, { value: 'followers', label: 'Followers' },
            ]}><span /></Tabs>
        </div>
        <div className="border-b border-line p-4">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <Input aria-label="Search by name" placeholder="Search by name…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="pl-9" />
          </div>
        </div>
        {list.isLoading ? <div className="space-y-3 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
          : list.data?.data.length === 0 ? <EmptyState icon={Users} title={q ? 'No matches' : title} description={q ? 'Try another name.' : desc} />
          : (
            <ul className="divide-y divide-line">
              {list.data?.data.map((p) => (
                <li key={p.id}>
                  <PersonTile p={p} view="list" actions={actionsFor(p)} />
                  {type === 'received' && p.message && <p className="-mt-2 px-4 pb-3 pl-[76px] text-sm text-ink">“{p.message}” <span className="text-xs text-ink-muted">· {timeAgo(p.since)}</span></p>}
                </li>
              ))}
            </ul>
          )}
        {list.data && <Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={setPage} />}
      </Card>
    </>
  );
}
