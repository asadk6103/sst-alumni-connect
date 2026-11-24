import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Check, EyeOff, Flag, History, Megaphone, MessagesSquare, Pin, PinOff, Plus, RotateCcw, Search, Trash2, Users, X } from 'lucide-react';
import { api, qs, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useDebounced } from '@/lib/hooks';
import { fmtDateTime, timeAgo } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, PageHeader, Skeleton, StatTile } from '@/components/ui/display';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog, Tabs } from '@/components/ui/overlay';
import { DataTable, Pagination } from '@/components/ui/table';
import { Composer, PostCard, RichText, type Author, type CommentT, type GroupT, type PostT } from '@/components/community';

export function CommunityAdminPage() {
  const { tab = 'reports' } = useParams();
  const nav = useNavigate();
  return (
    <>
      <PageHeader title="Community Moderation" description="Reports, posts, groups and announcements." />
      <Tabs value={tab} onValueChange={(v) => nav(v === 'reports' ? '/admin/community' : `/admin/community/${v}`)}
        tabs={[{ value: 'reports', label: 'Reports' }, { value: 'posts', label: 'Posts' }, { value: 'groups', label: 'Groups' },
          { value: 'announcements', label: 'Announcements' }, { value: 'log', label: 'Moderation log' }]}><span /></Tabs>
      <div className="mt-5">
        {tab === 'posts' ? <Posts /> : tab === 'groups' ? <Groups /> : tab === 'announcements' ? <Announcements /> : tab === 'log' ? <Log /> : <Reports />}
      </div>
    </>
  );
}

type ReportRow = { target_type: 'post' | 'comment'; target_id: string; count: number; last_reported_at: string;
  reasons: { reason: string; details: string | null; reporter: Author | null; created_at: string }[]; post?: PostT; comment?: CommentT; missing?: boolean };

function Reports() {
  const { can } = useAuth();
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const [deciding, setDeciding] = useState<{ r: ReportRow; action: 'hide' | 'delete' } | null>(null);
  const list = useQuery({ queryKey: ['admin-community', 'reports', status, page], queryFn: () => api<Paged<ReportRow>>(`/api/v1/admin/community/reports${qs({ status, page })}`), placeholderData: keepPreviousData });
  const dismiss = useAction((r: ReportRow) => api(`/api/v1/admin/community/reports/${r.target_type}/${r.target_id}`, { method: 'POST', body: { action: 'dismiss' } }),
    { success: 'Report dismissed.', invalidate: [['admin-community']] });
  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-44">
          <option value="open">Open</option><option value="actioned">Actioned</option><option value="dismissed">Dismissed</option></Select>
        {list.data && <span className="text-sm text-ink-muted">{list.data.meta.total} reported item(s)</span>}
      </div>
      {list.isLoading ? <Skeleton className="h-64 rounded-card" /> : !list.data?.data.length ? <Card><EmptyState icon={Flag} title={status === 'open' ? 'No open reports' : 'Nothing here'} description="Reported posts and comments appear here." /></Card> : (
        <div className="space-y-4">
          {list.data.data.map((r) => (
            <Card key={r.target_id} className="grid gap-4 p-4 lg:grid-cols-[1fr_300px]">
              <div className="min-w-0">
                {r.missing ? <p className="text-sm text-ink-muted">The content no longer exists.</p>
                  : r.post ? <PostCard post={r.post} compact />
                  : r.comment && <div className="rounded-card bg-canvas p-3"><p className="text-xs font-medium text-ink-muted">Comment by {r.comment.author?.full_name}</p><RichText text={r.comment.body} className="text-sm" /></div>}
              </div>
              <div className="space-y-3">
                <p className="flex items-center gap-2 text-sm font-medium text-ink"><Flag className="h-4 w-4 text-danger" />{r.count} report{r.count === 1 ? '' : 's'} · {timeAgo(r.last_reported_at)}</p>
                <ul className="max-h-40 space-y-2 overflow-y-auto text-sm">
                  {r.reasons.map((x, i) => <li key={i}><Badge tone="danger" className="capitalize">{x.reason}</Badge> <span className="text-xs text-ink-muted">by {x.reporter?.full_name ?? 'member'}</span>{x.details && <p className="mt-0.5 text-xs text-ink">{x.details}</p>}</li>)}
                </ul>
                {status === 'open' && !r.missing && (
                  <div className="flex flex-wrap gap-2">
                    {can('community.edit') && <Button size="sm" variant="outline" onClick={() => setDeciding({ r, action: 'hide' })}><EyeOff />Hide</Button>}
                    {can('community.delete') && <Button size="sm" variant="danger-outline" onClick={() => setDeciding({ r, action: 'delete' })}><Trash2 />Delete</Button>}
                    {can('community.reject') && <Button size="sm" variant="ghost" onClick={() => dismiss.mutate(r)}><X />Dismiss</Button>}
                  </div>
                )}
              </div>
            </Card>
          ))}
          <Card><Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={setPage} /></Card>
        </div>
      )}
      {deciding && <ReasonDialog title={deciding.action === 'hide' ? 'Hide content' : 'Delete content'} danger={deciding.action === 'delete'}
        hint={deciding.action === 'hide' ? 'The author sees the reason; others no longer see the content.' : 'The content is removed for everyone.'}
        onClose={() => setDeciding(null)} url={`/api/v1/admin/community/reports/${deciding.r.target_type}/${deciding.r.target_id}`} action={deciding.action} />}
    </>
  );
}

function ReasonDialog({ title, hint, url, action, danger, onClose }: { title: string; hint: string; url: string; action: string; danger?: boolean; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const run = useAction(() => api(url, { method: 'POST', body: { action, reason: reason || null } }), { success: 'Done.', invalidate: [['admin-community'], ['feed']], onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={title} description={hint}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} loading={run.isPending} onClick={() => run.mutate(undefined)}>Confirm</Button></>}>
      <Field label="Reason (optional)">{(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. Advertising is not allowed in the community." />}</Field>
    </Dialog>
  );
}

function Posts() {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [acting, setActing] = useState<{ p: PostT; action: string } | null>(null);
  const dq = useDebounced(q);
  const params = { q: dq, status, page, page_size: 10 };
  const list = useQuery({ queryKey: ['admin-community', 'posts', params], queryFn: () => api<Paged<PostT>>(`/api/v1/admin/community/posts${qs(params)}`), placeholderData: keepPreviousData });
  const quick = useAction(({ p, action }: { p: PostT; action: string }) => api(`/api/v1/admin/community/posts/${p.id}/moderate`, { method: 'POST', body: { action } }),
    { success: 'Done.', invalidate: [['admin-community'], ['feed']] });
  return (
    <>
      <Card className="mb-4 flex flex-col gap-3 p-3 sm:flex-row">
        <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <Input aria-label="Search posts" placeholder="Search text or author…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="pl-9" /></div>
        <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="sm:w-44">
          <option value="">Any status</option><option value="published">Published</option><option value="hidden">Hidden</option><option value="deleted">Deleted</option></Select>
      </Card>
      {list.isLoading ? <Skeleton className="h-64 rounded-card" /> : !list.data?.data.length ? <Card><EmptyState icon={MessagesSquare} title="No posts found" /></Card> : (
        <div className="space-y-3">
          {list.data.data.map((p) => (
            <Card key={p.id} className="grid gap-3 p-4 lg:grid-cols-[1fr_auto]">
              <div className="min-w-0"><PostCard post={p} compact /></div>
              <div className="flex flex-wrap items-start gap-2 lg:w-40 lg:flex-col">
                <Badge tone={p.status === 'published' ? 'success' : p.status === 'hidden' ? 'warning' : 'neutral'}>{p.status}</Badge>
                <span className="text-xs text-ink-muted">{p.reaction_count} reactions · {p.comment_count} comments</span>
                {p.status === 'published' && can('community.edit') && <Button size="sm" variant="outline" onClick={() => setActing({ p, action: 'hide' })}><EyeOff />Hide</Button>}
                {p.status === 'hidden' && can('community.edit') && <Button size="sm" variant="outline" onClick={() => quick.mutate({ p, action: 'restore' })}><RotateCcw />Restore</Button>}
                {p.status === 'published' && can('community.publish') && <Button size="sm" variant="ghost" onClick={() => quick.mutate({ p, action: p.is_pinned ? 'unpin' : 'pin' })}>{p.is_pinned ? <><PinOff />Unpin</> : <><Pin />Pin</>}</Button>}
                {p.status !== 'deleted' && can('community.delete') && <Button size="sm" variant="danger-outline" onClick={() => setActing({ p, action: 'delete' })}><Trash2 />Delete</Button>}
              </div>
            </Card>
          ))}
          <Card><Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={setPage} /></Card>
        </div>
      )}
      {acting && <ReasonDialog title={acting.action === 'hide' ? 'Hide post' : 'Delete post'} danger={acting.action === 'delete'}
        hint={acting.action === 'hide' ? 'The author sees the reason.' : 'The post is removed for everyone.'}
        url={`/api/v1/admin/community/posts/${acting.p.id}/moderate`} action={acting.action} onClose={() => setActing(null)} />}
    </>
  );
}

type AdminGroup = GroupT & { created_by: Author | null };

function Groups() {
  const { can } = useAuth();
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ['admin-community', 'groups', status, page], queryFn: () => api<Paged<AdminGroup> & { meta: { counts: Record<string, number> } }>(`/api/v1/admin/community/groups${qs({ status, page })}`), placeholderData: keepPreviousData });
  const decide = useAction(({ g, action }: { g: AdminGroup; action: string }) => api(`/api/v1/admin/community/groups/${g.id}/decide`, { method: 'POST', body: { action } }),
    { success: 'Done.', invalidate: [['admin-community'], ['groups']] });
  const counts = list.data?.meta.counts ?? {};
  return (
    <>
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        {(['pending', 'active', 'archived'] as const).map((s) => (
          <button key={s} className="text-left" onClick={() => { setStatus(s); setPage(1); }} aria-pressed={status === s}>
            <StatTile icon={Users} tone={s === 'pending' ? 'warning' : s === 'active' ? 'success' : 'navy'} value={counts[s] ?? 0}
              label={`${s === 'pending' ? 'Waiting for approval' : s === 'active' ? 'Active groups' : 'Archived'}${status === s ? ' · showing' : ''}`} />
          </button>
        ))}
      </div>
      <Card>
        <div className="flex justify-end border-b border-line p-3">{can('community.approve') && <Button onClick={() => setCreating(true)}><Plus />New group</Button>}</div>
        <DataTable rows={list.data?.data} loading={list.isLoading} rowKey={(g) => g.id}
          empty={<EmptyState icon={Users} title={status === 'pending' ? 'No groups waiting' : 'No groups'} />}
          columns={[
            { key: 'name', header: 'Group', cell: (g) => <div className="max-w-sm"><p className="font-medium">{g.name}</p><p className="line-clamp-2 text-xs text-ink-muted">{g.description}</p></div> },
            { key: 'kind', header: 'Type', cell: (g) => <Badge className="capitalize">{g.kind}</Badge> },
            { key: 'members', header: 'Members', cell: (g) => `${g.member_count} · ${g.post_count} posts` },
            { key: 'by', header: 'Created by', hideOnMobile: true, cell: (g) => <span className="text-ink-muted">{g.created_by?.full_name ?? 'System'}</span> },
            { key: 'act', header: <span className="sr-only">Actions</span>, className: 'text-right', cell: (g) => can('community.approve') && (
              <div className="flex justify-end gap-1">
                {g.status === 'pending' && <><Button size="sm" onClick={() => decide.mutate({ g, action: 'approve' })}><Check />Approve</Button><Button size="sm" variant="ghost" onClick={() => decide.mutate({ g, action: 'reject' })}><X />Reject</Button></>}
                {g.status === 'active' && g.kind !== 'batch' && <Button size="sm" variant="ghost" onClick={() => decide.mutate({ g, action: 'archive' })}>Archive</Button>}
                {g.status === 'archived' && <Button size="sm" variant="ghost" onClick={() => decide.mutate({ g, action: 'restore' })}><RotateCcw />Restore</Button>}
              </div>) },
          ]} />
        {list.data && <Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={setPage} />}
      </Card>
      {creating && <NewGroup onClose={() => setCreating(false)} />}
    </>
  );
}

function NewGroup({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ name: '', description: '', kind: 'interest', join_policy: 'open' });
  const save = useAction(() => api('/api/v1/admin/community/groups', { method: 'POST', body: f }), { success: 'Group created.', invalidate: [['admin-community'], ['groups']], onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="New group"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={f.name.trim().length < 3} onClick={() => save.mutate(undefined)}>Create</Button></>}>
      <div className="space-y-4">
        <Field label="Name" required error={save.fieldErrors.name}>{(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Description">{(id) => <Textarea id={id} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        <Field label="Type">{(id) => <Select id={id} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="interest">Interest group</option><option value="forum">Discussion forum</option></Select>}</Field>
        <Field label="Who can join">{(id) => <Select id={id} value={f.join_policy} onChange={(e) => setF({ ...f, join_policy: e.target.value })}><option value="open">Anyone</option><option value="approval">Moderators approve</option></Select>}</Field>
      </div>
    </Dialog>
  );
}

function Announcements() {
  const { can } = useAuth();
  const list = useQuery({ queryKey: ['admin-community', 'announcements'], queryFn: () => api<Paged<PostT>>('/api/v1/admin/community/posts?kind=announcement&page_size=20') });
  return (
    <div className="max-w-3xl space-y-4">
      {can('community.publish') ? <Composer announcementAllowed /> : <Card className="p-4 text-sm text-ink-muted">You need the “publish” permission for announcements.</Card>}
      <p className="flex items-center gap-2 text-sm text-ink-muted"><Megaphone className="h-4 w-4" />Tick “Announcement” to publish to everyone; pin important ones from the Posts tab.</p>
      {list.data?.data.map((p) => <PostCard key={p.id} post={p} />)}
    </div>
  );
}

function Log() {
  const [page, setPage] = useState(1);
  const list = useQuery({ queryKey: ['admin-community', 'log', page], queryFn: () => api<Paged<{ id: number; actor: Author | null; target_type: string; target_id: string; action: string; reason: string | null; created_at: string }>>(`/api/v1/admin/community/moderation-log${qs({ page })}`), placeholderData: keepPreviousData });
  return (
    <Card>
      <DataTable rows={list.data?.data} loading={list.isLoading} rowKey={(r) => r.id} empty={<EmptyState icon={History} title="No moderation actions yet" />}
        columns={[
          { key: 'when', header: 'When', cell: (r) => <span className="text-ink-muted">{fmtDateTime(r.created_at)}</span> },
          { key: 'who', header: 'Moderator', cell: (r) => r.actor?.full_name ?? '—' },
          { key: 'what', header: 'Action', cell: (r) => <span><Badge className="capitalize">{r.action.replace('_', ' ')}</Badge> <span className="text-ink-muted">{r.target_type}</span></span> },
          { key: 'why', header: 'Reason', hideOnMobile: true, cell: (r) => <span className="text-ink-muted">{r.reason ?? '—'}</span> },
        ]} />
      {list.data && <Pagination page={list.data.meta.page} pages={list.data.meta.pages} total={list.data.meta.total} onPage={setPage} />}
    </Card>
  );
}
