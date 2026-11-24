import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, Lock, LogOut, MessagesSquare, Plus, Search, Shield, UserPlus, Users, X } from 'lucide-react';
import { api, ApiError, get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useDebounced } from '@/lib/hooks';
import { photoUrl } from '@/lib/alumni';
import { cn, timeAgo } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, Avatar, Badge, Card, CardHeader, EmptyState, PageHeader, Skeleton } from '@/components/ui/display';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog, Tabs, useConfirm } from '@/components/ui/overlay';
import { Comments, Composer, Feed, PostCard, useGroups, type Author, type GroupT, type PostT } from '@/components/community';

const KIND_LABEL = { batch: 'Batch community', interest: 'Interest group', forum: 'Discussion forum' } as const;

export function CommunityPage() {
  const { can } = useAuth();
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 400);
  const mine = useGroups('mine');
  if (!can('portal.react')) {
    return <><PageHeader title="Community" /><Card><EmptyState icon={Lock} title="Available to verified alumni" description="The community opens once your profile is verified." /></Card></>;
  }
  return (
    <>
      <PageHeader title="Community" description="News, questions and conversations from the alumni network." />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-4">
          {can('portal.post') && <Composer groups={mine.data} announcementAllowed={can('community.publish')} />}
          <Card className="flex flex-col gap-3 p-2 sm:flex-row sm:items-center">
            <div className="flex-1 px-2"><Tabs value={filter} onValueChange={setFilter}
              tabs={[{ value: 'all', label: 'All' }, { value: 'following', label: 'Following' }, { value: 'announcements', label: 'Announcements' }, { value: 'mine', label: 'My posts' }]}><span /></Tabs></div>
            <div className="relative sm:w-56">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
              <Input aria-label="Search posts" placeholder="Search posts…" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 pl-9" />
            </div>
          </Card>
          <Feed filter={filter} q={dq} />
        </div>
        <aside className="space-y-4">
          <Card>
            <CardHeader title="My groups" icon={Users} action={<Button asChild variant="link" size="sm"><Link to="/portal/community/groups">All groups</Link></Button>} />
            {mine.isLoading ? <div className="p-4"><Skeleton className="h-24" /></div> : !mine.data?.length
              ? <p className="p-5 text-sm text-ink-muted">You have not joined any groups yet.</p> : (
                <ul className="divide-y divide-line">
                  {mine.data.map((g) => (
                    <li key={g.id}><Link to={`/portal/community/groups/${g.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-canvas">
                      <GroupIcon g={g} size={36} />
                      <span className="min-w-0"><span className="block truncate text-sm font-medium text-ink">{g.name}</span>
                        <span className="text-xs text-ink-muted">{g.status === 'pending' ? 'Waiting for approval' : `${g.member_count} members`}</span></span>
                    </Link></li>
                  ))}
                </ul>
              )}
          </Card>
          <Alert tone="info" title="Community guidelines">Be respectful, keep posts relevant to the alumni community and never share others' personal details. Use “Report” for anything inappropriate.</Alert>
        </aside>
      </div>
    </>
  );
}

function GroupIcon({ g, size = 40 }: { g: GroupT; size?: number }) {
  if (g.cover) return <img src={photoUrl(g.cover, size * 2)} alt="" className="shrink-0 rounded-btn object-cover" style={{ width: size, height: size }} />;
  const Icon = g.kind === 'forum' ? MessagesSquare : g.kind === 'batch' ? Shield : Users;
  return <span className="grid shrink-0 place-items-center rounded-btn bg-primary-soft text-primary" style={{ width: size, height: size }}><Icon className="h-1/2 w-1/2" /></span>;
}

export function GroupsPage() {
  const { can } = useAuth();
  const [scope, setScope] = useState<'mine' | 'discover'>('discover');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const dq = useDebounced(q);
  const list = useGroups(scope, dq);
  const join = useAction((id: string) => api<{ data: GroupT }>(`/api/v1/community/groups/${id}/join`, { method: 'POST' }),
    { success: (r) => (r.data.membership?.status === 'pending' ? 'Request sent to the group moderators.' : 'You joined the group.'), invalidate: [['groups']] });
  return (
    <>
      <PageHeader title="Groups & forums" breadcrumb={<Link to="/portal/community" className="hover:text-ink">Community</Link>}
        description="Batch communities, interest groups and discussion forums."
        actions={can('portal.groups') && <Button onClick={() => setCreating(true)}><Plus />Propose a group</Button>} />
      <Card className="mb-4 flex flex-col gap-3 p-2 sm:flex-row sm:items-center">
        <div className="flex-1 px-2"><Tabs value={scope} onValueChange={(v) => setScope(v as 'mine' | 'discover')} tabs={[{ value: 'discover', label: 'Discover' }, { value: 'mine', label: 'My groups' }]}><span /></Tabs></div>
        <div className="relative sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <Input aria-label="Search groups" placeholder="Search groups…" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 pl-9" />
        </div>
      </Card>
      {list.isLoading ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-card" />)}</div>
        : !list.data?.length ? <Card><EmptyState icon={Users} title={scope === 'mine' ? 'No groups yet' : 'No groups found'} description={scope === 'mine' ? 'Join a group from Discover.' : 'Try another search, or propose a new group.'} /></Card> : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {list.data.map((g) => (
              <Card key={g.id} className="flex flex-col p-5">
                <div className="flex items-start gap-3">
                  <GroupIcon g={g} size={48} />
                  <div className="min-w-0">
                    <Link to={`/portal/community/groups/${g.id}`} className="font-heading font-semibold text-ink hover:text-primary">{g.name}</Link>
                    <p className="text-xs text-ink-muted">{KIND_LABEL[g.kind]} · {g.member_count} members{g.join_policy === 'approval' && ' · approval needed'}</p>
                  </div>
                </div>
                <p className="mt-3 line-clamp-3 text-sm text-ink-muted">{g.description || 'No description.'}</p>
                <div className="mt-auto flex items-center justify-between pt-4 text-xs text-ink-muted">
                  <span>{g.last_post_at ? `Active ${timeAgo(g.last_post_at)}` : 'No posts yet'}</span>
                  {g.status === 'pending' ? <Badge tone="warning">Waiting for approval</Badge>
                    : g.membership?.status === 'active' ? <Badge tone="success">Member</Badge>
                    : g.membership?.status === 'pending' ? <Badge>Requested</Badge>
                    : g.kind !== 'batch' && can('portal.groups') && <Button size="sm" onClick={() => join.mutate(g.id)}><UserPlus />Join</Button>}
                </div>
              </Card>
            ))}
          </div>
        )}
      {creating && <GroupDialog onClose={() => setCreating(false)} />}
    </>
  );
}

function GroupDialog({ group, onClose }: { group?: GroupT; onClose: () => void }) {
  const { can } = useAuth();
  const [f, setF] = useState({ name: group?.name ?? '', description: group?.description ?? '', kind: group?.kind === 'forum' ? 'forum' : 'interest', join_policy: group?.join_policy ?? 'open' });
  const save = useAction(() => api(group ? `/api/v1/community/groups/${group.id}` : '/api/v1/community/groups', {
    method: group ? 'PATCH' : 'POST', body: group ? { name: f.name, description: f.description, join_policy: f.join_policy } : f }),
  { success: group ? 'Group updated.' : can('community.approve') ? 'Group created.' : 'Thanks! The moderators will review your group.', invalidate: [['groups'], ['group']], onSuccess: onClose });
  const e = save.fieldErrors;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={group ? 'Edit group' : 'Propose a group'}
      description={group ? undefined : 'Groups proposed by members go live after a moderator approves them.'}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={f.name.trim().length < 3} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="Name" required error={e.name}>{(id) => <Input id={id} value={f.name} maxLength={120} onChange={(x) => setF({ ...f, name: x.target.value })} />}</Field>
        <Field label="Description" error={e.description}>{(id) => <Textarea id={id} value={f.description} maxLength={1000} onChange={(x) => setF({ ...f, description: x.target.value })} />}</Field>
        {!group && <Field label="Type">{(id) => <Select id={id} value={f.kind} onChange={(x) => setF({ ...f, kind: x.target.value })}><option value="interest">Interest group (posts)</option><option value="forum">Discussion forum (titled topics)</option></Select>}</Field>}
        {group?.kind !== 'batch' && <Field label="Who can join">{(id) => <Select id={id} value={f.join_policy} onChange={(x) => setF({ ...f, join_policy: x.target.value as 'open' | 'approval' })}>
          <option value="open">Anyone — posts are visible to all members</option><option value="approval">Moderators approve — posts visible to members only</option></Select>}</Field>}
      </div>
    </Dialog>
  );
}

type Member = { user: Author; role: string; status: string; joined_at: string };

export function GroupPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const confirm = useConfirm();
  const nav = useNavigate();
  const [tab, setTab] = useState('posts');
  const [editing, setEditing] = useState(false);
  const q = useQuery({ queryKey: ['group', id], queryFn: () => get<GroupT & { readable: boolean }>(`/api/v1/community/groups/${id}`),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2 });
  const inv = [['group', id], ['groups'], ['group-members', id]];
  const join = useAction(() => api(`/api/v1/community/groups/${id}/join`, { method: 'POST' }), { success: 'Done.', invalidate: inv });
  const leave = useAction(() => api(`/api/v1/community/groups/${id}/leave`, { method: 'POST' }), { success: 'You left the group.', invalidate: inv, onSuccess: () => nav('/portal/community/groups') });
  const g = q.data;
  if (q.isLoading) return <Skeleton className="h-64 rounded-card" />;
  if (!g) return <Card><EmptyState icon={Users} title="Group not found" action={<Button asChild variant="outline"><Link to="/portal/community/groups">All groups</Link></Button>} /></Card>;
  const member = g.membership?.status === 'active';
  return (
    <>
      <Link to="/portal/community/groups" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />Groups</Link>
      <Card className="mb-5 overflow-hidden">
        <div className="h-28 bg-gradient-to-r from-navy to-primary">{g.cover && <img src={photoUrl(g.cover, 1200)} alt="" className="h-full w-full object-cover opacity-70" />}</div>
        <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="font-heading text-xl font-semibold text-ink">{g.name}</h1>
            <p className="text-sm text-ink-muted">{KIND_LABEL[g.kind]} · {g.member_count} members · {g.join_policy === 'approval' ? 'Private' : 'Public'}</p>
            {g.description && <p className="mt-2 max-w-2xl text-sm text-ink">{g.description}</p>}
          </div>
          <div className="flex shrink-0 gap-2">
            {g.can_manage && <Button variant="outline" onClick={() => setEditing(true)}>Edit</Button>}
            {g.status === 'pending' ? <Badge tone="warning">Waiting for approval</Badge>
              : member ? g.kind !== 'batch' && <Button variant="outline" onClick={async () => { if (await confirm({ title: 'Leave this group?', confirmLabel: 'Leave' })) leave.mutate(undefined); }}><LogOut />Leave</Button>
              : g.membership?.status === 'pending' ? <Badge>Request sent</Badge>
              : g.kind !== 'batch' && can('portal.groups') && <Button loading={join.isPending} onClick={() => join.mutate(undefined)}><UserPlus />{g.join_policy === 'open' ? 'Join group' : 'Ask to join'}</Button>}
          </div>
        </div>
      </Card>
      {!g.readable ? (
        <Card><EmptyState icon={Lock} title={g.status === 'pending' ? 'This group is waiting for approval' : 'Members only'} description={g.status === 'pending' ? 'Moderators will review it soon.' : 'Join the group to see its posts.'} /></Card>
      ) : (
        <>
          <Tabs value={tab} onValueChange={setTab} tabs={[{ value: 'posts', label: g.kind === 'forum' ? 'Topics' : 'Posts' }, { value: 'members', label: 'Members' },
            ...(g.can_manage && g.join_policy === 'approval' && g.kind !== 'batch' ? [{ value: 'requests', label: 'Join requests' }] : [])]}><span /></Tabs>
          <div className="mt-5 max-w-3xl">
            {tab === 'posts' && <div className="space-y-4">{member && can('portal.post') && <Composer groupId={g.id} forum={g.kind === 'forum'} />}<Feed groupId={g.id} /></div>}
            {tab === 'members' && <Members group={g} status="active" />}
            {tab === 'requests' && <Members group={g} status="pending" />}
          </div>
        </>
      )}
      {editing && <GroupDialog group={g} onClose={() => setEditing(false)} />}
    </>
  );
}

function Members({ group, status }: { group: GroupT; status: 'active' | 'pending' }) {
  const q = useQuery({ queryKey: ['group-members', group.id, status], queryFn: () => get<Member[]>(`/api/v1/community/groups/${group.id}/members?status=${status}`) });
  const act = useAction(({ uid, action }: { uid: string; action: string }) => api(`/api/v1/community/groups/${group.id}/members/${uid}`, { method: 'POST', body: { action } }),
    { success: 'Done.', invalidate: [['group-members', group.id], ['group', group.id]] });
  if (q.isLoading) return <Skeleton className="h-40" />;
  if (!q.data?.length) return <Card><EmptyState icon={Users} title={status === 'pending' ? 'No join requests' : 'No members'} /></Card>;
  return (
    <Card>
      <ul className="divide-y divide-line">
        {q.data.map((m) => (
          <li key={m.user.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
            <Link to={`/portal/alumni/${m.user.id}`} className="flex min-w-0 flex-1 items-center gap-3">
              <Avatar name={m.user.full_name} src={photoUrl(m.user.photo, 80)} size={40} />
              <span className="min-w-0"><span className="block truncate font-medium text-ink">{m.user.full_name}</span><span className="text-xs text-ink-muted">{m.user.batch ?? ''}</span></span>
              {m.role !== 'member' && <Badge tone="primary" className="capitalize">{m.role}</Badge>}
            </Link>
            {group.can_manage && m.role !== 'owner' && (
              <div className="flex gap-1">
                {status === 'pending' ? (<>
                  <Button size="sm" onClick={() => act.mutate({ uid: m.user.id, action: 'approve' })}><Check />Approve</Button>
                  <Button size="sm" variant="ghost" onClick={() => act.mutate({ uid: m.user.id, action: 'remove' })}><X />Decline</Button>
                </>) : (<>
                  <Button size="sm" variant="ghost" onClick={() => act.mutate({ uid: m.user.id, action: m.role === 'moderator' ? 'make_member' : 'make_moderator' })}>{m.role === 'moderator' ? 'Remove moderator' : 'Make moderator'}</Button>
                  {group.kind !== 'batch' && <Button size="sm" variant="ghost" onClick={() => act.mutate({ uid: m.user.id, action: 'remove' })}>Remove</Button>}
                </>)}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function PostPage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['post', id], queryFn: () => get<PostT>(`/api/v1/community/posts/${id}`), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2 });
  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/portal/community" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />Community</Link>
      {q.isLoading ? <Skeleton className="h-64 rounded-card" /> : !q.data ? <Card><EmptyState icon={Users} title="Post not available" description="It may have been deleted, or it belongs to a group you are not in." /></Card> : (
        <div className={cn('space-y-3')}><PostCard post={q.data} /><Card className="p-4"><Comments post={q.data} /></Card></div>
      )}
    </div>
  );
}
