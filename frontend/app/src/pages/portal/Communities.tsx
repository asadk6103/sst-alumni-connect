import { useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight, Bell, BellOff, BookOpen, Briefcase, CalendarDays, Camera, Check, ChevronDown, Copy, Download, FileText, Files, Globe, GraduationCap,
  HeartHandshake, Info, Link2, Lock, LogOut, MapPin, Megaphone, MessageCircle, MessagesSquare, MoreHorizontal, Palette, Pencil, Plus, Search,
  TrendingUp, UserPlus, Users, UsersRound, X,
} from 'lucide-react';
import { api, ApiError, get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useDebounced } from '@/lib/hooks';
import { photoUrl, type Photo } from '@/lib/alumni';
import { pickVariant, useSite } from '@/lib/site';
import { cn, fmtDate, fmtDateTime, timeAgo } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, Card, EmptyState, Skeleton } from '@/components/ui/display';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, useConfirm, useToast } from '@/components/ui/overlay';
import { VerifiedBadge } from '@/components/alumni';
import { Composer, Feed, SectionCard, fileSize, useGroups, type Author, type GroupT } from '@/components/community';
import { PortalPage } from '@/layouts/PortalLayout';

export const CATEGORIES = [
  { key: 'batch', label: 'Batch Groups', icon: GraduationCap },
  { key: 'professional', label: 'Professional', icon: Briefcase },
  { key: 'interest', label: 'Interest & Hobbies', icon: Palette },
  { key: 'career', label: 'Career & Jobs', icon: TrendingUp },
  { key: 'higher_studies', label: 'Higher Studies', icon: BookOpen },
  { key: 'social_impact', label: 'Social Impact', icon: HeartHandshake },
  { key: 'events', label: 'Events & Reunions', icon: CalendarDays },
] as const;
const catOf = (g: GroupT) => CATEGORIES.find((c) => c.key === (g.kind === 'batch' ? 'batch' : g.category)) ?? CATEGORIES[2];
const members = (n: number) => `${n.toLocaleString()} member${n === 1 ? '' : 's'}`;

type Invite = { id: string; group: GroupT; inviter: Author | null; created_at: string };
type Trend = { post_id: string; group_id: string; group: string; title: string; comment_count: number };
type Ev = { id: string; title: string; kind_label: string; starts_at: string; ends_at: string; venue: string | null; is_online: boolean; banner: Photo;
  is_past: boolean; registered_count: number; my_registration: { status: string } | null };
type Overview = { members: number; posts: number; events: number; admins: number; created_at: string; created_by: Author | null;
  member_faces: Author[]; upcoming_events: Ev[] };

function useGroupActions(g: GroupT) {
  const nav = useNavigate();
  const inv = [['groups'], ['group', g.id], ['group-overview', g.id], ['group-members', g.id]];
  const join = useAction(() => api<{ data: GroupT }>(`/api/v1/community/groups/${g.id}/join`, { method: 'POST' }),
    { success: (r) => (r.data.membership?.status === 'pending' ? 'Request sent to the community admins.' : 'You joined the community.'), invalidate: inv });
  const leave = useAction(() => api(`/api/v1/community/groups/${g.id}/leave`, { method: 'POST' }),
    { success: 'You left the community.', invalidate: inv, onSuccess: () => nav('/portal/community/groups') });
  const notify = useAction((level: 'all' | 'highlights' | 'off') => api(`/api/v1/community/groups/${g.id}/notify`, { method: 'POST', body: { level } }),
    { success: 'Notification preference saved.', invalidate: inv });
  return { join, leave, notify };
}

function GroupBadge({ g, size = 48, square }: { g: GroupT; size?: number; square?: boolean }) {
  const Icon = catOf(g).icon;
  const img = g.photo ?? g.cover;
  const shape = square ? 'rounded-card' : 'rounded-full';
  if (img) return <img src={photoUrl(img, size * 2)} alt="" className={cn('shrink-0 bg-canvas object-cover', shape)} style={{ width: size, height: size }} />;
  return <span className={cn('grid shrink-0 place-items-center bg-primary-soft text-primary', shape)} style={{ width: size, height: size }}><Icon className="h-1/2 w-1/2" /></span>;
}

function useLeaveConfirm(g: GroupT) {
  const confirm = useConfirm();
  const { leave } = useGroupActions(g);
  return async () => { if (await confirm({ title: `Leave ${g.name}?`, confirmLabel: 'Leave', danger: true })) leave.mutate(undefined); };
}

function MoreMenu({ g, onEdit }: { g: GroupT; onEdit?: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const leave = useLeaveConfirm(g);
  const member = g.membership?.status === 'active';
  return (
    <Menu>
      <MenuTrigger asChild><Button variant="outline" size="icon" className="h-9 w-9 shrink-0" aria-label={`More actions for ${g.name}`}><MoreHorizontal /></Button></MenuTrigger>
      <MenuContent>
        <MenuItem onSelect={() => nav(`/portal/community/groups/${g.id}`)}><UsersRound />View community</MenuItem>
        <MenuItem onSelect={() => { navigator.clipboard?.writeText(`${location.origin}/portal/community/groups/${g.id}`); toast.success('Link copied.'); }}><Copy />Copy link</MenuItem>
        {onEdit && <MenuItem onSelect={onEdit}><Pencil />Edit community</MenuItem>}
        {member && g.kind !== 'batch' && <><MenuSeparator /><MenuItem danger onSelect={leave}><LogOut />Leave community</MenuItem></>}
      </MenuContent>
    </Menu>
  );
}

function JoinButton({ g, className }: { g: GroupT; className?: string }) {
  const { can } = useAuth();
  const { join } = useGroupActions(g);
  if (g.status === 'pending') return <Badge tone="warning" className={className}>Waiting for approval</Badge>;
  if (g.membership?.status === 'active') return <Button variant="ghost" className={cn('bg-primary-soft text-primary hover:bg-primary-soft', className)} tabIndex={-1}><Check />Joined</Button>;
  if (g.membership?.status === 'pending') return <Button variant="outline" disabled className={className}>Requested</Button>;
  if (g.kind === 'batch' || !can('portal.groups')) return null;
  return <Button className={className} loading={join.isPending} onClick={() => join.mutate(undefined)}><Plus />{g.join_policy === 'open' ? 'Join' : 'Ask to Join'}</Button>;
}

function GroupCard({ g }: { g: GroupT }) {
  const { notify } = useGroupActions(g);
  const member = g.membership?.status === 'active';
  const muted = g.membership?.notify === 'off';
  return (
    <Card className="flex flex-col overflow-hidden">
      <Link to={`/portal/community/groups/${g.id}`} className="relative block h-28 bg-gradient-to-r from-navy to-primary" aria-label={g.name}>
        {g.cover && <img src={photoUrl(g.cover, 640)} alt="" className="h-full w-full object-cover" />}
        <span className="absolute -bottom-6 start-4 rounded-full ring-4 ring-surface"><GroupBadge g={{ ...g, cover: null }} size={48} /></span>
      </Link>
      <div className="flex flex-1 flex-col p-4 pt-8">
        <Link to={`/portal/community/groups/${g.id}`} className="line-clamp-2 font-heading text-[16px] font-semibold leading-snug text-ink hover:text-primary">{g.name}</Link>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-muted"><Users className="h-4 w-4" />{members(g.member_count)}{g.private && <Lock className="h-3.5 w-3.5" aria-label="Private" />}</p>
        <p className="mt-2 line-clamp-3 text-sm text-ink-muted">{g.description || 'No description yet.'}</p>
        <div className="mt-auto flex items-center gap-2 pt-4">
          <JoinButton g={g} className="h-9 flex-1" />
          {member && <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" aria-label={muted ? 'Turn on notifications' : 'Mute notifications'}
            onClick={() => notify.mutate(muted ? 'all' : 'off')}>{muted ? <BellOff /> : <Bell />}</Button>}
          <MoreMenu g={g} />
        </div>
      </div>
    </Card>
  );
}

// ── communities list ────────────────────────────────────────────────────────
export function GroupsPage() {
  const { can } = useAuth();
  const site = useSite();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? 'discover';
  const category = sp.get('category') ?? '';
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 300);
  const [showAll, setShowAll] = useState(false);
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const list = useGroups(tab === 'mine' ? 'mine' : 'all', dq, category);
  const invites = useQuery({ queryKey: ['group-invites'], queryFn: () => get<Invite[]>('/api/v1/community/group-invites'), enabled: can('portal.react') });
  if (!can('portal.react')) return <Card><EmptyState icon={Lock} title="Available to verified alumni" description="Communities open once your profile is verified." /></Card>;
  const banner = site.assets.dashboard_banner ?? site.assets.login_background;
  const rows = list.data ?? [];
  const shown = showAll || tab !== 'discover' ? rows : rows.slice(0, 8);
  const nInv = invites.data?.length ?? 0;
  return (
    <PortalPage aside={<GroupsAside onCategory={(c) => set('category', c === category ? null : c)} category={category} />}>
      <div>
        <p className="text-sm text-ink-muted">Community</p>
        <h1 className="font-heading text-[30px] font-semibold leading-tight text-ink">Communities</h1>
        <p className="mt-1 text-ink-muted">Join groups, discuss ideas, share opportunities and stay connected with fellow alumni.</p>
      </div>
      <div className="relative overflow-hidden rounded-card bg-gradient-to-r from-[#5b2bb5] via-[#6d3fd0] to-primary">
        {banner && <img src={pickVariant(banner, 1200)} alt="" className="absolute inset-y-0 end-0 h-full w-3/5 object-cover opacity-90 [mask-image:linear-gradient(to_right,transparent,black_45%)]" />}
        <div className="relative max-w-md px-6 py-8 text-white sm:px-8">
          <h2 className="font-heading text-2xl font-semibold sm:text-[28px]">Alumni Communities</h2>
          <p className="mt-2 text-white/90">Reconnect • Collaborate • Grow Together</p>
        </div>
      </div>
      <div className="flex overflow-hidden rounded-card border border-line bg-surface focus-within:border-primary">
        <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-muted" />
          <input aria-label="Search communities" placeholder="Search communities by name or keyword…" value={q} onChange={(e) => setQ(e.target.value)}
            className="h-12 w-full bg-transparent ps-12 pe-3 text-[15px] outline-none" /></div>
        {can('portal.groups') && <Button className="h-12 shrink-0 rounded-none px-5" onClick={() => set('create', '1')}><Plus /><span className="hidden sm:inline">Create Community</span><span className="sm:hidden">Create</span></Button>}
      </div>
      <div className="flex items-center gap-1 overflow-x-auto border-b border-line" role="tablist">
        {[{ k: 'discover', l: 'Discover Communities' }, { k: 'mine', l: 'My Communities' }, { k: 'invites', l: `Invitations${nInv ? ` (${nInv})` : ''}` }].map((t) => (
          <button key={t.k} role="tab" aria-selected={tab === t.k} onClick={() => set('tab', t.k === 'discover' ? null : t.k)}
            className={cn('-mb-px shrink-0 border-b-2 px-4 py-2.5 text-[15px] font-medium', tab === t.k ? 'border-primary text-primary' : 'border-transparent text-ink-muted hover:text-ink')}>{t.l}</button>
        ))}
      </div>
      {category && <div className="flex items-center gap-2 text-sm"><span className="text-ink-muted">Category:</span>
        <button onClick={() => set('category', null)} className="flex items-center gap-1 rounded-full bg-primary-soft px-3 py-1 font-medium text-primary">{CATEGORIES.find((c) => c.key === category)?.label}<X className="h-3.5 w-3.5" /></button></div>}
      {tab === 'invites' ? <Invitations items={invites.data} loading={invites.isLoading} /> : (
        <>
          {tab === 'discover' && <div className="flex items-center justify-between"><h2 className="font-heading text-lg font-semibold text-ink">Discover Communities</h2>
            {rows.length > 8 && <button className="flex items-center gap-1 text-sm font-semibold text-primary hover:underline" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : 'View All Communities'}<ArrowRight className="h-4 w-4 rtl:rotate-180" /></button>}</div>}
          {list.isLoading ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-card" />)}</div>
            : !rows.length ? <Card><EmptyState icon={UsersRound} title={tab === 'mine' ? 'You have not joined any communities yet' : 'No communities found'}
              description={tab === 'mine' ? 'Discover communities to join.' : 'Try another search or category, or create a new community.'} /></Card>
              : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">{shown.map((g) => <GroupCard key={g.id} g={g} />)}</div>}
        </>
      )}
      {sp.get('create') === '1' && <GroupDialog onClose={() => set('create', null)} />}
    </PortalPage>
  );
}

function Invitations({ items, loading }: { items?: Invite[]; loading: boolean }) {
  const answer = useAction(({ id, d }: { id: string; d: 'accept' | 'decline' }) => api(`/api/v1/community/group-invites/${id}/${d}`, { method: 'POST' }),
    { success: 'Done.', invalidate: [['group-invites'], ['groups']] });
  if (loading) return <Skeleton className="h-40 rounded-card" />;
  if (!items?.length) return <Card><EmptyState icon={UserPlus} title="No invitations" description="When a connection invites you to a community, it shows up here." /></Card>;
  return (
    <div className="space-y-3">{items.map((i) => (
      <Card key={i.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <GroupBadge g={i.group} size={56} square />
        <div className="min-w-0 flex-1">
          <Link to={`/portal/community/groups/${i.group.id}`} className="font-heading font-semibold text-ink hover:text-primary">{i.group.name}</Link>
          <p className="text-sm text-ink-muted">{i.inviter?.full_name ?? 'A member'} invited you · {members(i.group.member_count)} · {timeAgo(i.created_at)}</p>
        </div>
        <div className="flex gap-2"><Button onClick={() => answer.mutate({ id: i.id, d: 'accept' })}><Check />Accept</Button>
          <Button variant="outline" onClick={() => answer.mutate({ id: i.id, d: 'decline' })}>Decline</Button></div>
      </Card>))}</div>
  );
}

function GroupsAside({ onCategory, category }: { onCategory: (c: string) => void; category: string }) {
  const mine = useGroups('mine');
  const trending = useQuery({ queryKey: ['trending-discussions'], queryFn: () => get<Trend[]>('/api/v1/community/trending?limit=5'), staleTime: 60_000 });
  const active = (mine.data ?? []).filter((g) => g.status === 'active');
  return (
    <>
      <SectionCard title={<>My Communities<span className="ms-1 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">{active.length}</span></>} icon={UsersRound}
        action={<Link to="/portal/community/groups?tab=mine" className="text-sm font-semibold text-primary hover:underline">View All</Link>}>
        {mine.isLoading ? <Skeleton className="h-32" /> : !active.length ? <p className="text-sm text-ink-muted">Communities you join appear here.</p> : (
          <ul className="space-y-3">{active.slice(0, 5).map((g) => (
            <li key={g.id} className="flex items-center gap-3"><GroupBadge g={g} size={44} square />
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink">{g.name}</p><p className="text-xs text-ink-muted">{members(g.member_count)}</p></div>
              <Button asChild size="sm" variant="outline" className="h-8 border-primary/50 text-primary"><Link to={`/portal/community/groups/${g.id}`}>View</Link></Button></li>))}</ul>
        )}
      </SectionCard>
      <SectionCard title="Trending Discussions" icon={TrendingUp}>
        {trending.isLoading ? <Skeleton className="h-28" /> : !trending.data?.length ? <p className="text-sm text-ink-muted">No discussions yet this month.</p> : (
          <ul className="divide-y divide-line">{trending.data.map((t) => (
            <li key={t.post_id} className="py-2.5 first:pt-0 last:pb-0"><Link to={`/portal/community/posts/${t.post_id}`} className="group flex items-start gap-3">
              <span className="min-w-0 flex-1"><span className="line-clamp-2 text-sm font-medium text-ink group-hover:text-primary">{t.title || 'Untitled post'}</span>
                <span className="text-xs text-ink-muted">{t.group}</span></span>
              <span className="flex shrink-0 items-center gap-1 text-xs text-ink-muted"><MessageCircle className="h-3.5 w-3.5" />{t.comment_count}</span></Link></li>))}</ul>
        )}
      </SectionCard>
      <SectionCard title="Explore by Category" icon={Search}>
        <div className="flex flex-wrap gap-2">{CATEGORIES.map((c) => (
          <button key={c.key} onClick={() => onCategory(c.key)} aria-pressed={category === c.key}
            className={cn('flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm', category === c.key ? 'border-primary bg-primary-soft text-primary' : 'border-line text-ink hover:border-primary/50')}>
            <c.icon className="h-4 w-4 text-primary" />{c.label}</button>))}</div>
      </SectionCard>
    </>
  );
}

// ── create / edit ───────────────────────────────────────────────────────────
function ImagePick({ label, value, onChange, wide }: { label: string; value: { id: string; url: string } | null; onChange: (v: { id: string; url: string } | null) => void; wide?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const pick = async (f: File) => {
    setBusy(true);
    try { const fd = new FormData(); fd.append('file', f); const r = await api<{ data: { id: string; url: string } }>('/api/v1/community/uploads', { method: 'POST', body: fd }); onChange(r.data); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Upload failed.'); } finally { setBusy(false); }
  };
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-ink">{label}</p>
      <button type="button" onClick={() => ref.current?.click()} className={cn('relative grid place-items-center overflow-hidden rounded-card border-2 border-dashed border-line bg-canvas text-sm text-ink-muted hover:border-primary', wide ? 'h-28 w-full' : 'h-28 w-28')}>
        {value ? <img src={value.url} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <span className="flex flex-col items-center gap-1"><Camera className="h-5 w-5" />{busy ? 'Uploading…' : 'Upload'}</span>}
      </button>
      {value && <button type="button" className="mt-1 text-xs text-primary" onClick={() => onChange(null)}>Remove</button>}
      <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) pick(f); }} />
    </div>
  );
}

function GroupDialog({ group, onClose }: { group?: GroupT; onClose: () => void }) {
  const { can } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ name: group?.name ?? '', description: group?.description ?? '', kind: group?.kind === 'forum' ? 'forum' : 'interest',
    category: group?.category && group.category !== 'batch' ? group.category : 'interest', join_policy: group?.join_policy ?? 'open' });
  const [cover, setCover] = useState<{ id: string; url: string } | null>(null);
  const [photo, setPhoto] = useState<{ id: string; url: string } | null>(null);
  const batch = group?.kind === 'batch';
  const body = () => {
    const b: Record<string, unknown> = group ? { name: f.name, description: f.description, ...(batch ? {} : { join_policy: f.join_policy, category: f.category }) } : { ...f };
    if (cover) b.cover_id = cover.id;
    if (photo) b.photo_id = photo.id;
    return b;
  };
  const save = useAction(() => api<{ data: GroupT }>(group ? `/api/v1/community/groups/${group.id}` : '/api/v1/community/groups', { method: group ? 'PATCH' : 'POST', body: body() }),
    { success: group ? 'Community updated.' : can('community.approve') ? 'Community created.' : 'Thanks! The moderators will review your community.',
      invalidate: [['groups'], ['group']], onSuccess: (r) => { onClose(); if (!group) nav(`/portal/community/groups/${r.data.id}`); } });
  const e = save.fieldErrors;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} wide title={group ? 'Edit community' : 'Create a community'}
      description={group || can('community.approve') ? undefined : 'Communities created by members go live after a moderator approves them.'}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={f.name.trim().length < 3} onClick={() => save.mutate(undefined)}>{group ? 'Save' : 'Create Community'}</Button></>}>
      <div className="space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row"><div className="flex-1"><ImagePick label="Cover photo" value={cover ?? (group?.cover ? { id: '', url: photoUrl(group.cover, 640) ?? '' } : null)} onChange={setCover} wide /></div>
          <ImagePick label="Community photo" value={photo ?? (group?.photo ? { id: '', url: photoUrl(group.photo, 240) ?? '' } : null)} onChange={setPhoto} /></div>
        <Field label="Name" required error={e.name}>{(id) => <Input id={id} value={f.name} maxLength={120} onChange={(x) => setF({ ...f, name: x.target.value })} />}</Field>
        <Field label="Description" error={e.description}>{(id) => <Textarea id={id} value={f.description} maxLength={1000} onChange={(x) => setF({ ...f, description: x.target.value })} />}</Field>
        {!batch && <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category">{(id) => <Select id={id} value={f.category} onChange={(x) => setF({ ...f, category: x.target.value })}>
            {CATEGORIES.filter((c) => c.key !== 'batch').map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</Select>}</Field>
          <Field label="Privacy">{(id) => <Select id={id} value={f.join_policy} onChange={(x) => setF({ ...f, join_policy: x.target.value as 'open' | 'approval' })}>
            <option value="open">Public — anyone can join and read posts</option><option value="approval">Private — admins approve members; posts visible to members</option></Select>}</Field>
        </div>}
        {!group && <Field label="Format">{(id) => <Select id={id} value={f.kind} onChange={(x) => setF({ ...f, kind: x.target.value })}>
          <option value="interest">Posts and updates</option><option value="forum">Discussion forum (titled topics)</option></Select>}</Field>}
      </div>
    </Dialog>
  );
}

// ── community detail ────────────────────────────────────────────────────────
export function GroupPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? 'discussion';
  const setTab = (t: string) => { const n = new URLSearchParams(sp); if (t === 'discussion') n.delete('tab'); else n.set('tab', t); setSp(n, { replace: true }); };
  const [dialog, setDialog] = useState<'edit' | 'invite' | 'event' | null>(null);
  const [sort, setSort] = useState('latest');
  const q = useQuery({ queryKey: ['group', id], queryFn: () => get<GroupT & { readable: boolean }>(`/api/v1/community/groups/${id}`),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2 });
  const g = q.data;
  const ov = useQuery({ queryKey: ['group-overview', id], queryFn: () => get<Overview>(`/api/v1/community/groups/${id}/overview`), enabled: g?.status === 'active' });
  if (q.isLoading) return <Skeleton className="h-80 rounded-card" />;
  if (!g) return <Card><EmptyState icon={UsersRound} title="Community not found" action={<Button asChild variant="outline"><Link to="/portal/community/groups">All communities</Link></Button>} /></Card>;
  const member = g.membership?.status === 'active';
  const tabs = [
    { k: 'discussion', l: 'Discussion', icon: MessagesSquare }, { k: 'members', l: 'Members', icon: Users }, { k: 'events', l: 'Events', icon: CalendarDays },
    { k: 'files', l: 'Files', icon: Files }, { k: 'announcements', l: 'Announcements', icon: Megaphone }, { k: 'about', l: 'About', icon: Info },
    ...(g.can_manage && g.join_policy === 'approval' && g.kind !== 'batch' ? [{ k: 'requests', l: 'Join Requests', icon: UserPlus }] : []),
  ];
  return (
    <PortalPage aside={<GroupAside g={g} ov={ov.data} onTab={setTab} />}>
      <Card className="overflow-hidden">
        <div className="h-40 bg-gradient-to-r from-navy to-primary sm:h-56">{g.cover && <img src={photoUrl(g.cover, 1600)} alt="" className="h-full w-full object-cover" />}</div>
        <div className="px-5 pb-1 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="-mt-12 shrink-0 self-start rounded-card bg-surface p-1 shadow sm:-mt-14"><GroupBadge g={{ ...g, cover: null }} size={112} square /></div>
            <div className="min-w-0 flex-1 sm:pb-1">
              <h1 className="flex flex-wrap items-center gap-2 font-heading text-2xl font-semibold text-ink">{g.name}{g.kind === 'batch' && <VerifiedBadge />}</h1>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-muted">{g.private ? <Lock className="h-4 w-4" /> : <Globe className="h-4 w-4" />}{g.private ? 'Private' : 'Public'} Community · {members(g.member_count)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:pb-1">
              {member ? <FollowMenu g={g} /> : <JoinButton g={g} />}
              {member && g.kind !== 'batch' && <Button onClick={() => setDialog('invite')}><UserPlus />Invite Members</Button>}
              <MoreMenu g={g} onEdit={g.can_manage ? () => setDialog('edit') : undefined} />
            </div>
          </div>
          {g.description && <p className="mt-3 max-w-3xl text-[15px] text-ink">{g.description}</p>}
          <div className="-mx-1 mt-4 flex gap-1 overflow-x-auto" role="tablist" aria-label="Community sections">
            {tabs.map((t) => <button key={t.k} role="tab" aria-selected={tab === t.k} onClick={() => setTab(t.k)}
              className={cn('flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-[15px] font-medium', tab === t.k ? 'border-primary text-primary' : 'border-transparent text-ink-muted hover:text-ink')}><t.icon className="h-4 w-4" />{t.l}</button>)}
          </div>
        </div>
      </Card>
      {!g.readable && tab !== 'about' ? (
        <Card><EmptyState icon={Lock} title={g.status === 'pending' ? 'This community is waiting for approval' : 'Members only'}
          description={g.status === 'pending' ? 'Moderators will review it soon.' : 'Join the community to see its discussions, members, events and files.'} /></Card>
      ) : (
        <>
          {tab === 'discussion' && <>
            {member && can('portal.post') && <Composer groupId={g.id} forum={g.kind === 'forum'} announcementAllowed={g.can_manage}
              placeholder={g.kind === 'forum' ? 'Start a discussion…' : 'Share something with the community…'} onEvent={g.can_manage ? () => setDialog('event') : undefined} />}
            <div className="flex items-center justify-between"><h2 className="font-heading text-lg font-semibold text-ink">Recent Posts</h2>
              <select aria-label="Sort posts" value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-btn border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink">
                <option value="latest">Most Recent</option><option value="relevant">Most Relevant</option></select></div>
            <Feed groupId={g.id} sort={sort} />
          </>}
          {tab === 'members' && <Members group={g} status="active" />}
          {tab === 'requests' && <Members group={g} status="pending" />}
          {tab === 'events' && <GroupEvents g={g} onCreate={() => setDialog('event')} />}
          {tab === 'files' && <GroupFiles g={g} />}
          {tab === 'announcements' && <Feed groupId={g.id} filter="announcements" />}
          {tab === 'about' && <About g={g} ov={ov.data} />}
        </>
      )}
      {dialog === 'edit' && <GroupDialog group={g} onClose={() => setDialog(null)} />}
      {dialog === 'invite' && <InviteDialog g={g} onClose={() => setDialog(null)} />}
      {dialog === 'event' && <EventDialog g={g} onClose={() => setDialog(null)} onDone={() => { setDialog(null); toast.success('Event created.'); setTab('events'); }} />}
    </PortalPage>
  );
}

function FollowMenu({ g }: { g: GroupT }) {
  const { notify } = useGroupActions(g);
  const leave = useLeaveConfirm(g);
  const level = g.membership?.notify ?? 'all';
  const label = level === 'all' ? 'Following' : level === 'highlights' ? 'Highlights' : 'Not following';
  const opts = [{ k: 'all', l: 'All posts', d: 'Get notified about every new post' }, { k: 'highlights', l: 'Highlights only', d: 'Announcements and events only' }, { k: 'off', l: 'Off', d: 'No notifications from this community' }] as const;
  return (
    <Menu>
      <MenuTrigger asChild><Button variant="outline">{level === 'off' ? <BellOff /> : <Bell />}{label}<ChevronDown className="h-4 w-4" /></Button></MenuTrigger>
      <MenuContent align="start" className="w-72">
        {opts.map((o) => <MenuItem key={o.k} onSelect={() => notify.mutate(o.k)}>
          <span className="flex w-full items-start gap-2"><Check className={cn('mt-0.5 h-4 w-4 shrink-0', level === o.k ? 'text-primary' : 'invisible')} />
            <span><span className="block font-medium">{o.l}</span><span className="text-xs text-ink-muted">{o.d}</span></span></span></MenuItem>)}
        {g.kind !== 'batch' && <><MenuSeparator /><MenuItem danger onSelect={leave}><LogOut />Leave community</MenuItem></>}
      </MenuContent>
    </Menu>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return <div className="rounded-card bg-canvas px-2 py-3 text-center"><p className="font-heading text-xl font-semibold text-ink">{value}</p><p className="text-xs text-ink-muted">{label}</p></div>;
}

function GroupAside({ g, ov, onTab }: { g: GroupT; ov?: Overview; onTab: (t: string) => void }) {
  const nav = useNavigate();
  const extra = Math.max(0, (ov?.members ?? 0) - (ov?.member_faces.length ?? 0));
  return (
    <>
      <SectionCard title="Community Overview" icon={UsersRound}>
        <div className="grid grid-cols-3 gap-2"><Stat value={(ov?.members ?? g.member_count).toLocaleString()} label="Members" /><Stat value={(ov?.posts ?? g.post_count).toLocaleString()} label="Posts" /><Stat value={ov?.events ?? 0} label="Events" /></div>
      </SectionCard>
      <SectionCard title="About This Community" icon={Info}>
        <p className="line-clamp-4 text-sm text-ink">{g.description || 'No description yet.'}</p>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-ink-muted">Privacy</dt><dd className="flex items-center gap-1 font-medium text-ink">{g.private ? <><Lock className="h-3.5 w-3.5" />Private</> : <><Globe className="h-3.5 w-3.5" />Public</>}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-ink-muted">Created</dt><dd className="font-medium text-ink">{fmtDate(ov?.created_at ?? g.created_at ?? '')}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-ink-muted">Admins</dt><dd className="font-medium text-ink">{ov?.admins ?? '–'}</dd></div>
        </dl>
        <button className="mt-3 flex items-center gap-1 text-sm font-semibold text-primary hover:underline" onClick={() => onTab('about')}>View Details<ArrowRight className="h-4 w-4 rtl:rotate-180" /></button>
      </SectionCard>
      {!!ov?.upcoming_events.length && (
        <SectionCard title="Upcoming Events" icon={CalendarDays}>
          <ul className="space-y-3">{ov.upcoming_events.map((e) => (
            <li key={e.id} className="flex gap-3">
              <span className="h-14 w-14 shrink-0 overflow-hidden rounded-btn bg-primary-soft">{e.banner ? <img src={photoUrl(e.banner, 120)} alt="" className="h-full w-full object-cover" /> : <CalendarDays className="m-4 h-6 w-6 text-primary" />}</span>
              <div className="min-w-0 flex-1">
                <Link to={`/portal/events/${e.id}`} className="line-clamp-1 text-sm font-semibold text-ink hover:text-primary">{e.title}</Link>
                <p className="text-xs text-ink-muted">{fmtDateTime(e.starts_at)}</p>
                <p className="flex items-center gap-1 truncate text-xs text-ink-muted"><MapPin className="h-3 w-3 shrink-0" />{e.is_online ? 'Online' : e.venue}</p>
              </div>
              <Button size="sm" variant={e.my_registration ? 'outline' : 'primary'} className="h-8 self-center" onClick={() => nav(`/portal/events/${e.id}`)}>{e.my_registration ? 'Going' : 'RSVP'}</Button>
            </li>))}</ul>
        </SectionCard>
      )}
      {!!ov?.member_faces.length && (
        <SectionCard title="Community Members" icon={Users} action={<button className="text-sm font-semibold text-primary hover:underline" onClick={() => onTab('members')}>View All</button>}>
          <div className="flex items-center">
            {ov.member_faces.slice(0, 7).map((m, i) => <Link key={m.id} to={`/portal/alumni/${m.id}`} title={m.full_name} className={cn('rounded-full ring-2 ring-surface', i > 0 && '-ms-2.5')}><Avatar name={m.full_name} src={photoUrl(m.photo, 80)} size={38} /></Link>)}
            {extra > 0 && <span className="-ms-2.5 grid h-[38px] min-w-[38px] place-items-center rounded-full bg-primary-soft px-1.5 text-xs font-semibold text-primary ring-2 ring-surface">+{extra}</span>}
          </div>
        </SectionCard>
      )}
    </>
  );
}

function About({ g, ov }: { g: GroupT; ov?: Overview }) {
  const rows: [string, ReactNode][] = [
    ['Privacy', g.private ? 'Private — admins approve new members; only members can read posts' : 'Public — anyone can join and read posts'],
    ['Category', catOf(g).label], ['Format', g.kind === 'forum' ? 'Discussion forum' : g.kind === 'batch' ? 'Batch community' : 'Posts and updates'],
    ['Created', fmtDate(ov?.created_at ?? g.created_at ?? '')], ['Created by', ov?.created_by ? <Link to={`/portal/alumni/${ov.created_by.id}`} className="text-primary hover:underline">{ov.created_by.full_name}</Link> : 'SST Alumni Office'],
    ['Admins', ov?.admins ?? '–'], ['Members', (ov?.members ?? g.member_count).toLocaleString()], ['Posts', (ov?.posts ?? g.post_count).toLocaleString()],
  ];
  return (
    <SectionCard title="About" icon={Info}>
      <p className="whitespace-pre-line text-[15px] text-ink">{g.description || 'No description yet.'}</p>
      <dl className="mt-4 grid gap-y-2.5 text-[15px] sm:grid-cols-[160px_1fr]">{rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-ink-muted">{k}</dt><dd className="font-medium text-ink">{v}</dd></div>)}</dl>
    </SectionCard>
  );
}

type Member = { user: Author; role: string; status: string; joined_at: string };

function Members({ group, status }: { group: GroupT; status: 'active' | 'pending' }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 300);
  const list = useQuery({ queryKey: ['group-members', group.id, status, dq], queryFn: () => get<Member[]>(`/api/v1/community/groups/${group.id}/members?status=${status}${dq ? `&q=${encodeURIComponent(dq)}` : ''}`) });
  const act = useAction(({ uid, action }: { uid: string; action: string }) => api(`/api/v1/community/groups/${group.id}/members/${uid}`, { method: 'POST', body: { action } }),
    { success: 'Done.', invalidate: [['group-members', group.id], ['group', group.id], ['group-overview', group.id]] });
  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-heading text-lg font-semibold text-ink">{status === 'pending' ? 'Join requests' : `Members (${group.member_count.toLocaleString()})`}</h2>
        <div className="relative sm:w-64"><Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <Input aria-label="Search members" placeholder="Search members…" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 ps-9" /></div>
      </div>
      {list.isLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : !list.data?.length ? <EmptyState icon={Users} title={status === 'pending' ? 'No join requests' : 'No members found'} /> : (
        <ul className="divide-y divide-line">{list.data.map((m) => (
          <li key={m.user.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
            <Link to={`/portal/alumni/${m.user.id}`} className="flex min-w-0 flex-1 items-center gap-3">
              <Avatar name={m.user.full_name} src={photoUrl(m.user.photo, 80)} size={44} />
              <span className="min-w-0"><span className="flex items-center gap-1.5 truncate font-semibold text-ink">{m.user.full_name}{m.user.verified && <VerifiedBadge />}</span>
                <span className="block truncate text-sm text-ink-muted">{m.user.headline ?? m.user.batch ?? ''}</span></span>
              {m.role !== 'member' && <Badge tone="primary" className="capitalize">{m.role === 'owner' ? 'Admin' : m.role}</Badge>}
            </Link>
            {group.can_manage && m.role !== 'owner' && (
              <div className="flex flex-wrap gap-1">
                {status === 'pending' ? (<>
                  <Button size="sm" onClick={() => act.mutate({ uid: m.user.id, action: 'approve' })}><Check />Approve</Button>
                  <Button size="sm" variant="ghost" onClick={() => act.mutate({ uid: m.user.id, action: 'remove' })}><X />Decline</Button>
                </>) : (<>
                  <Button size="sm" variant="ghost" onClick={() => act.mutate({ uid: m.user.id, action: m.role === 'moderator' ? 'make_member' : 'make_moderator' })}>{m.role === 'moderator' ? 'Remove moderator' : 'Make moderator'}</Button>
                  {group.kind !== 'batch' && <Button size="sm" variant="ghost" onClick={() => act.mutate({ uid: m.user.id, action: 'remove' })}>Remove</Button>}
                </>)}
              </div>
            )}
          </li>))}</ul>
      )}
    </Card>
  );
}

function GroupEvents({ g, onCreate }: { g: GroupT; onCreate: () => void }) {
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const list = useQuery({ queryKey: ['group-events', g.id, scope], queryFn: () => get<Ev[]>(`/api/v1/events?group_id=${g.id}&scope=${scope}&page_size=50`) });
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
        <div className="flex gap-1">{(['upcoming', 'past'] as const).map((s) => <button key={s} onClick={() => setScope(s)}
          className={cn('rounded-btn px-3 py-1.5 text-sm font-medium capitalize', scope === s ? 'bg-primary-soft text-primary' : 'text-ink-muted hover:bg-canvas')}>{s}</button>)}</div>
        {g.can_manage && <Button onClick={onCreate}><Plus />Create Event</Button>}
      </div>
      {list.isLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : !list.data?.length ? <EmptyState icon={CalendarDays} title={scope === 'upcoming' ? 'No upcoming events' : 'No past events'}
        description={g.can_manage ? 'Create an event for your community.' : 'Events organised by this community appear here.'} /> : (
        <ul className="divide-y divide-line">{list.data.map((e) => (
          <li key={e.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
            <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-card bg-primary-soft text-primary">
              <span className="text-xs font-semibold uppercase">{new Date(e.starts_at).toLocaleString(undefined, { month: 'short' })}</span>
              <span className="font-heading text-2xl font-semibold leading-none">{new Date(e.starts_at).getDate()}</span></div>
            <div className="min-w-0 flex-1">
              <Link to={`/portal/events/${e.id}`} className="font-semibold text-ink hover:text-primary">{e.title}</Link>
              <p className="text-sm text-ink-muted">{fmtDateTime(e.starts_at)} · {e.kind_label}</p>
              <p className="flex items-center gap-1 text-sm text-ink-muted"><MapPin className="h-3.5 w-3.5" />{e.is_online ? 'Online' : e.venue} · {e.registered_count} going</p>
            </div>
            <Button asChild variant={e.my_registration || e.is_past ? 'outline' : 'primary'}><Link to={`/portal/events/${e.id}`}>{e.is_past ? 'View' : e.my_registration ? 'Going' : 'RSVP'}</Link></Button>
          </li>))}</ul>
      )}
    </Card>
  );
}

type FileRow = { id: string; filename: string; mime: string; size: number; url: string; post_id: string; shared_by: Author | null; created_at: string };

function GroupFiles({ g }: { g: GroupT }) {
  const list = useQuery({ queryKey: ['group-files', g.id], queryFn: () => get<FileRow[]>(`/api/v1/community/groups/${g.id}/files`) });
  if (list.isLoading) return <Skeleton className="h-40 rounded-card" />;
  if (!list.data?.length) return <Card><EmptyState icon={FileText} title="No files yet" description="Documents shared in community posts appear here. Use “Document” in the composer to share one." /></Card>;
  return (
    <Card>
      <ul className="divide-y divide-line">{list.data.map((f) => (
        <li key={f.id} className="flex items-center gap-3 px-4 py-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-btn bg-primary-soft text-primary"><FileText className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-ink">{f.filename}</p>
            <p className="truncate text-xs text-ink-muted">{fileSize(f.size)} · {f.shared_by?.full_name ?? 'A member'} · {timeAgo(f.created_at)} · <Link to={`/portal/community/posts/${f.post_id}`} className="text-primary hover:underline"><Link2 className="inline h-3 w-3" /> Post</Link></p>
          </div>
          <Button asChild size="sm" variant="outline"><a href={f.url} target="_blank" rel="noopener noreferrer" download={f.filename}><Download />Download</a></Button>
        </li>))}</ul>
    </Card>
  );
}

function InviteDialog({ g, onClose }: { g: GroupT; onClose: () => void }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 300);
  const [picked, setPicked] = useState<string[]>([]);
  const list = useQuery({ queryKey: ['group-invitable', g.id, dq], queryFn: () => get<(Author & { invited: boolean })[]>(`/api/v1/community/groups/${g.id}/invitable${dq ? `?q=${encodeURIComponent(dq)}` : ''}`) });
  const send = useAction(() => api<{ data: { sent: number } }>(`/api/v1/community/groups/${g.id}/invites`, { method: 'POST', body: { user_ids: picked } }),
    { success: (r) => `${r.data.sent} invitation${r.data.sent === 1 ? '' : 's'} sent.`, invalidate: [['group-invitable', g.id]], onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={`Invite to ${g.name}`} description="Invite your connections. They join straight away when they accept."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!picked.length} loading={send.isPending} onClick={() => send.mutate(undefined)}><UserPlus />Send Invites{picked.length ? ` (${picked.length})` : ''}</Button></>}>
      <div className="relative"><Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
        <Input aria-label="Search connections" placeholder="Search your connections…" value={q} onChange={(e) => setQ(e.target.value)} className="ps-9" /></div>
      <div className="mt-3 max-h-80 overflow-y-auto">
        {list.isLoading ? <Skeleton className="h-32" /> : !list.data?.length ? <p className="py-6 text-center text-sm text-ink-muted">{dq ? 'No connections match.' : 'All your connections are already members.'}</p> : (
          <ul className="divide-y divide-line">{list.data.map((p) => (
            <li key={p.id}><label className={cn('flex items-center gap-3 py-2.5', p.invited ? 'opacity-60' : 'cursor-pointer')}>
              <input type="checkbox" disabled={p.invited} checked={picked.includes(p.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id))}
                className="h-4 w-4 accent-[rgb(var(--primary))]" aria-label={`Invite ${p.full_name}`} />
              <Avatar name={p.full_name} src={photoUrl(p.photo, 64)} size={36} />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink">{p.full_name}</span><span className="text-xs text-ink-muted">{p.batch}</span></span>
              {p.invited && <Badge>Invited</Badge>}</label></li>))}</ul>
        )}
      </div>
    </Dialog>
  );
}

const EVENT_KINDS = [['reunion', 'Reunion'], ['batch_reunion', 'Batch reunion'], ['networking', 'Networking'], ['seminar', 'Seminar'], ['webinar', 'Webinar'], ['sports', 'Sports'], ['career', 'Career guidance'], ['other', 'Other']];

function EventDialog({ g, onClose, onDone }: { g: GroupT; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ title: '', kind: 'reunion', starts: '', ends: '', venue: '', is_online: false, online_url: '', summary: '', capacity: '' });
  const iso = (v: string) => (v ? new Date(v).toISOString() : null);
  const save = useAction(() => api(`/api/v1/community/groups/${g.id}/events`, { method: 'POST', body: {
    title: f.title, kind: f.kind, starts_at: iso(f.starts), ends_at: iso(f.ends), venue: f.venue || null, is_online: f.is_online, online_url: f.online_url || null,
    summary: f.summary, capacity: f.capacity ? Number(f.capacity) : null } }),
  { invalidate: [['group-events', g.id], ['group-overview', g.id], ['feed']], onSuccess: onDone });
  const e = save.fieldErrors;
  const ok = f.title.trim().length >= 3 && f.starts && f.ends && (f.is_online || f.venue.trim());
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} wide title="Create a community event" description={`Published to ${g.name}${g.private ? ' (members only)' : ''} and posted in the discussion.`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!ok} loading={save.isPending} onClick={() => save.mutate(undefined)}><CalendarDays />Create Event</Button></>}>
      <div className="space-y-4">
        <Field label="Event title" required error={e.title}>{(id) => <Input id={id} value={f.title} maxLength={200} onChange={(x) => setF({ ...f, title: x.target.value })} />}</Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Type">{(id) => <Select id={id} value={f.kind} onChange={(x) => setF({ ...f, kind: x.target.value })}>{EVENT_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>
          <Field label="Starts" required error={e.starts_at}>{(id) => <Input id={id} type="datetime-local" value={f.starts} onChange={(x) => setF({ ...f, starts: x.target.value })} />}</Field>
          <Field label="Ends" required error={e.ends_at}>{(id) => <Input id={id} type="datetime-local" value={f.ends} min={f.starts} onChange={(x) => setF({ ...f, ends: x.target.value })} />}</Field>
        </div>
        <Checkbox checked={f.is_online} onCheckedChange={(v) => setF({ ...f, is_online: v })} label="Online event" />
        {f.is_online ? <Field label="Meeting link" hint="Shown to registered attendees only." error={e.online_url}>{(id) => <Input id={id} value={f.online_url} placeholder="https://" onChange={(x) => setF({ ...f, online_url: x.target.value })} />}</Field>
          : <Field label="Venue" required error={e.venue}>{(id) => <Input id={id} value={f.venue} maxLength={200} onChange={(x) => setF({ ...f, venue: x.target.value })} />}</Field>}
        <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
          <Field label="Short description" error={e.summary}>{(id) => <Input id={id} value={f.summary} maxLength={300} onChange={(x) => setF({ ...f, summary: x.target.value })} />}</Field>
          <Field label="Capacity" hint="Empty = unlimited">{(id) => <Input id={id} type="number" min={1} value={f.capacity} onChange={(x) => setF({ ...f, capacity: x.target.value })} />}</Field>
        </div>
      </div>
    </Dialog>
  );
}
